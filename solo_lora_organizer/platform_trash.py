from __future__ import annotations

import ctypes
import os
import stat
import sys
from datetime import datetime
from typing import Callable, Mapping
from urllib.parse import quote_from_bytes

from .util import move_no_replace


def _existing_source(path: str) -> str:
    absolute = os.path.abspath(os.fspath(path))
    if "\0" in absolute:
        raise ValueError("Trash paths cannot contain a NUL character.")
    if not os.path.lexists(absolute):
        raise FileNotFoundError(absolute)
    return absolute


def _macos_error_description(core_foundation: ctypes.CDLL, error: ctypes.c_void_p) -> str:
    if not error.value:
        return ""
    core_foundation.CFErrorCopyDescription.argtypes = [ctypes.c_void_p]
    core_foundation.CFErrorCopyDescription.restype = ctypes.c_void_p
    description = core_foundation.CFErrorCopyDescription(error)
    if not description:
        return ""
    try:
        core_foundation.CFStringGetCString.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32,
        ]
        core_foundation.CFStringGetCString.restype = ctypes.c_ubyte
        buffer = ctypes.create_string_buffer(4096)
        # kCFStringEncodingUTF8
        if core_foundation.CFStringGetCString(description, buffer, len(buffer), 0x08000100):
            return buffer.value.decode("utf-8", "replace")
        return ""
    finally:
        core_foundation.CFRelease(description)


def _native_macos_trash(path: str) -> None:
    """Move one item with NSFileManager's native ``trashItemAtURL`` API."""
    if sys.platform != "darwin":
        raise RuntimeError("The native macOS Trash API is only available on macOS.")

    try:
        foundation = ctypes.CDLL(
            "/System/Library/Frameworks/Foundation.framework/Foundation"
        )
        core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        objective_c = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
    except OSError as exc:
        raise RuntimeError("The native macOS Foundation Trash API is unavailable.") from exc
    # Keep the Foundation handle alive for every Objective-C message below.
    _ = foundation

    objective_c.objc_getClass.argtypes = [ctypes.c_char_p]
    objective_c.objc_getClass.restype = ctypes.c_void_p
    objective_c.sel_registerName.argtypes = [ctypes.c_char_p]
    objective_c.sel_registerName.restype = ctypes.c_void_p
    message_address = ctypes.cast(objective_c.objc_msgSend, ctypes.c_void_p).value
    if not message_address:
        raise RuntimeError("The macOS Objective-C runtime is unavailable.")

    message_id = ctypes.CFUNCTYPE(
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
    )(message_address)
    message_void = ctypes.CFUNCTYPE(
        None, ctypes.c_void_p, ctypes.c_void_p,
    )(message_address)
    message_trash = ctypes.CFUNCTYPE(
        ctypes.c_byte,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
    )(message_address)

    def selector(name: bytes) -> ctypes.c_void_p:
        value = objective_c.sel_registerName(name)
        if not value:
            raise RuntimeError(f"The macOS selector {name.decode()} is unavailable.")
        return value

    pool_class = objective_c.objc_getClass(b"NSAutoreleasePool")
    manager_class = objective_c.objc_getClass(b"NSFileManager")
    if not pool_class or not manager_class:
        raise RuntimeError("Required macOS Foundation classes are unavailable.")

    pool = message_id(pool_class, selector(b"alloc"))
    pool = message_id(pool, selector(b"init")) if pool else None
    url = None
    try:
        path_bytes = os.fsencode(path)
        path_buffer = (ctypes.c_ubyte * len(path_bytes)).from_buffer_copy(path_bytes)
        core_foundation.CFURLCreateFromFileSystemRepresentation.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_long,
            ctypes.c_ubyte,
        ]
        core_foundation.CFURLCreateFromFileSystemRepresentation.restype = ctypes.c_void_p
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
        core_foundation.CFRelease.restype = None
        url = core_foundation.CFURLCreateFromFileSystemRepresentation(
            None,
            path_buffer,
            len(path_bytes),
            int(os.path.isdir(path) and not os.path.islink(path)),
        )
        if not url:
            raise RuntimeError("macOS could not represent the selected filesystem path.")

        manager = message_id(manager_class, selector(b"defaultManager"))
        if not manager:
            raise RuntimeError("macOS could not initialize NSFileManager.")
        resulting_url = ctypes.c_void_p()
        error = ctypes.c_void_p()
        succeeded = bool(message_trash(
            manager,
            selector(b"trashItemAtURL:resultingItemURL:error:"),
            url,
            ctypes.byref(resulting_url),
            ctypes.byref(error),
        ))
        if not succeeded:
            detail = _macos_error_description(core_foundation, error)
            suffix = f" {detail}" if detail else ""
            raise OSError(f"macOS Trash rejected the operation.{suffix}")
    finally:
        if url:
            core_foundation.CFRelease(url)
        if pool:
            message_void(pool, selector(b"drain"))


def send_to_macos_trash(
    path: str,
    native_trash: Callable[[str], None] | None = None,
) -> None:
    """Send one file or folder to macOS Trash without third-party packages."""
    source = _existing_source(path)
    (native_trash or _native_macos_trash)(source)
    if os.path.lexists(source):
        raise OSError("macOS reported success but the item remains at its original path.")


def _ensure_private_directory(path: str, uid: int) -> str:
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, mode=0o700, exist_ok=True)
    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        pass
    details = os.lstat(path)
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise OSError(f"Unsafe Trash directory: {path}")
    if details.st_uid != uid:
        raise PermissionError(f"Trash directory is not owned by the current user: {path}")
    os.chmod(path, 0o700)
    return path


def _trash_structure(root: str, uid: int) -> tuple[str, str]:
    root = _ensure_private_directory(root, uid)
    files = _ensure_private_directory(os.path.join(root, "files"), uid)
    info = _ensure_private_directory(os.path.join(root, "info"), uid)
    return files, info


def _home_trash(environ: Mapping[str, str], uid: int) -> tuple[str, str]:
    data_home = environ.get("XDG_DATA_HOME", "")
    if not data_home or not os.path.isabs(data_home):
        data_home = os.path.join(os.path.expanduser("~"), ".local", "share")
    return _trash_structure(os.path.join(data_home, "Trash"), uid)


def _mount_top(path: str, device: int) -> str:
    current = path if os.path.isdir(path) else os.path.dirname(path)
    current = os.path.abspath(current or os.path.sep)
    while True:
        parent = os.path.dirname(current)
        if parent == current or os.path.ismount(current):
            return current
        try:
            if os.lstat(parent).st_dev != device:
                return current
        except OSError:
            return current
        current = parent


def _volume_trash(top: str, uid: int) -> tuple[str, str]:
    shared = os.path.join(top, ".Trash")
    try:
        details = os.lstat(shared)
        shared_is_safe = (
            not stat.S_ISLNK(details.st_mode)
            and stat.S_ISDIR(details.st_mode)
            and bool(details.st_mode & stat.S_ISVTX)
        )
    except OSError:
        shared_is_safe = False
    if shared_is_safe:
        try:
            return _trash_structure(os.path.join(shared, str(uid)), uid)
        except OSError:
            pass
    return _trash_structure(os.path.join(top, f".Trash-{uid}"), uid)


def _select_freedesktop_trash(
    source: str,
    environ: Mapping[str, str],
    uid: int,
) -> tuple[str, str, str]:
    source_device = os.lstat(source).st_dev
    home_error: OSError | None = None
    try:
        files, info = _home_trash(environ, uid)
        if os.lstat(files).st_dev == source_device:
            return files, info, source
    except OSError as exc:
        home_error = exc

    top = _mount_top(source, source_device)
    try:
        files, info = _volume_trash(top, uid)
        if os.lstat(files).st_dev != source_device:
            raise OSError("The volume Trash is not on the selected item's filesystem.")
        relative = os.path.relpath(source, top)
        if relative == os.pardir or relative.startswith(os.pardir + os.sep):
            raise OSError("Could not express the selected item relative to its volume root.")
        return files, info, relative
    except OSError as volume_error:
        detail = f" Home Trash: {home_error}." if home_error else ""
        raise RuntimeError(
            "No safe FreeDesktop Trash is available for this filesystem; "
            f"the item was left untouched.{detail} Volume Trash: {volume_error}"
        ) from volume_error


def _trashinfo_payload(original_path: str) -> bytes:
    encoded_path = quote_from_bytes(os.fsencode(original_path), safe="/")
    deleted = datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    return f"[Trash Info]\nPath={encoded_path}\nDeletionDate={deleted}\n".encode("utf-8")


def _reserve_trashinfo(info_path: str, payload: bytes) -> None:
    descriptor = os.open(info_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        stream = os.fdopen(descriptor, "wb")
        descriptor = -1
        with stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            os.unlink(info_path)
        except OSError:
            pass
        raise


def send_to_freedesktop_trash(
    path: str,
    *,
    environ: Mapping[str, str] | None = None,
) -> str:
    """Move an item using the FreeDesktop.org Trash specification.

    The matching ``.trashinfo`` file is committed before the no-clobber move.
    There is intentionally no copy/delete fallback: if the filesystem cannot
    provide a safe Trash operation, the original item is left in place.
    """
    source = _existing_source(path)
    if source == os.path.abspath(os.path.sep):
        raise ValueError("The filesystem root cannot be moved to Trash.")
    if not hasattr(os, "getuid"):
        raise RuntimeError("FreeDesktop Trash requires a POSIX user identity.")
    uid = os.getuid()
    files_directory, info_directory, info_source = _select_freedesktop_trash(
        source, environ if environ is not None else os.environ, uid,
    )
    base_name = os.path.basename(source.rstrip(os.sep)) or "item"
    payload = _trashinfo_payload(info_source)

    for collision in range(10000):
        candidate = base_name if collision == 0 else f"{base_name}.{collision}"
        destination = os.path.join(files_directory, candidate)
        info_path = os.path.join(info_directory, candidate + ".trashinfo")
        if os.path.lexists(destination):
            continue
        try:
            _reserve_trashinfo(info_path, payload)
        except FileExistsError:
            continue
        try:
            move_no_replace(source, destination)
        except FileExistsError:
            try:
                os.unlink(info_path)
            except OSError:
                pass
            continue
        except Exception:
            try:
                os.unlink(info_path)
            except OSError:
                pass
            raise
        if os.path.lexists(source):
            raise OSError("The Trash move did not remove the item from its original path.")
        return destination
    raise FileExistsError("Could not allocate a unique name in the FreeDesktop Trash.")
