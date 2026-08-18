from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


@dataclass
class RuleSet:
    rename_files: bool = True
    organize_creators: bool = True
    organize_categories: bool = True
    organize_base_models: bool = True
    group_one_off_creators: bool = True
    group_unidentified: bool = True
    reprocess_existing_subfolders: bool = True

    @classmethod
    def from_dict(cls, value: Dict[str, Any] | None) -> "RuleSet":
        value = value or {}
        return cls(**{
            key: bool(value.get(key, default))
            for key, default in asdict(cls()).items()
        })


@dataclass
class SafeTensorMetadata:
    readable: bool = False
    title: str = ""
    trigger: str = ""
    name: str = ""
    output_name: str = ""
    base_model: str = ""
    model_hash: str = ""
    legacy_hash: str = ""
    identity: str = ""
    identity_source: str = ""


@dataclass
class CivitaiInfo:
    found: bool = False
    model_id: str = ""
    version_id: str = ""
    model_name: str = ""
    version_name: str = ""
    creator: str = ""
    base_model: str = ""
    trained_words: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    model_type: str = ""
    page_url: str = ""
    status: str = "Hash not found on Civitai"
    model_meta_complete: bool = False
    model_lookup_error: str = ""


@dataclass
class CivitaiModelMeta:
    complete: bool = False
    model_name: str = ""
    creator: str = ""
    tags: List[str] = field(default_factory=list)
    model_type: str = ""
    error: str = ""


@dataclass
class ScanRow:
    row_id: str
    full_path: str
    display_path: str
    sha256: str = ""
    size: int = 0
    metadata: SafeTensorMetadata = field(default_factory=SafeTensorMetadata)
    civitai: CivitaiInfo = field(default_factory=CivitaiInfo)
    base_folder: str = "Unknown Base"
    category: str = "Other"
    creator_folder_name: str = ""
    effective_creator: str = ""
    creator_source: str = ""
    prefix_creator_filename: bool = False
    creator_bucket_count: int = 0
    creator_bucket_mode: str = "dedicated"
    is_uncharted: bool = False
    series_mode: bool = False
    series_reason: str = ""
    one_off_synthetic_promotion: bool = False
    include: bool = False
    proposed_name: str = ""
    name_source: str = ""
    destination_directory: str = ""
    new_full_path: str = ""
    new_base_name: str = ""
    collision_without_rename: bool = False
    planning_status: str = ""


@dataclass
class DuplicateRow:
    row_id: str
    file_path: str
    display_path: str
    sha256: str
    group: str
    size: int
    keeper_path: str
    keeper_relative: str
    group_count: int
    suggested_keeper: bool
    include: bool
    status: str


@dataclass
class CleanupRow:
    row_id: str
    cleanup_type: str
    path_value: str
    display_path: str
    is_directory: bool
    size: int
    related_model: str
    reason: str
    include: bool
    status: str = ""


@dataclass
class MoveRecord:
    old_path: str
    new_path: str


@dataclass
class OrganizationOperation:
    model_id: str = ""
    version_id: str = ""
    model_name: str = ""
    creator: str = ""
    files: List[MoveRecord] = field(default_factory=list)


@dataclass
class ScanBundle:
    mode: str
    root: str
    rules: RuleSet
    rows: List[Any]
    root_context: Dict[str, str] = field(default_factory=dict)

    def public_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "root": self.root,
            "rules": asdict(self.rules),
            "root_context": self.root_context,
            "rows": [asdict(row) for row in self.rows],
        }
