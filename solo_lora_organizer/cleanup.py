from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Event
from typing import List

from .models import CleanupRow, RuleSet, ScanBundle
from .scanning import Progress, _noop_progress
from .util import check_cancel, is_reparse_or_symlink, relative_path, row_id, walk_directories_safe, walk_files_safe


@dataclass
class SidecarInfo:
    is_candidate: bool = False
    strong: bool = False
    orphan: bool = False
    target_path: str = ""
    target_name: str = ""
    suffix: str = ""


def _casefold_regular_file(directory: str, requested_name: str) -> str | None:
    requested = requested_name.casefold()
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.casefold() != requested:
                    continue
                try:
                    if entry.is_file(follow_symlinks=False):
                        return entry.path
                except OSError:
                    return None
    except OSError:
        return None
    return None


def orphan_sidecar_info(path: str) -> SidecarInfo:
    name = os.path.basename(path)
    lower = name.lower()
    directory = os.path.dirname(path)
    if lower.endswith(".safetensors.rgthree-info"):
        target_name = name[:-len(".rgthree-info")]
        matching_path = _casefold_regular_file(directory, target_name)
        target_path = matching_path or os.path.join(directory, target_name)
        return SidecarInfo(
            True, True, matching_path is None, target_path,
            os.path.basename(target_path), ".safetensors.rgthree-info",
        )
    suffixes = (
        (".metadata.json", True), (".civitai.info", True), (".preview.png", True),
        (".json", False), (".jpeg", False), (".webp", False), (".png", False),
        (".jpg", False), (".txt", False),
    )
    for suffix, strong in suffixes:
        if not lower.endswith(suffix):
            continue
        stem = name[:-len(suffix)]
        if not stem:
            continue
        target_name = stem + ".safetensors"
        matching_path = _casefold_regular_file(directory, target_name)
        target_path = matching_path or os.path.join(directory, target_name)
        return SidecarInfo(
            True, strong, matching_path is None, target_path,
            os.path.basename(target_path), suffix,
        )
    return SidecarInfo()


def sidecar_paths(lora_path: str) -> List[str]:
    stem = os.path.splitext(os.path.basename(lora_path))[0]
    directory = os.path.dirname(lora_path)
    suffixes = (
        ".json", ".metadata.json", ".civitai.info", ".preview.png", ".png", ".jpg", ".jpeg",
        ".webp", ".txt", ".safetensors.rgthree-info",
    )
    requested = {(stem + suffix).casefold() for suffix in suffixes}
    matches: List[str] = []
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.casefold() not in requested:
                    continue
                try:
                    if entry.is_file(follow_symlinks=False):
                        matches.append(entry.path)
                except OSError:
                    continue
    except OSError:
        return []
    return sorted(matches, key=lambda candidate: os.path.basename(candidate).casefold())


def directory_tree_contains_any_file(directory: str) -> bool:
    pending = [directory]
    while pending:
        current = pending.pop()
        try:
            with os.scandir(current) as entries:
                children = list(entries)
        except OSError:
            return True
        for entry in children:
            try:
                if entry.is_file(follow_symlinks=False):
                    return True
                if entry.is_dir(follow_symlinks=False):
                    if is_reparse_or_symlink(entry):
                        return True
                    pending.append(entry.path)
            except OSError:
                return True
    return False


def top_level_empty_folder_trees(root: str) -> List[str]:
    directories = sorted(walk_directories_safe(root), key=lambda path: (len(path), path.casefold()))
    selected: List[str] = []
    for directory in directories:
        if directory_tree_contains_any_file(directory):
            continue
        full = os.path.abspath(directory)
        if any(os.path.commonpath([os.path.abspath(parent), full]) == os.path.abspath(parent) for parent in selected):
            continue
        selected.append(directory)
    return selected


def scan_cleanup(
    root: str,
    cancel: Event | None = None,
    progress: Progress = _noop_progress,
) -> ScanBundle:
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise ValueError("Choose a valid LoRA folder first.")
    files = list(walk_files_safe(root, None, True, cancel))
    rows: List[CleanupRow] = []
    total = len(files)
    for index, path in enumerate(files, start=1):
        check_cancel(cancel)
        progress("Checking sidecars", index, total, os.path.basename(path), round(index / max(total, 1) * 100))
        if path.lower().endswith(".safetensors"):
            continue
        info = orphan_sidecar_info(path)
        if not info.is_candidate or not info.orphan:
            continue
        strong = info.strong
        cleanup_type = "Orphan sidecar" if strong else "Possible orphan sidecar"
        reason = (
            "Known LoRA sidecar has no matching .safetensors" if strong
            else "Same-stem sidecar candidate has no matching .safetensors; review before recycling"
        )
        rows.append(CleanupRow(
            row_id=row_id("cleanup", path),
            cleanup_type=cleanup_type,
            path_value=path,
            display_path=relative_path(root, path),
            is_directory=False,
            size=os.path.getsize(path) if os.path.exists(path) else 0,
            related_model=info.target_name,
            reason=reason,
            include=strong,
        ))
    for path in top_level_empty_folder_trees(root):
        rows.append(CleanupRow(
            row_id=row_id("cleanup", path, "directory"),
            cleanup_type="Empty folder tree",
            path_value=path,
            display_path=relative_path(root, path),
            is_directory=True,
            size=0,
            related_model="",
            reason="Folder tree contains no files",
            include=True,
        ))
    return ScanBundle("cleanup", root, RuleSet(), rows)
