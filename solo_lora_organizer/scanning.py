from __future__ import annotations

import os
import re
from collections import defaultdict
from threading import Event
from typing import Callable, Dict, List, Set

from .civitai import CivitaiClient
from .metadata import read_safetensor_metadata
from .models import DuplicateRow, RuleSet, ScanBundle, ScanRow
from .naming import get_base_model_folder, get_primary_category, infer_creator_from_existing_folder
from .planner import apply_planning, detect_root_context
from .util import check_cancel, norm_path, relative_path, row_id, sha256_file, walk_files_safe


Progress = Callable[[str, int, int, str, int], None]


def _noop_progress(stage: str, current: int, total: int, filename: str, percent: int) -> None:
    return None


def scan_organizer(
    root: str,
    rules: RuleSet,
    client: CivitaiClient,
    token: str = "",
    cancel: Event | None = None,
    progress: Progress = _noop_progress,
) -> ScanBundle:
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise ValueError("Choose a valid LoRA folder first.")

    def folder_progress(found: int, folders: int) -> None:
        progress(f"Discovering LoRA files · {found} found · {folders} folders checked", found, 0, "", 0)

    files = list(walk_files_safe(
        root,
        predicate=lambda name: name.lower().endswith(".safetensors"),
        recursive=rules.reprocess_existing_subfolders,
        cancel=cancel,
        on_folder=folder_progress,
    ))
    check_cancel(cancel)
    files.sort(key=str.casefold)
    rows: List[ScanRow] = []
    total = len(files)
    for index, path in enumerate(files, start=1):
        check_cancel(cancel)
        before = round(((index - 1) / max(total, 1)) * 100)
        progress("Reading embedded metadata", index, total, os.path.basename(path), before)
        metadata = read_safetensor_metadata(path)
        progress("Hashing", index, total, os.path.basename(path), before)
        sha = sha256_file(path, cancel)
        progress("Looking up on Civitai", index, total, os.path.basename(path), before)
        civitai = client.lookup_hash(sha, token, cancel)
        raw_base = civitai.base_model or metadata.base_model
        base_folder = get_base_model_folder(raw_base)
        category = get_primary_category(civitai.tags) if civitai.found else "Other"
        if civitai.creator.strip():
            creator = civitai.creator.strip()
            creator_source = "Civitai"
        else:
            creator = infer_creator_from_existing_folder(root, path, base_folder, category)
            creator_source = "Existing folder" if creator else ""
        row = ScanRow(
            row_id=row_id("organizer", path),
            full_path=path,
            display_path=relative_path(root, path) if rules.reprocess_existing_subfolders else os.path.basename(path),
            sha256=sha,
            size=os.path.getsize(path),
            metadata=metadata,
            civitai=civitai,
            base_folder=base_folder,
            category=category,
            creator_folder_name=creator,
            effective_creator=creator,
            creator_source=creator_source,
            destination_directory=os.path.dirname(path) or root,
            new_full_path=path,
            new_base_name=os.path.splitext(os.path.basename(path))[0],
            proposed_name=os.path.basename(path),
            planning_status=civitai.status,
        )
        rows.append(row)
        progress("Identified", index, total, os.path.basename(path), round(index / max(total, 1) * 100))
    check_cancel(cancel)
    if rows:
        progress("Building dry-run organization plan", total, total, "", 99)
        rows = apply_planning(root, rules, rows, token, client, cancel)
    check_cancel(cancel)
    client.save()
    return ScanBundle("organizer", root, rules, rows, detect_root_context(root).public_dict())


def duplicate_keeper_score(root: str, path: str, organized_paths: Set[str] | None = None) -> float:
    score = 0.0
    parts = [part for part in re.split(r"[\\/]", relative_path(root, path)) if part]
    depth = max(0, len(parts) - 1)
    categories = {
        "character", "style", "concept", "clothing", "base model", "background", "poses", "tool",
        "assets", "vehicle", "buildings", "objects", "animal", "action", "other",
    }
    if len(parts) >= 4 and parts[1].casefold() in categories: score += 420
    elif len(parts) >= 3 and parts[0].casefold() in categories: score += 300
    elif len(parts) >= 2: score += 180
    elif depth >= 1: score += 80
    if organized_paths and norm_path(path) in organized_paths: score += 40
    stem = os.path.splitext(os.path.basename(path))[0]
    if not re.search(r"(?:copy|duplicate|dupe|\(\d+\)|\[\d+\]|_\d{4,}$)", stem, flags=re.I):
        score += 15
    score -= min(len(os.path.basename(path)), 100) / 100.0
    try:
        score -= (os.stat(path).st_mtime_ns % 1_000_000) / 1_000_000_000_000.0
    except OSError:
        pass
    return score


def scan_duplicates(
    root: str,
    cancel: Event | None = None,
    progress: Progress = _noop_progress,
    organized_paths: Set[str] | None = None,
) -> ScanBundle:
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise ValueError("Choose a valid LoRA folder first.")
    files = sorted(walk_files_safe(
        root, lambda name: name.lower().endswith(".safetensors"), True, cancel,
    ), key=str.casefold)
    groups: Dict[str, List[str]] = defaultdict(list)
    total = len(files)
    for index, path in enumerate(files, start=1):
        check_cancel(cancel)
        progress("Hashing exact duplicates", index, total, os.path.basename(path), round(index / max(total, 1) * 100))
        groups[sha256_file(path, cancel)].append(path)
    duplicate_groups = sorted(
        ((sha, paths) for sha, paths in groups.items() if len(paths) > 1),
        key=lambda pair: pair[0].casefold(),
    )
    rows: List[DuplicateRow] = []
    for group_number, (sha, paths) in enumerate(duplicate_groups, start=1):
        paths.sort(key=lambda path: (-duplicate_keeper_score(root, path, organized_paths), path.casefold()))
        keeper = paths[0]
        keeper_relative = relative_path(root, keeper)
        group_name = f"DUP-{group_number:03d}"
        for path in paths:
            is_keeper = norm_path(path) == norm_path(keeper)
            size = os.path.getsize(path) if os.path.exists(path) else 0
            rows.append(DuplicateRow(
                row_id=row_id("duplicates", path, sha),
                file_path=path,
                display_path=relative_path(root, path),
                sha256=sha,
                group=group_name,
                size=size,
                keeper_path=keeper,
                keeper_relative=keeper_relative,
                group_count=len(paths),
                suggested_keeper=is_keeper,
                include=not is_keeper,
                status="Suggested keeper - unchecked" if is_keeper else "Exact duplicate - checked for removal",
            ))
    return ScanBundle("duplicates", root, RuleSet(), rows)
