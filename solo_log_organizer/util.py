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
from typing import Any, Iterator


class Cancelled(RuntimeError):
    pass


def check_cancel(cancel: Event | None) -> None:
    if cancel is not None and cancel.is_set():
        raise Cancelled("Scan stopped. No files were changed.")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().upper()


def sha256_file(path: str, chunk_size: int = 4 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest().upper()


def norm_line(line: str) -> str:
    return " ".join(line.strip().split()).casefold()


def content_hash(lines: list[str]) -> str:
    return sha256_bytes("\n".join(norm_line(line) for line in lines if norm_line(line)).encode("utf-8"))


def row_id(path: str) -> str:
    return hashlib.sha256(os.path.abspath(path).encode("utf-8", "surrogatepass")).hexdigest()[:24]


def norm_path(path: str | os.PathLike[str]) -> str:
    normalized = os.path.normcase(os.path.abspath(os.fspath(path)))
    return normalized.casefold() if sys.platform == "darwin" else normalized


def ensure_within(root: str, path: str) -> str:
    root_full = os.path.abspath(root)
    path_full = os.path.abspath(path)
    root_real = os.path.realpath(root_full)
    path_real = os.path.realpath(path_full)
    try:
        common = os.path.commonpath([root_real, path_real])
    except ValueError as exc:
        raise ValueError(f"Path is outside the selected log library: {path}") from exc
    if os.path.normcase(common) != os.path.normcase(root_real):
        raise ValueError(f"Path is outside the selected log library: {path}")
    return path_full


def atomic_json_write(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def load_json(path: str | Path, fallback: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except (OSError, ValueError, TypeError):
        return fallback


def walk_text_files(root: str, cancel: Event | None = None) -> Iterator[str]:
    ignored = {
        "_solo_log_organizer", "_promptsorter_backups", "_promptsorter_archive",
        "_promptsorter_data", "__pycache__",
    }
    pending = [os.path.abspath(root)]
    while pending:
        check_cancel(cancel)
        current = pending.pop()
        try:
            with os.scandir(current) as entries:
                children = list(entries)
        except OSError:
            continue
        for entry in children:
            check_cancel(cancel)
            try:
                if entry.is_file(follow_symlinks=False) and entry.name.casefold().endswith(".txt"):
                    yield entry.path
                elif (
                    entry.is_dir(follow_symlinks=False)
                    and not entry.is_symlink()
                    and entry.name.casefold() not in ignored
                ):
                    pending.append(entry.path)
            except OSError:
                continue


def _raise_rename_error(number: int, source: str, destination: str) -> None:
    if number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise FileExistsError(number, os.strerror(number), destination)
    raise OSError(number, os.strerror(number), source, destination)


def _hardlink_move(source: str, destination: str) -> None:
    if not stat.S_ISREG(os.lstat(source).st_mode):
        raise OSError(errno.ENOTSUP, "Atomic no-overwrite directory move is unavailable.", source)
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
    source, destination = os.path.abspath(source), os.path.abspath(destination)
    if os.path.lexists(destination):
        raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), destination)
    if os.name == "nt":
        os.rename(source, destination)
        return
    encoded_source, encoded_destination = os.fsencode(source), os.fsencode(destination)
    if sys.platform.startswith("linux"):
        renameat2 = getattr(ctypes.CDLL(None, use_errno=True), "renameat2", None)
        if renameat2 is not None:
            renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            renameat2.restype = ctypes.c_int
            if renameat2(-100, encoded_source, -100, encoded_destination, 1) == 0:
                return
            number = ctypes.get_errno()
            if number not in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
                _raise_rename_error(number, source, destination)
    elif sys.platform == "darwin":
        renamex = getattr(ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True), "renamex_np", None)
        if renamex is not None:
            renamex.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            renamex.restype = ctypes.c_int
            if renamex(encoded_source, encoded_destination, 0x00000004) == 0:
                return
            number = ctypes.get_errno()
            if number not in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
                _raise_rename_error(number, source, destination)
    _hardlink_move(source, destination)


def atomic_text_write_no_replace(path: str, text: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        move_no_replace(temporary, str(target))
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
