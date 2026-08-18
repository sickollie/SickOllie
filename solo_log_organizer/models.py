from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


TOKENS = ("NAME", "OUTFIT", "BRAND", "SCENE")
PARENT_CATEGORIES = ("outfits", "prompts", "scenes")


@dataclass
class RuleSet:
    remove_blank_lines: bool = True
    remove_structural_headers: bool = True
    strip_numbering: bool = True
    convert_sick_dolls_to_brand: bool = True
    remove_exact_duplicate_lines: bool = True
    organize_by_tokens: bool = True
    polish_filenames: bool = True
    archive_exact_duplicates: bool = True
    # Existing Prompt Core category/subfolder layouts are left in place unless
    # the user explicitly opts into a taxonomy migration.
    reprocess_existing_subfolders: bool = False

    @classmethod
    def from_dict(cls, value: Dict[str, Any] | None) -> "RuleSet":
        value = value or {}
        defaults = cls()
        return cls(**{
            name: bool(value.get(name, getattr(defaults, name)))
            for name in asdict(defaults)
        })


@dataclass
class TokenAnalysis:
    coverage: Dict[str, int]
    occurrences: Dict[str, int]
    present_tokens: List[str]
    full_tokens: List[str]
    mixed_tokens: List[str]
    signature: str
    display: str

    @property
    def is_mixed(self) -> bool:
        return bool(self.mixed_tokens)


@dataclass
class LogRow:
    row_id: str
    full_path: str
    display_path: str
    file_name: str
    raw_sha256: str
    encoding: str
    role: str
    target_slot: str
    token_analysis: TokenAnalysis
    parent_category: str
    destination_group: str
    proposed_name: str
    proposed_relative_path: str
    raw_physical_count: int
    raw_nonblank_count: int
    resolved_count: int
    duplicate_lines_removed: int
    blank_lines_removed: int
    header_lines_removed: int
    numbering_prefixes_stripped: int
    brand_replacements: int
    cleaned_lines: List[str] = field(default_factory=list, repr=False)
    content_hash: str = ""
    themes: List[str] = field(default_factory=list)
    original_sample: str = ""
    resolved_sample: str = ""
    is_exact_duplicate: bool = False
    duplicate_of: str = ""
    is_master: bool = False
    include: bool = True
    status: str = "Ready"
    issues: List[str] = field(default_factory=list)

    def public_dict(self) -> Dict[str, Any]:
        return {
            "row_id": self.row_id,
            "display_path": self.display_path,
            "file_name": self.file_name,
            "encoding": self.encoding,
            "role": self.role,
            "target_slot": self.target_slot,
            "parent_category": self.parent_category,
            "token_signature": self.token_analysis.signature,
            "token_display": self.token_analysis.display,
            "token_coverage": dict(self.token_analysis.coverage),
            "token_occurrences": dict(self.token_analysis.occurrences),
            "is_mixed": self.token_analysis.is_mixed,
            "destination_group": self.destination_group,
            "proposed_name": self.proposed_name,
            "proposed_relative_path": self.proposed_relative_path,
            "raw_physical_count": self.raw_physical_count,
            "raw_nonblank_count": self.raw_nonblank_count,
            "resolved_count": self.resolved_count,
            "duplicate_lines_removed": self.duplicate_lines_removed,
            "blank_lines_removed": self.blank_lines_removed,
            "header_lines_removed": self.header_lines_removed,
            "numbering_prefixes_stripped": self.numbering_prefixes_stripped,
            "brand_replacements": self.brand_replacements,
            "themes": list(self.themes),
            "original_sample": self.original_sample,
            "resolved_sample": self.resolved_sample,
            "is_exact_duplicate": self.is_exact_duplicate,
            "duplicate_of": self.duplicate_of,
            "is_master": self.is_master,
            "include": self.include,
            "status": self.status,
            "issues": list(self.issues),
            "issues_text": "; ".join(self.issues),
        }


@dataclass
class ScanBundle:
    root: str
    rules: RuleSet
    rows: List[LogRow]

    def public_dict(self) -> Dict[str, Any]:
        return {
            "mode": "organizer",
            "root": self.root,
            "rules": asdict(self.rules),
            "rows": [row.public_dict() for row in self.rows],
        }
