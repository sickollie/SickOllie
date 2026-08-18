from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import stat
import sys
import tempfile
from pathlib import Path
from threading import Event
from typing import Any, Callable, Iterator


class Cancelled(RuntimeError):
    pass


def check_cancel(cancel: Event | None) -> None:
    if cancel is not None and cancel.is_set():
        raise Cancelled("Scan stopped. No files were changed.")


def norm_path(path: str | os.PathLike[str]) -> str:
    normalized = os.path.normcase(os.path.abspath(os.fspath(path)))
    # Default macOS volumes are case-insensitive. Treating case-only variants
    # as collisions is conservative on case-sensitive macOS volumes too.
    return normalized.casefold() if sys.platform == "darwin" else normalized


def paths_equal(left: str, right: str) -> bool:
    try:
        if os.path.lexists(left) and os.path.lexists(right):
            return os.path.samefile(left, right)
        return norm_path(left) == norm_path(right)
    except Exception:
        return left.casefold() == right.casefold()


def _raise_rename_error(error_number: int, source: str, destination: str) -> None:
    if error_number == errno.EEXIST:
        raise FileExistsError(error_number, os.strerror(error_number), destination)
    raise OSError(error_number, os.strerror(error_number), source, destination)


def _hardlink_move_no_replace(source: str, destination: str) -> None:
    details = os.lstat(source)
    if not stat.S_ISREG(details.st_mode):
        raise OSError(
            errno.ENOTSUP,
            "This filesystem does not expose an atomic no-overwrite directory move.",
            source,
        )
    os.link(source, destination, follow_symlinks=False)
    try:
        os.unlink(source)
    except Exception:
        try:
            os.unlink(destination)
        except OSError:
            pass
        raise


def move_no_replace(source: str, destination: str) -> None:
    """Atomically move ``source`` while refusing an existing destination.

    Windows' ``os.rename`` already has no-replace behavior. Linux and macOS
    expose explicit native flags; the regular-file fallback uses link/unlink
    and refuses directories instead of risking POSIX rename replacement.
    """
    source = os.path.abspath(source)
    destination = os.path.abspath(destination)
    if os.path.lexists(destination):
        raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), destination)
    if os.name == "nt":
        os.rename(source, destination)
        return

    encoded_source = os.fsencode(source)
    encoded_destination = os.fsencode(destination)
    if sys.platform.startswith("linux"):
        library = ctypes.CDLL(None, use_errno=True)
        renameat2 = getattr(library, "renameat2", None)
        if renameat2 is not None:
            renameat2.argtypes = [
                ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint,
            ]
            renameat2.restype = ctypes.c_int
            # AT_FDCWD and RENAME_NOREPLACE
            if renameat2(-100, encoded_source, -100, encoded_destination, 1) == 0:
                return
            error_number = ctypes.get_errno()
            if error_number not in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
                _raise_rename_error(error_number, source, destination)
    elif sys.platform == "darwin":
        library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        renamex = getattr(library, "renamex_np", None)
        if renamex is not None:
            renamex.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            renamex.restype = ctypes.c_int
            # RENAME_EXCL
            if renamex(encoded_source, encoded_destination, 0x00000004) == 0:
                return
            error_number = ctypes.get_errno()
            if error_number not in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
                _raise_rename_error(error_number, source, destination)

    _hardlink_move_no_replace(source, destination)


def relative_path(root: str, path: str) -> str:
    try:
        return os.path.relpath(os.path.abspath(path), os.path.abspath(root))
    except Exception:
        return os.path.basename(path)


def ensure_within(root: str, path: str) -> str:
    root_full = os.path.abspath(root)
    path_full = os.path.abspath(path)
    root_real = os.path.realpath(root_full)
    path_real = os.path.realpath(path_full)
    try:
        common = os.path.commonpath([root_real, path_real])
    except ValueError as exc:
        raise ValueError(f"Path is outside the selected LoRA library: {path}") from exc
    if os.path.normcase(common) != os.path.normcase(root_real):
        raise ValueError(f"Path is outside the selected LoRA library: {path}")
    return path_full


def is_reparse_or_symlink(entry: os.DirEntry[str]) -> bool:
    try:
        if entry.is_symlink():
            return True
        attrs = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
        return bool(attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))
    except OSError:
        return True


def walk_files_safe(
    root: str,
    predicate: Callable[[str], bool] | None = None,
    recursive: bool = True,
    cancel: Event | None = None,
    on_folder: Callable[[int, int], None] | None = None,
) -> Iterator[str]:
    pending = [os.path.abspath(root)]
    folders = 0
    found = 0
    while pending:
        check_cancel(cancel)
        current = pending.pop()
        folders += 1
        try:
            with os.scandir(current) as entries:
                children = list(entries)
        except OSError:
            continue
        for entry in children:
            check_cancel(cancel)
            try:
                if entry.is_file(follow_symlinks=False):
                    if predicate is None or predicate(entry.name):
                        found += 1
                        yield entry.path
                elif recursive and entry.is_dir(follow_symlinks=False) and not is_reparse_or_symlink(entry):
                    pending.append(entry.path)
            except OSError:
                continue
        if on_folder and (folders == 1 or folders % 20 == 0):
            on_folder(found, folders)


def walk_directories_safe(root: str) -> list[str]:
    result: list[str] = []
    pending = [os.path.abspath(root)]
    while pending:
        current = pending.pop()
        try:
            with os.scandir(current) as entries:
                children = list(entries)
        except OSError:
            continue
        for entry in children:
            try:
                if entry.is_dir(follow_symlinks=False) and not is_reparse_or_symlink(entry):
                    result.append(entry.path)
                    pending.append(entry.path)
            except OSError:
                continue
    return result


def sha256_file(
    path: str,
    cancel: Event | None = None,
    chunk_size: int = 4 * 1024 * 1024,
) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while True:
            check_cancel(cancel)
            chunk = stream.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    check_cancel(cancel)
    return digest.hexdigest().upper()


def row_id(mode: str, path: str, salt: str = "") -> str:
    value = f"{mode}\0{norm_path(path)}\0{salt}".encode("utf-8", "surrogatepass")
    return hashlib.sha256(value).hexdigest()[:24]


def atomic_json_write(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, target)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def load_json(path: str | Path, fallback: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except (OSError, ValueError, TypeError):
        return fallback


def format_bytes(size: int) -> str:
    for unit, boundary in (("TB", 1 << 40), ("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if size >= boundary:
            decimals = 2 if unit in {"TB", "GB"} else 1
            return f"{size / boundary:,.{decimals}f} {unit}"
    return f"{size} B"
