from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Event
from typing import Dict, Iterable, List, Set, Tuple

from .civitai import CivitaiClient
from .metadata import read_safetensor_metadata
from .models import CivitaiInfo, RuleSet, ScanRow
from .naming import safe_name, smart_base_name
from .util import check_cancel, norm_path, paths_equal, relative_path, row_id, sha256_file


@dataclass
class Proposal:
    destination_directory: str
    new_base_name: str
    new_file_name: str
    new_full_path: str
    name_source: str
    collision_without_rename: bool


@dataclass
class ExistingCreatorBucket:
    all: List[str]
    dedicated: List[str]
    shared: List[str]


@dataclass(frozen=True)
class RootContext:
    """How much of the normal Base/Category/Creator route already exists."""

    level: str = "library"  # library | base | category
    locked_base: str = ""
    locked_category: str = ""

    def public_dict(self) -> dict[str, str]:
        return {"level": self.level, "locked_base": self.locked_base, "locked_category": self.locked_category}


def detect_root_context(root: str) -> RootContext:
    """Treat the selected source folder as the library root.

    Earlier builds tried to infer whether the selected folder was already a
    Base/Category folder.  That was ambiguous for perfectly valid library
    roots named things such as ``Other`` and could silently skip Base and
    Category routing.  The Organizer now has one deterministic contract: the
    selected source folder is always the root from which enabled routing rules
    are built.
    """

    return RootContext()


def creator_bucket_key(base_model: str, category: str, creator: str) -> str:
    return "|".join((base_model.strip().casefold(), category.strip().casefold(), creator.strip().casefold()))


def destination_directory(
    root: str,
    base_model: str,
    category: str,
    creator: str,
    organize_base_models: bool,
    organize_categories: bool,
    organize_creators: bool,
    root_context: RootContext | None = None,
) -> str:
    # The selected source folder is always the organization root.  Do not
    # infer routing depth from folder names; e.g. a root literally named
    # ``Other`` still needs Base/Category/Creator folders beneath it.
    parts = [root]
    if organize_base_models:
        parts.append(safe_name(base_model, "Unknown Base"))
    if organize_categories:
        parts.append(safe_name(category, "Other"))
    if organize_creators and creator.strip():
        parts.append(safe_name(creator, "Unknown Creator"))
    return os.path.join(*parts)


def _is_taken(path: str, current: str, reserved: Set[str]) -> bool:
    full = norm_path(path)
    if full == norm_path(current):
        return False
    return full in reserved or os.path.exists(path)


def proposed_base(
    root: str,
    row: ScanRow,
    rename_files: bool,
    organize_creators: bool,
    organize_categories: bool,
    organize_base_models: bool,
    reserved: Set[str],
    series_mode: bool,
    series_reason: str,
) -> Proposal:
    current_stem, extension = os.path.splitext(os.path.basename(row.full_path))
    if rename_files:
        choice = smart_base_name(row, series_mode, series_reason)
    else:
        from .naming import NameChoice
        choice = NameChoice(safe_name(current_stem, current_stem), "Original (renaming disabled)")
    base_name = safe_name(choice.base_name, current_stem)
    name_source = choice.source
    creator_folder = row.creator_folder_name or row.effective_creator
    if row.prefix_creator_filename and rename_files and row.effective_creator:
        creator_safe = safe_name(row.effective_creator, "Unknown Creator")
        prefix = creator_safe + "_"
        if not base_name.casefold().startswith(prefix.casefold()):
            base_name = safe_name(prefix + base_name, base_name)
            name_source += " + creator prefix"
    category = row.category or "Other"
    base_folder = row.base_folder or "Unknown Base"
    target_dir = destination_directory(
        root, base_folder, category, creator_folder,
        organize_base_models, organize_categories, organize_creators,
    )
    candidate = os.path.join(target_dir, base_name + extension)
    collision_without_rename = False
    had_collision = False
    if not rename_files and _is_taken(candidate, row.full_path, reserved):
        collision_without_rename = True
    else:
        collision_base = base_name
        number = 2
        while _is_taken(candidate, row.full_path, reserved):
            had_collision = True
            candidate = os.path.join(target_dir, f"{collision_base}_v{number}{extension}")
            number += 1
    if had_collision:
        name_source += " + _vN collision"
    if not collision_without_rename:
        reserved.add(norm_path(candidate))
    return Proposal(
        destination_directory=target_dir,
        new_base_name=os.path.splitext(os.path.basename(candidate))[0],
        new_file_name=os.path.basename(candidate),
        new_full_path=candidate,
        name_source=name_source,
        collision_without_rename=collision_without_rename,
    )


def get_existing_creator_bucket_files(
    root: str,
    base_model: str,
    category: str,
    creator: str,
    organize_base_models: bool,
    organize_categories: bool,
    exclude_paths: Set[str],
) -> ExistingCreatorBucket:
    result = ExistingCreatorBucket([], [], [])
    if not creator.strip():
        return result
    parent = destination_directory(
        root, base_model, category, "", organize_base_models, organize_categories, False,
    )
    creator_safe = safe_name(creator, "Unknown Creator")
    dedicated = os.path.join(parent, creator_safe)
    shared = os.path.join(parent, "Other")
    try:
        files = [os.path.join(dedicated, name) for name in os.listdir(dedicated) if name.lower().endswith(".safetensors")]
    except OSError:
        files = []
    for path in files:
        full = norm_path(path)
        if full not in exclude_paths:
            result.dedicated.append(path)
            result.all.append(path)
    try:
        files = [os.path.join(shared, name) for name in os.listdir(shared) if name.lower().endswith(".safetensors")]
    except OSError:
        files = []
    prefix = (creator_safe + "_").casefold()
    for path in files:
        full = norm_path(path)
        if full not in exclude_paths and os.path.basename(path).casefold().startswith(prefix):
            result.shared.append(path)
            result.all.append(path)
    return result


def _version_key(row: ScanRow) -> str:
    return row.civitai.version_id or row.civitai.version_name or row.sha256


def create_promotion_row(
    path: str,
    root: str,
    creator: str,
    base_folder: str,
    category: str,
    token: str,
    client: CivitaiClient,
    cancel: Event | None,
) -> ScanRow | None:
    if not os.path.isfile(path):
        return None
    creator_safe = safe_name(creator, "Unknown Creator")
    stem = os.path.splitext(os.path.basename(path))[0]
    prefix = creator_safe + "_"
    if not os.path.basename(path).casefold().startswith(prefix.casefold()):
        return None
    clean_stem = stem[min(len(stem), len(creator_safe) + 1):]
    if not clean_stem.strip():
        return None
    metadata = read_safetensor_metadata(path)
    if not metadata.identity:
        metadata.identity = clean_stem
        metadata.identity_source = "Existing one-off filename"
    sha = sha256_file(path, cancel)
    civitai = client.lookup_hash(sha, token, cancel) if sha else CivitaiInfo()
    if not civitai.found:
        civitai = CivitaiInfo(
            found=True,
            creator=creator,
            base_model=base_folder,
            model_meta_complete=True,
            status="Existing one-off ready for creator-folder promotion",
        )
    elif not civitai.creator:
        civitai.creator = creator
    return ScanRow(
        row_id=row_id("organizer", path, "promotion"),
        full_path=path,
        display_path=relative_path(root, path),
        sha256=sha,
        size=os.path.getsize(path),
        metadata=metadata,
        civitai=civitai,
        base_folder=base_folder,
        category=category,
        effective_creator=creator,
        creator_source="Existing one-off",
        creator_folder_name=creator,
        one_off_synthetic_promotion=True,
        destination_directory=os.path.dirname(path),
        new_full_path=path,
        new_base_name=clean_stem,
        proposed_name=os.path.basename(path),
    )


def build_creator_context(
    root: str,
    rules: RuleSet,
    creator: str,
    base_folder: str,
    category: str,
    scan_by_path: Dict[str, ScanRow],
    token: str,
    client: CivitaiClient,
    cancel: Event | None,
) -> Dict[str, Set[str]]:
    models: Dict[str, Set[str]] = {}
    if not creator.strip():
        return models
    candidates = (
        destination_directory(root, base_folder, category, creator, rules.organize_base_models, rules.organize_categories, True),
        destination_directory(root, base_folder, category, creator, True, True, True),
        destination_directory(root, base_folder, category, creator, False, True, True),
        destination_directory(root, base_folder, category, creator, False, False, True),
    )
    seen_dirs: Set[str] = set()
    for directory in candidates:
        check_cancel(cancel)
        normalized = norm_path(directory)
        if normalized in seen_dirs or not os.path.isdir(directory):
            continue
        seen_dirs.add(normalized)
        try:
            files = [os.path.join(directory, name) for name in os.listdir(directory) if name.lower().endswith(".safetensors")]
        except OSError:
            continue
        for path in files:
            check_cancel(cancel)
            scanned = scan_by_path.get(norm_path(path))
            if scanned:
                info = scanned.civitai
                version = _version_key(scanned)
            else:
                try:
                    sha = sha256_file(path, cancel)
                    info = client.lookup_hash(sha, token, cancel)
                    version = info.version_id or info.version_name or sha
                except (OSError, ValueError):
                    continue
            if info and info.found and info.model_id:
                models.setdefault(info.model_id, set()).add(version)
    return models


def apply_planning(
    root: str,
    rules: RuleSet,
    rows: List[ScanRow],
    token: str,
    client: CivitaiClient,
    cancel: Event | None,
) -> List[ScanRow]:
    scan_paths = {norm_path(row.full_path) for row in rows}
    bucket_counts: Dict[str, int] = {}
    bucket_existing: Dict[str, ExistingCreatorBucket] = {}
    bucket_details: Dict[str, Tuple[str, str, str]] = {}

    if rules.group_one_off_creators and rules.organize_creators:
        for row in rows:
            info = row.civitai
            creator = row.effective_creator
            if not (info.found and info.model_meta_complete and row.creator_source == "Civitai" and creator):
                continue
            base = row.base_folder or "Unknown Base"
            category = row.category or "Other"
            key = creator_bucket_key(base, category, creator)
            bucket_counts[key] = bucket_counts.get(key, 0) + 1
            bucket_details.setdefault(key, (base, category, creator))
        for key, (base, category, creator) in bucket_details.items():
            existing = get_existing_creator_bucket_files(
                root, base, category, creator,
                rules.organize_base_models, rules.organize_categories, scan_paths,
            )
            bucket_existing[key] = existing
            bucket_counts[key] += len(existing.all)
        promotions: List[ScanRow] = []
        for key, count in bucket_counts.items():
            if count < 2:
                continue
            base, category, creator = bucket_details[key]
            for path in bucket_existing[key].shared:
                check_cancel(cancel)
                promotion = create_promotion_row(path, root, creator, base, category, token, client, cancel)
                if promotion:
                    promotions.append(promotion)
        rows.extend(promotions)
        for row in rows:
            row.creator_folder_name = row.effective_creator
            row.prefix_creator_filename = False
            row.creator_bucket_count = 0
            row.creator_bucket_mode = "dedicated"
            info = row.civitai
            creator = row.effective_creator
            if not (info.found and info.model_meta_complete and row.creator_source == "Civitai" and creator):
                continue
            key = creator_bucket_key(row.base_folder or "Unknown Base", row.category or "Other", creator)
            count = max(1, bucket_counts.get(key, 1))
            row.creator_bucket_count = count
            if count < 2:
                row.creator_folder_name = "Other"
                row.prefix_creator_filename = True
                row.creator_bucket_mode = "shared"
    else:
        for row in rows:
            row.creator_folder_name = row.effective_creator
            row.prefix_creator_filename = False
            row.creator_bucket_count = 0
            row.creator_bucket_mode = "dedicated"

    current_model_versions: Dict[str, Set[str]] = {}
    for row in rows:
        if row.civitai.found and row.civitai.model_id:
            current_model_versions.setdefault(row.civitai.model_id, set()).add(_version_key(row))

    creator_contexts: Dict[str, Dict[str, Set[str]]] = {}
    if rules.organize_creators and not rules.reprocess_existing_subfolders:
        scan_by_path = {norm_path(row.full_path): row for row in rows}
        for row in rows:
            info = row.civitai
            creator = row.effective_creator
            if not (info.found and creator):
                continue
            base, category = row.base_folder or "Unknown Base", row.category or "Other"
            key = creator_bucket_key(base, category, creator)
            if key not in creator_contexts:
                creator_contexts[key] = build_creator_context(
                    root, rules, creator, base, category, scan_by_path, token, client, cancel,
                )

    reserved: Set[str] = set()
    for row in rows:
        check_cancel(cancel)
        info = row.civitai
        has_civitai = info.found
        has_local_identity = bool(row.metadata.identity.strip())
        folder_creator_fallback = bool(row.effective_creator) and row.creator_source == "Existing folder"
        use_uncharted = (
            rules.group_unidentified and not has_civitai and not row.effective_creator
            and info.status == "Hash not found on Civitai"
        )
        row.is_uncharted = use_uncharted
        if use_uncharted:
            row.category = "Uncharted"
            row.creator_folder_name = ""
            row.prefix_creator_filename = False
        row.include = False
        row.proposed_name = os.path.basename(row.full_path)
        row.name_source = ""
        row.destination_directory = os.path.dirname(row.full_path) or root
        row.new_full_path = row.full_path
        row.new_base_name = os.path.splitext(os.path.basename(row.full_path))[0]
        row.collision_without_rename = False
        if not (has_civitai or has_local_identity or use_uncharted or folder_creator_fallback):
            row.planning_status = info.status
            continue

        current_series = bool(info.model_id and len(current_model_versions.get(info.model_id, set())) > 1)
        existing_series = False
        category = row.category or "Other"
        base = row.base_folder or "Unknown Base"
        creator = row.effective_creator
        context = creator_contexts.get(creator_bucket_key(base, category, creator), {})
        if has_civitai and creator and info.model_id and info.model_id in context:
            versions = context[info.model_id]
            this_version = _version_key(row)
            existing_series = len(versions) > 1 or any(version.casefold() != this_version.casefold() for version in versions)
        row.series_mode = current_series or existing_series
        if current_series and existing_series: row.series_reason = "scan + existing series"
        elif existing_series: row.series_reason = "existing folder series"
        elif current_series: row.series_reason = "scan group"
        else: row.series_reason = ""

        creator_missing = rules.organize_creators and has_civitai and not creator
        routing_incomplete = has_civitai and not info.model_meta_complete and (
            rules.organize_creators or rules.organize_categories
        )
        preserve_dir = creator_missing or routing_incomplete or (not has_civitai and folder_creator_fallback)
        proposal_root = (os.path.dirname(row.full_path) or root) if preserve_dir else root
        proposal = proposed_base(
            proposal_root, row, rules.rename_files,
            rules.organize_creators and has_civitai and bool(creator) and not preserve_dir,
            rules.organize_categories and (has_civitai or use_uncharted) and not preserve_dir,
            rules.organize_base_models and row.base_folder != "Unknown Base" and not preserve_dir,
            reserved, row.series_mode, row.series_reason,
        )
        row.proposed_name = proposal.new_file_name
        row.name_source = proposal.name_source
        row.destination_directory = proposal.destination_directory
        row.new_full_path = proposal.new_full_path
        row.new_base_name = proposal.new_base_name
        row.collision_without_rename = proposal.collision_without_rename
        same_path = paths_equal(row.full_path, row.new_full_path)
        if row.collision_without_rename:
            row.planning_status = "Conflict - destination already has this filename; renaming is disabled"
        elif same_path:
            row.planning_status = (
                "Existing creator folder preserved - creator inferred from folder"
                if not has_civitai and folder_creator_fallback
                else "Already organized" if has_civitai else "Local metadata found - filename already matches"
            )
        elif use_uncharted:
            row.planning_status = (
                f"Ready - unidentified on Civitai; route to {row.base_folder}\\Uncharted"
                if rules.organize_base_models and row.base_folder != "Unknown Base"
                else "Ready - unidentified on Civitai; route to Uncharted"
            )
            if not rules.rename_files: row.planning_status += "; original filename preserved"
            row.include = True
        elif not has_civitai and has_local_identity:
            if creator and row.creator_source == "Existing folder":
                row.planning_status = "Ready - local metadata identity; creator inferred from existing folder; current folder preserved"
            elif info.status.startswith(("API error:", "Civitai HTTP", "Civitai rate limit")):
                row.planning_status = f"Ready - local identity only; {info.status}; current folder preserved"
            else:
                row.planning_status = "Ready - local metadata identity; creator unknown"
            row.include = True
        elif not has_civitai and folder_creator_fallback:
            row.planning_status = "Existing creator folder preserved - creator inferred from folder; Civitai metadata unavailable"
            row.include = not same_path
        elif routing_incomplete:
            detail = info.model_lookup_error or "model metadata lookup incomplete"
            row.planning_status = f"Ready - {detail}; organization routing paused, current folder preserved"
            row.include = True
        elif rules.organize_creators and not creator:
            detail = "Civitai did not provide creator metadata" if info.model_meta_complete else "creator lookup incomplete"
            row.planning_status = f"Ready - {detail}; current folder preserved"
            row.include = True
        elif row.one_off_synthetic_promotion:
            row.planning_status = "Ready - creator reached 2+ LoRAs; promote existing one-off into creator folder"
            row.include = True
        elif rules.group_one_off_creators and rules.organize_creators and row.creator_bucket_mode == "shared":
            row.planning_status = "Ready - one-off creator; shared Other folder + creator-prefixed filename"
            row.include = True
        elif rules.group_one_off_creators and rules.organize_creators and row.creator_bucket_count >= 2:
            row.planning_status = f"Ready - creator has {row.creator_bucket_count} LoRAs in this base/category; dedicated creator folder"
            row.include = True
        elif existing_series:
            row.planning_status = "Ready - matched existing model series"
            row.include = True
        elif current_series:
            row.planning_status = "Ready - same-model versions named consistently"
            row.include = True
        else:
            row.planning_status = "Ready"
            row.include = True
        if not rules.rename_files and row.proposed_name:
            row.name_source = "Original filename (move-only)"
    return rows
