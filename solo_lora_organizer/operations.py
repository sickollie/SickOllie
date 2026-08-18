from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Set

from .cleanup import directory_tree_contains_any_file, orphan_sidecar_info, sidecar_paths
from .models import CleanupRow, DuplicateRow, MoveRecord, OrganizationOperation, ScanBundle, ScanRow
from .naming import safe_name
from .planner import destination_directory
from .util import atomic_json_write, ensure_within, format_bytes, move_no_replace, norm_path, paths_equal, sha256_file


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def _manifest_path(directory: Path, prefix: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{prefix}{_stamp()}.json"


def _write_organization_manifest(path: Path, root: str, operations: Sequence[OrganizationOperation]) -> None:
    atomic_json_write(path, {
        "schemaVersion": 1,
        "createdAt": _now(),
        "root": root,
        "operations": [asdict(operation) for operation in operations],
    })


def apply_organization(
    bundle: ScanBundle,
    selected_ids: Iterable[str],
    edits: Mapping[str, Mapping[str, Any]] | None,
    manifests_dir: str | Path,
) -> Dict[str, Any]:
    if bundle.mode != "organizer":
        raise ValueError("This job is not an Organizer preview.")
    selected = set(selected_ids)
    edits = edits or {}
    rows = [row for row in bundle.rows if isinstance(row, ScanRow) and row.row_id in selected]
    if not rows:
        raise ValueError("There are no checked Ready items to apply.")
    root = os.path.abspath(bundle.root)
    rules = bundle.rules
    manifest_path = _manifest_path(Path(manifests_dir), "organization-")
    operations: List[OrganizationOperation] = []
    done = failed = moved_files = 0
    results: List[Dict[str, Any]] = []

    for row in rows:
        override = edits.get(row.row_id) or {}
        old_main = ensure_within(root, row.full_path)
        try:
            if not os.path.isfile(old_main):
                raise OSError("Source file no longer exists: " + old_main)
            old_directory = os.path.dirname(old_main)
            old_name = os.path.basename(old_main)
            old_stem, extension = os.path.splitext(old_name)
            if rules.rename_files:
                edited_name = str(override.get("proposed_name", row.proposed_name) or "").strip()
                if not edited_name:
                    raise ValueError("Proposed filename is empty.")
                edited_stem = os.path.splitext(os.path.basename(edited_name))[0]
                new_stem = safe_name(edited_stem, old_stem)
                new_name = new_stem + extension
            else:
                new_stem, new_name = old_stem, old_name
            edited_base = safe_name(str(override.get("base_folder", row.base_folder) or "Unknown Base"), "Unknown Base")
            edited_category = safe_name(str(override.get("category", row.category) or "Other"), "Other")
            info = row.civitai
            has_civitai = info.found
            use_uncharted = row.is_uncharted
            folder_fallback = bool(row.effective_creator) and row.creator_source == "Existing folder"
            creator_missing = rules.organize_creators and has_civitai and not row.effective_creator
            routing_incomplete = has_civitai and not info.model_meta_complete and (
                rules.organize_creators or rules.organize_categories
            )
            preserve_directory = creator_missing or routing_incomplete or (not has_civitai and folder_fallback)
            if preserve_directory:
                new_directory = old_directory
            else:
                use_base = rules.organize_base_models and edited_base.casefold() != "unknown base"
                use_category = rules.organize_categories and (has_civitai or use_uncharted)
                use_creator = rules.organize_creators and has_civitai and bool(row.effective_creator)
                creator_folder = row.creator_folder_name if rules.group_one_off_creators and use_creator and row.creator_folder_name else row.effective_creator
                new_directory = destination_directory(
                    root, edited_base, edited_category, creator_folder,
                    use_base, use_category, use_creator,
                )
            new_directory = ensure_within(root, new_directory or old_directory)
            new_main = ensure_within(root, os.path.join(new_directory, new_name))
            if os.path.lexists(new_main) and not paths_equal(old_main, new_main):
                raise OSError("Destination already exists: " + new_main)

            planned: List[MoveRecord] = []
            if not paths_equal(old_main, new_main):
                planned.append(MoveRecord(old_main, new_main))
            for old_sidecar in sidecar_paths(old_main):
                ensure_within(root, old_sidecar)
                side_name = os.path.basename(old_sidecar)
                if len(side_name) < len(old_stem):
                    continue
                suffix = side_name[len(old_stem):]
                new_sidecar = ensure_within(root, os.path.join(new_directory, new_stem + suffix))
                if not paths_equal(old_sidecar, new_sidecar):
                    planned.append(MoveRecord(old_sidecar, new_sidecar))

            destinations: Set[str] = set()
            for move in planned:
                target = norm_path(move.new_path)
                if target in destinations:
                    raise OSError("Two files would target the same destination: " + move.new_path)
                destinations.add(target)
                if os.path.lexists(move.new_path):
                    raise OSError("Destination already exists: " + move.new_path)
            if not planned:
                row.include = False
                row.planning_status = "No change needed"
                done += 1
                results.append({"row_id": row.row_id, "status": "No change needed", "ok": True})
                continue

            operation = OrganizationOperation(
                model_id=info.model_id,
                version_id=info.version_id,
                model_name=info.model_name,
                creator=row.effective_creator,
                files=planned,
            )
            operations.append(operation)
            # Record every intended move before the first filesystem mutation.
            _write_organization_manifest(manifest_path, root, operations)
            for move in planned:
                Path(move.new_path).parent.mkdir(parents=True, exist_ok=True)
                move_no_replace(move.old_path, move.new_path)
                moved_files += 1

            row.base_folder = edited_base
            row.category = edited_category
            row.destination_directory = new_directory
            row.new_base_name = new_stem
            row.new_full_path = new_main
            row.proposed_name = new_name
            row.full_path = new_main
            row.display_path = os.path.relpath(new_main, root)
            row.planning_status = "Applied"
            row.include = False
            done += 1
            results.append({"row_id": row.row_id, "status": "Applied", "ok": True, "new_path": new_main})
        except Exception as exc:
            failed += 1
            row.planning_status = "FAILED: " + str(exc)
            results.append({"row_id": row.row_id, "status": row.planning_status, "ok": False})

    if moved_files == 0:
        try:
            manifest_path.unlink()
        except OSError:
            pass
    return {
        "done": done,
        "failed": failed,
        "moved_files": moved_files,
        "manifest": str(manifest_path) if moved_files else "",
        "undo_available": bool(latest_undo_manifest(manifests_dir)),
        "rows": results,
        "message": f"Finished. {done} applied, {failed} failed." + (
            " Undo is available for the saved operations." if moved_files else ""
        ),
    }


def latest_undo_manifest(manifests_dir: str | Path) -> Path | None:
    directory = Path(manifests_dir)
    try:
        candidates = [path for path in directory.glob("organization-*.json") if path.is_file()]
        return max(candidates, key=lambda path: path.stat().st_mtime_ns) if candidates else None
    except OSError:
        return None


def _manifest_moves(raw: Mapping[str, Any]) -> List[List[MoveRecord]]:
    operations = raw.get("operations") or raw.get("Operations") or []
    result: List[List[MoveRecord]] = []
    for operation in operations if isinstance(operations, list) else []:
        if not isinstance(operation, dict):
            continue
        files = operation.get("files") or operation.get("Files") or []
        moves: List[MoveRecord] = []
        for item in files if isinstance(files, list) else []:
            if not isinstance(item, dict):
                continue
            old_path = item.get("old_path") or item.get("OldPath") or ""
            new_path = item.get("new_path") or item.get("NewPath") or ""
            if old_path and new_path:
                moves.append(MoveRecord(str(old_path), str(new_path)))
        result.append(moves)
    return result


def undo_last(manifests_dir: str | Path) -> Dict[str, Any]:
    latest = latest_undo_manifest(manifests_dir)
    if latest is None:
        raise ValueError("No organization manifest is available to undo.")
    with open(latest, "r", encoding="utf-8-sig") as stream:
        raw = json.load(stream)
    root = str(raw.get("root") or raw.get("Root") or "")
    if not root:
        raise ValueError("The undo manifest has no library root.")
    restored = skipped = 0
    for operation in reversed(_manifest_moves(raw)):
        for move in reversed(operation):
            old_path = ensure_within(root, move.old_path)
            new_path = ensure_within(root, move.new_path)
            if not os.path.isfile(new_path) or os.path.lexists(old_path):
                skipped += 1
                continue
            Path(old_path).parent.mkdir(parents=True, exist_ok=True)
            move_no_replace(new_path, old_path)
            restored += 1
    undone = latest.with_suffix(latest.suffix + ".undone")
    if undone.exists():
        undone = Path(str(latest) + "." + _stamp() + ".undone")
    latest.rename(undone)
    return {
        "restored": restored,
        "skipped": skipped,
        "message": f"Undo finished. {restored} file(s) restored, {skipped} skipped.",
    }


def _send_to_windows_recycle_bin(path: str, operation_runner: Any | None = None) -> None:
    """Send one file or folder to the Windows Recycle Bin using Shell32.

    ``SHFileOperationW`` accepts a double-NUL-terminated path list. Keeping the
    backing Unicode buffer alive for the duration of the call is important:
    assigning a normal Python string would discard the second terminator.

    ``operation_runner`` is an internal test seam. Production calls always use
    the native Windows Shell function.
    """
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_ushort),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    absolute_path = os.path.abspath(path)
    if "\0" in absolute_path:
        raise ValueError("Recycle Bin paths cannot contain a NUL character.")

    # create_unicode_buffer appends its own terminator, producing the required
    # double NUL after the explicit one below.
    source_buffer = ctypes.create_unicode_buffer(absolute_path + "\0")
    operation = SHFILEOPSTRUCTW()
    operation.hwnd = None
    operation.wFunc = 3  # FO_DELETE
    operation.pFrom = ctypes.cast(source_buffer, wintypes.LPCWSTR)
    operation.pTo = None
    operation.fFlags = (
        0x0040  # FOF_ALLOWUNDO: use the Recycle Bin instead of permanent deletion
        | 0x0010  # FOF_NOCONFIRMATION
        | 0x0004  # FOF_SILENT
        | 0x0400  # FOF_NOERRORUI
        | 0x2000  # FOF_NO_CONNECTED_ELEMENTS: touch only the selected path
        | 0x4000  # FOF_WANTNUKEWARNING: warn rather than silently delete permanently
    )

    runner = operation_runner
    if runner is None:
        try:
            runner = ctypes.windll.shell32.SHFileOperationW
        except AttributeError as exc:
            raise RuntimeError("The native Windows Recycle Bin API is unavailable.") from exc
        runner.argtypes = [ctypes.POINTER(SHFILEOPSTRUCTW)]
        runner.restype = ctypes.c_int

    result = int(runner(ctypes.byref(operation)))
    if operation.fAnyOperationsAborted:
        raise RuntimeError("Windows cancelled the Recycle Bin operation.")
    if result != 0:
        try:
            detail = ctypes.FormatError(result).strip()
        except (AttributeError, OSError, ValueError):
            detail = ""
        suffix = f" {detail}" if detail else ""
        raise OSError(result, f"Windows Recycle Bin rejected the operation (code {result}).{suffix}")


def trash_capabilities(
    os_name: str | None = None,
    platform_name: str | None = None,
) -> Dict[str, Any]:
    os_name = os.name if os_name is None else os_name
    platform_name = sys.platform if platform_name is None else platform_name
    if os_name == "nt":
        return {
            "available": True,
            "backend": "windows-shell32",
            "label": "Windows Recycle Bin",
            "verb": "Recycle",
        }
    if platform_name == "darwin":
        return {
            "available": True,
            "backend": "macos-foundation",
            "label": "macOS Trash",
            "verb": "Trash",
        }
    if platform_name.startswith("linux"):
        return {
            "available": True,
            "backend": "freedesktop-trash",
            "label": "Trash",
            "verb": "Trash",
        }
    return {
        "available": False,
        "backend": "unsupported",
        "label": "Trash",
        "verb": "Trash",
        "reason": "SOLO has no safe native Trash backend for this operating system.",
    }


def _send_to_trash(
    path: str,
    os_name: str | None = None,
    platform_name: str | None = None,
) -> None:
    capability = trash_capabilities(os_name, platform_name)
    if capability["backend"] == "windows-shell32":
        _send_to_windows_recycle_bin(path)
        return
    if capability["backend"] == "macos-foundation":
        from .platform_trash import send_to_macos_trash
        send_to_macos_trash(path)
        return
    if capability["backend"] == "freedesktop-trash":
        from .platform_trash import send_to_freedesktop_trash
        send_to_freedesktop_trash(path)
        return
    raise RuntimeError(str(capability.get("reason") or "No safe Trash backend is available."))


def _write_action_manifest(directory: Path, prefix: str, payload: Mapping[str, Any]) -> str:
    path = _manifest_path(directory, prefix)
    atomic_json_write(path, dict(payload))
    return str(path)


def recycle_duplicates(
    bundle: ScanBundle,
    selected_ids: Iterable[str],
    manifests_dir: str | Path,
) -> Dict[str, Any]:
    if bundle.mode != "duplicates":
        raise ValueError("This job is not an Exact Duplicates preview.")
    root = os.path.abspath(bundle.root)
    selected = set(selected_ids)
    rows = [row for row in bundle.rows if isinstance(row, DuplicateRow)]
    targets = [row for row in rows if row.row_id in selected]
    if not targets:
        raise ValueError("No duplicate copies are checked for removal.")
    groups: Dict[str, List[DuplicateRow]] = {}
    for row in rows:
        groups.setdefault(row.sha256, []).append(row)
    for sha, group in groups.items():
        existing = [row for row in group if os.path.isfile(row.file_path)]
        checked = [row for row in existing if row.row_id in selected]
        if existing and len(checked) >= len(existing):
            raise ValueError(f"Safety stop: every copy in {group[0].group} is checked. Uncheck at least one keeper.")

    # Complete all freshness checks before recycling the first file.
    for row in targets:
        path = ensure_within(root, row.file_path)
        if not os.path.isfile(path):
            raise ValueError("A selected duplicate no longer exists. Run Find Exact Duplicates again: " + path)
        if sha256_file(path) != row.sha256:
            raise ValueError("A selected file changed after the duplicate scan. Nothing was removed: " + path)
    for sha, group in groups.items():
        if not any(row.row_id in selected for row in group):
            continue
        survivor = next((row for row in group if row.row_id not in selected and os.path.isfile(row.file_path)), None)
        if survivor is None:
            raise ValueError("Could not verify a surviving keeper for one duplicate group. Nothing was removed.")
        keeper_path = ensure_within(root, survivor.file_path)
        if sha256_file(keeper_path) != sha:
            raise ValueError("The intended surviving copy changed after the scan. Nothing was removed: " + keeper_path)

    done = failed = removed_bytes = 0
    trash_label = str(trash_capabilities()["label"])
    entries: List[Dict[str, Any]] = []
    results: List[Dict[str, Any]] = []
    for row in targets:
        try:
            path = ensure_within(root, row.file_path)
            _send_to_trash(path)
            if os.path.lexists(path):
                raise OSError("The operating system did not remove the file from its original location.")
            done += 1
            removed_bytes += row.size
            row.include = False
            row.status = f"Sent to {trash_label}"
            entries.append({
                "path": path, "sha256": row.sha256, "group": row.group,
                "keeper": row.keeper_path, "size": row.size,
            })
            results.append({"row_id": row.row_id, "ok": True, "status": row.status})
        except Exception as exc:
            failed += 1
            row.status = "FAILED: " + str(exc)
            results.append({"row_id": row.row_id, "ok": False, "status": row.status})
    manifest = ""
    if entries:
        manifest = _write_action_manifest(Path(manifests_dir), "duplicates-", {
            "createdAt": _now(), "type": "exact-duplicate-recycle", "root": root, "files": entries,
        })
    return {
        "done": done, "failed": failed, "removed_bytes": removed_bytes, "manifest": manifest, "rows": results,
        "message": f"Duplicate cleanup finished. {done} sent to {trash_label}, {failed} failed, {format_bytes(removed_bytes)} removed from the library.",
    }


def recycle_cleanup(
    bundle: ScanBundle,
    selected_ids: Iterable[str],
    manifests_dir: str | Path,
) -> Dict[str, Any]:
    if bundle.mode != "cleanup":
        raise ValueError("This job is not an Orphans / Empty Folders preview.")
    root = os.path.abspath(bundle.root)
    selected = set(selected_ids)
    rows = [row for row in bundle.rows if isinstance(row, CleanupRow) and row.row_id in selected]
    if not rows:
        raise ValueError("No cleanup items are checked.")
    rows.sort(key=lambda row: (row.is_directory, -len(row.path_value) if row.is_directory else 0, row.path_value.casefold()))
    done = failed = 0
    trash_label = str(trash_capabilities()["label"])
    entries: List[Dict[str, Any]] = []
    results: List[Dict[str, Any]] = []
    for row in rows:
        try:
            path = ensure_within(root, row.path_value)
            if row.is_directory:
                if not os.path.isdir(path):
                    raise OSError("Folder no longer exists: " + path)
                if directory_tree_contains_any_file(path):
                    raise OSError("Folder tree is no longer empty")
            else:
                if not os.path.isfile(path):
                    raise OSError("File no longer exists: " + path)
                info = orphan_sidecar_info(path)
                if not info.is_candidate or not info.orphan:
                    raise OSError("A matching LoRA now exists, or this is no longer an orphan candidate")
            _send_to_trash(path)
            if os.path.lexists(path):
                raise OSError("The operating system did not remove the item from its original location.")
            row.include = False
            row.status = f"Sent to {trash_label}"
            done += 1
            entries.append({"path": path, "type": row.cleanup_type})
            results.append({"row_id": row.row_id, "ok": True, "status": row.status})
        except Exception as exc:
            failed += 1
            row.status = "FAILED: " + str(exc)
            results.append({"row_id": row.row_id, "ok": False, "status": row.status})
    manifest = ""
    if entries:
        manifest = _write_action_manifest(Path(manifests_dir), "cleanup-", {
            "createdAt": _now(), "type": "orphan-empty-cleanup", "root": root, "items": entries,
        })
    return {
        "done": done, "failed": failed, "manifest": manifest, "rows": results,
        "message": f"Cleanup finished. {done} sent to {trash_label}, {failed} failed. Run cleanup again to catch folders made empty by sidecar removal.",
    }
