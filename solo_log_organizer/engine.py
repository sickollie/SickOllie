from __future__ import annotations

import csv
import io
import json
import os
import re
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from typing import Any, Callable, Dict, Iterable, List, Mapping, Sequence

from .models import PARENT_CATEGORIES, TOKENS, LogRow, RuleSet, ScanBundle, TokenAnalysis
from .util import (
    atomic_json_write,
    atomic_text_write_no_replace,
    check_cancel,
    content_hash,
    ensure_within,
    move_no_replace,
    norm_line,
    norm_path,
    row_id,
    sha256_bytes,
    sha256_file,
    walk_text_files,
)


Progress = Callable[[str, int, int, str, int], None]


def _noop_progress(stage: str, current: int, total: int, filename: str, percent: int) -> None:
    del stage, current, total, filename, percent


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def read_prompt_text(path: str) -> tuple[bytes, str, str]:
    with open(path, "rb") as stream:
        raw = stream.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw, raw.decode("utf-8-sig"), "UTF-8 BOM"
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw, raw.decode("utf-16"), "UTF-16"
    try:
        return raw, raw.decode("utf-8"), "UTF-8"
    except UnicodeDecodeError:
        return raw, raw.decode("cp1252"), "Windows-1252"


def clean_prompt_text(text: str, rules: RuleSet) -> Dict[str, Any]:
    raw_lines = text.splitlines()
    cleaned: List[str] = []
    seen: set[str] = set()
    counters = {
        "blank_lines_removed": 0,
        "header_lines_removed": 0,
        "numbering_prefixes_stripped": 0,
        "brand_replacements": 0,
        "duplicate_lines_removed": 0,
    }
    raw_nonblank = 0
    nonblank_seen = 0
    brand_pattern = re.compile(r"(?<![A-Za-z0-9])sick[\s_-]+dolls(?![A-Za-z0-9])", re.IGNORECASE)

    for raw_line in raw_lines:
        line = raw_line.strip()
        if not line:
            if rules.remove_blank_lines:
                counters["blank_lines_removed"] += 1
                continue
        else:
            raw_nonblank += 1
            nonblank_seen += 1

        if rules.remove_structural_headers and line:
            is_scene_heading = bool(re.match(r"^SCENE\s+\d{1,3}\s*(?:—|–|-)\s*\S+", line))
            is_intro_heading = nonblank_seen <= 5 and bool(
                re.match(r"^(?:Approach|Description|Notes?|Summary)\s*:", line, re.IGNORECASE)
            )
            is_title_heading = nonblank_seen <= 2 and bool(
                re.fullmatch(r"[A-Z0-9\s\W]+", line)
                and re.search(r"\b(?:PROMPT|OUTFIT|SCENE|TYPOGRAPHY)\s+(?:LOG|LIBRARY)\b", line, re.IGNORECASE)
            )
            if is_scene_heading or is_intro_heading or is_title_heading:
                counters["header_lines_removed"] += 1
                continue

        if rules.strip_numbering:
            stripped, count = re.subn(r"^\s*\d{1,5}\s*[.)]\s+", "", line)
            if count:
                line = stripped
                counters["numbering_prefixes_stripped"] += 1

        if rules.convert_sick_dolls_to_brand and line:
            matches = len(brand_pattern.findall(line))
            if matches:
                counters["brand_replacements"] += matches
                line = brand_pattern.sub("BRAND", line)

        line = line.strip()
        if not line and rules.remove_blank_lines:
            counters["blank_lines_removed"] += 1
            continue
        if rules.remove_exact_duplicate_lines and line:
            key = norm_line(line)
            if key in seen:
                counters["duplicate_lines_removed"] += 1
                continue
            seen.add(key)
        cleaned.append(line)

    return {
        "raw_physical_count": len(raw_lines),
        "raw_nonblank_count": raw_nonblank,
        "cleaned_lines": cleaned,
        "resolved_count": len(cleaned),
        **counters,
    }


def analyze_tokens(lines: Sequence[str]) -> TokenAnalysis:
    coverage: Dict[str, int] = {}
    occurrences: Dict[str, int] = {}
    present: List[str] = []
    full: List[str] = []
    mixed: List[str] = []
    display: List[str] = []
    line_count = len(lines)
    for token in TOKENS:
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(token)}(?![A-Za-z0-9_])")
        counts = [len(pattern.findall(line)) for line in lines]
        covered = sum(1 for count in counts if count)
        coverage[token] = covered
        occurrences[token] = sum(counts)
        if not covered:
            continue
        present.append(token)
        if line_count and covered == line_count:
            full.append(token)
            display.append(token)
        else:
            mixed.append(token)
            display.append(f"{token} {covered}/{line_count}")
    signature = " + ".join(present) if present else "Token Free"
    return TokenAnalysis(coverage, occurrences, present, full, mixed, signature, ", ".join(display) or "None")


def _match_ratio(lines: Sequence[str], pattern: str) -> float:
    if not lines:
        return 0.0
    expression = re.compile(pattern, re.IGNORECASE)
    return sum(1 for line in lines if expression.search(line)) / len(lines)


def analyze_role(relative_path: str, lines: Sequence[str]) -> tuple[str, str, float]:
    subject = r"\b(?:young woman|adult woman|young adult woman|two women|woman|women|man|girl|girls|portrait|photograph|photo|selfie|1girl)\b"
    clothing = r"\b(?:wearing|outfit|dress|tank|tee|shirt|top|bodysuit|jeans|shorts|skirt|robe|lingerie|socks|stockings|jacket|hoodie|sweater|cardigan|corset|bra|briefs|bikini|swimsuit|camisole|blouse|heels|boots|sneakers)\b"
    scene = r"\b(?:orchard|fields?|cliffs?|cove|beach|forest|mountains?|village|street|room|bedroom|kitchen|studio|landscape|countryside|sunrise|sunset|daylight|night|background|location|setting|shoreline|desert|waterfall)\b"
    poster = r"\b(?:poster|typograph|headline|title text|text portion|lettering|wordmark|masthead|magazine cover|readable text)\b"
    body_style = r"\b(?:skin finish|body paint|pearlescent|oil-slick sheen|body gloss|glow tracing the body|prismatic shimmer|metallic radiance|skin adding extra reflective depth)\b"
    subject_ratio = _match_ratio(lines, subject)
    if lines:
        name_pattern = re.compile(r"(?<![A-Za-z0-9_])NAME(?![A-Za-z0-9_])")
        name_ratio = sum(1 for line in lines if name_pattern.search(line)) / len(lines)
        subject_ratio = max(subject_ratio, name_ratio)
    clothing_ratio = _match_ratio(lines, clothing)
    scene_ratio = _match_ratio(lines, scene)
    poster_ratio = _match_ratio(lines, poster)
    body_ratio = _match_ratio(lines, body_style)
    prefix_ratio = sum(1 for line in lines if re.search(r",\s*$", line)) / len(lines) if lines else 0.0
    suffix_ratio = sum(1 for line in lines if re.match(r'^[”“"\']', line)) / len(lines) if lines else 0.0
    path_lower = relative_path.casefold()
    if lines and suffix_ratio >= 0.60 and subject_ratio < 0.25:
        return "Typography Suffix", "PROMPT_FRAGMENT", poster_ratio
    if lines and prefix_ratio >= 0.60 and poster_ratio >= 0.40:
        return "Prompt Prefix", "PROMPT_FRAGMENT", poster_ratio
    if body_ratio >= 0.35 or re.search(r"sicklight.*body.?styling", path_lower):
        return "Body Styling", "OUTFIT", poster_ratio
    if subject_ratio < 0.20 and (re.search(r"scene|location", path_lower) or scene_ratio >= 0.55) and clothing_ratio < 0.30:
        return "Scene Values", "SCENE", poster_ratio
    if subject_ratio < 0.20 and (re.search(r"outfit|privatewear|hotwear|coverage", path_lower) or clothing_ratio >= 0.35):
        return "Outfit Values", "OUTFIT", poster_ratio
    return "Full Prompts", "PROMPT", poster_ratio


def load_theme_rules() -> List[Dict[str, str]]:
    path = Path(__file__).resolve().parent / "data" / "theme_rules.json"
    try:
        with open(path, "r", encoding="utf-8-sig") as stream:
            value = json.load(stream)
        return [item for item in value if isinstance(item, dict) and item.get("tag") and item.get("pattern")]
    except (OSError, ValueError, TypeError):
        return []


def detect_themes(relative_path: str, lines: Sequence[str], rules: Sequence[Mapping[str, str]]) -> List[str]:
    haystack = relative_path + " " + " ".join(lines[:25])
    result: List[str] = []
    for rule in rules:
        try:
            if re.search(str(rule["pattern"]), haystack):
                result.append(str(rule["tag"]))
        except re.error:
            continue
        if len(result) >= 6:
            break
    return result


_THEME_LABELS = {
    "faceout": "Faceout", "vintage-magazine": "Vintage Magazine",
    "cosmic-vaporwave": "Cosmic Vaporwave", "sicktype": "Sicktype",
    "roadtrip": "Roadtrip", "y2k": "Y2K", "suburban": "Suburban",
    "psychedelic": "Psychedelic", "neon": "Neon", "high-key-flash": "High-Key Flash",
    "analog": "Analog", "sicklight": "Sicklight", "alt-egirl": "E-Girl",
    "cute": "Cute", "privatewear": "Privatewear", "partial-coverage": "Partial Coverage",
    "crop-safe": "Crop-Safe", "dataset": "Dataset", "multi-subject": "Multi-Subject",
    "character": "Character",
}


def parent_category(role: str) -> str:
    if role in {"Outfit Values", "Body Styling"}:
        return "outfits"
    if role == "Scene Values":
        return "scenes"
    return "prompts"


def destination_group(
    role: str,
    tokens: TokenAnalysis,
    is_master: bool = False,
) -> str:
    """Return the small, task-oriented folder bucket for a prompt log.

    Exact placeholder contracts remain visible in the filename, preview, and
    audit. Keeping that metadata out of the directory tree prevents every
    NAME/OUTFIT/BRAND/SCENE combination from becoming another folder.
    """
    category = parent_category(role)
    if tokens.is_mixed:
        return "Needs Review"
    if category == "outfits":
        if is_master:
            return "Masters"
        return "Body Style" if role == "Body Styling" else "Values"
    if category == "scenes":
        return "Masters" if is_master else "Values"
    if role in {"Prompt Prefix", "Typography Suffix"}:
        return "Fragments"
    if "SCENE" in tokens.present_tokens:
        return "Scene Templates"
    if is_master:
        return "Masters"
    if tokens.present_tokens:
        return "Templates"
    return "Standard"


def _existing_prompt_core_location(relative_path: str) -> tuple[str, str] | None:
    """Return a current category/group pair for an already managed log."""
    parts = Path(relative_path).parts
    if len(parts) < 3:
        return None
    category = parts[0].casefold()
    if category not in PARENT_CATEGORIES:
        return None
    # SOLO intentionally supports one physical grouping level. A legacy nested
    # path is only flattened when the explicit reprocess option is enabled.
    if len(parts) != 3:
        return None
    group = str(parts[1]).strip()
    return (category, group) if group else None


def _pretty_word(word: str) -> str:
    lower = word.casefold()
    special = {
        "y2k": "Y2K", "35mm": "35mm", "uv": "UV", "fp8": "FP8",
        "lora": "LoRA", "sicktype": "Sicktype", "sicklight": "Sicklight",
        "faceout": "Faceout", "egirl": "E-Girl", "e-girl": "E-Girl",
    }
    if lower in special:
        return special[lower]
    if re.fullmatch(r"v\d+(?:\.\d+)*", lower):
        return lower
    return lower[:1].upper() + lower[1:]


def polished_title(
    original_name: str,
    resolved_count: int,
    role: str,
    tokens: TokenAnalysis,
    themes: Sequence[str],
) -> str:
    stem = Path(original_name).stem
    # Names produced by SOLO are deliberately idempotent. Recover the title
    # before stripping descriptor words so a second scan never grows labels
    # such as "Mixed Mixed" or "Prefix Prefix" and never changes title casing.
    generated_parts = re.split(r"\s+[—–]\s+", stem)
    if len(generated_parts) >= 3 and re.fullmatch(r"\d+", generated_parts[-1].strip()):
        descriptor = " ".join(generated_parts[1:-1])
        if re.search(
            r"\b(?:NAME|OUTFIT|BRAND|SCENE|token\s+free|mixed|prefix(?:es)?|suffix(?:es)?|values?|body\s+style|master|variant\s+\d+)\b",
            descriptor,
            re.IGNORECASE,
        ):
            prior_title = generated_parts[0].strip(" ._-—")
            if prior_title:
                return prior_title[:96].rstrip(" ._-—")
    stem = re.sub(r"\(\s*\d+\s*\)\s*$", " ", stem)
    stem = re.sub(r"(?i)no[\s_-]+sick[\s_-]+dolls", "unbranded", stem)
    stem = re.sub(r"(?i)no[\s_-]+brand", "unbranded", stem)
    stem = re.sub(r"(?i)(?<![A-Za-z0-9])sick[\s_-]+dolls(?![A-Za-z0-9])", "BRAND", stem)
    stem = re.sub(r"(?<!\d)\d{2,4}\s*-\s*\d{2,4}(?!\d)", " ", stem)
    stem = re.sub(r"[\[\]{}()]", " ", stem)
    stem = re.sub(r"[_–—]+", " ", stem)
    stem = re.sub(r"\s+-\s+|-(?=\d)|(?<=\d)-", " ", stem)
    words = re.findall(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?", stem)
    generic = {
        "prompt", "prompts", "log", "logs", "library", "compatible", "complete",
        "all", "master", "merged", "final", "revised", "redo", "updated", "update",
        "copy", "fresh", "new",
    }
    role_noise = {
        "outfit", "outfits", "scene", "scenes", "values", "value", "inserts", "insert",
    } if role != "Full Prompts" else set()
    result: List[str] = []
    for index, word in enumerate(words):
        lower = word.casefold()
        upper = word.upper()
        if lower in generic or lower in role_noise:
            continue
        if upper in tokens.present_tokens:
            continue
        if re.fullmatch(r"\d{1,5}", word):
            number = int(word)
            if number == resolved_count or not 1900 <= number <= 2099 or index >= len(words) - 2:
                continue
        result.append(_pretty_word(word))
    if not result:
        for theme in themes:
            if theme in _THEME_LABELS:
                result = [_THEME_LABELS[theme]]
                break
    if not result:
        fallback = {
            "Outfit Values": "Outfit Collection",
            "Body Styling": "Body Style Collection",
            "Scene Values": "Scene Collection",
            "Prompt Prefix": "Prompt Prefixes",
            "Typography Suffix": "Typography Suffixes",
        }
        result = [fallback.get(role, "Prompt Set")]
    title = " ".join(result[:10]).strip(" ._-—")
    return title[:96].rstrip(" ._-—") or "Prompt Set"


def filename_descriptor(role: str, tokens: TokenAnalysis, is_master: bool = False) -> str:
    signature = tokens.signature
    if role == "Outfit Values":
        descriptor = "OUTFIT Values"
    elif role == "Body Styling":
        descriptor = "OUTFIT Body Style"
    elif role == "Scene Values":
        descriptor = "SCENE Values"
    elif role == "Prompt Prefix":
        descriptor = f"{signature} Prefix"
    elif role == "Typography Suffix":
        descriptor = f"{signature} Suffix"
    else:
        descriptor = f"{signature} Mixed" if tokens.is_mixed else signature
    return f"{descriptor} Master" if is_master else descriptor


def safe_component(value: str, fallback: str, limit: int = 120) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned or cleaned in {".", ".."}:
        cleaned = fallback
    if cleaned.casefold() in {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}:
        cleaned = "_" + cleaned
    return cleaned[:limit].rstrip(" .") or fallback


def polished_filename(
    original_name: str,
    resolved_count: int,
    role: str,
    tokens: TokenAnalysis,
    themes: Sequence[str],
    is_master: bool = False,
) -> str:
    title = polished_title(original_name, resolved_count, role, tokens, themes)
    descriptor = filename_descriptor(role, tokens, is_master)
    return safe_component(f"{title} — {descriptor} — {resolved_count}.txt", "Prompt Set.txt", 180)


def _variant_name(name: str, number: int) -> str:
    stem, suffix = os.path.splitext(name)
    parts = stem.rsplit(" — ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return f"{parts[0]} — Variant {number} — {parts[1]}{suffix}"
    return f"{stem} — Variant {number}{suffix}"


def _sample(lines: Sequence[str], maximum_lines: int = 12, maximum_chars: int = 6000) -> str:
    value = "\n".join(lines[:maximum_lines])
    if len(lines) > maximum_lines:
        value += f"\n\n… {len(lines) - maximum_lines} more resolved lines"
    return value[:maximum_chars]


def _is_master_name(name: str) -> bool:
    stem = Path(name).stem
    return bool(re.search(
        r"(?:^|[ _-])(?:master|complete)(?:[ _-]|$)|all[ _-]+prompts|outfits?[ _-]+full|[ _-]merged(?:[ _-]|$)|^00_MASTER__",
        stem,
        re.IGNORECASE,
    ))


def analyze_file(root: str, path: str, rules: RuleSet, theme_rules: Sequence[Mapping[str, str]]) -> LogRow:
    raw, text, encoding = read_prompt_text(path)
    relative = os.path.relpath(path, root)
    cleaned = clean_prompt_text(text, rules)
    lines = list(cleaned["cleaned_lines"])
    tokens = analyze_tokens(lines)
    role, target_slot, _poster_ratio = analyze_role(relative, lines)
    themes = detect_themes(relative, lines, theme_rules)
    is_master = _is_master_name(os.path.basename(path))
    category = parent_category(role)
    group = destination_group(role, tokens, is_master)
    current_location = _existing_prompt_core_location(relative)
    if rules.organize_by_tokens and current_location and not rules.reprocess_existing_subfolders:
        category, group = current_location
    proposed_name = polished_filename(os.path.basename(path), len(lines), role, tokens, themes, is_master)
    if not rules.polish_filenames:
        proposed_name = safe_component(os.path.basename(path), "Prompt Set.txt", 180)
        if not proposed_name.casefold().endswith(".txt"):
            proposed_name += ".txt"
    target_directory = os.path.join(category, group) if rules.organize_by_tokens else os.path.dirname(relative)
    proposed_relative = os.path.join(target_directory, proposed_name) if target_directory else proposed_name
    issues: List[str] = []
    cleanup_labels = (
        ("duplicate_lines_removed", "duplicate line(s)"),
        ("blank_lines_removed", "blank line(s)"),
        ("header_lines_removed", "structural header(s)"),
        ("numbering_prefixes_stripped", "number prefix(es)"),
        ("brand_replacements", "SICK DOLLS → BRAND replacement(s)"),
    )
    for key, label in cleanup_labels:
        if cleaned[key]:
            issues.append(f"{cleaned[key]} {label}")
    if tokens.is_mixed:
        issues.append("mixed token coverage: " + tokens.display)
    if encoding == "Windows-1252":
        issues.append("legacy encoding will be normalized to UTF-8")
    if not lines:
        issues.append("no usable prompt lines")
    output_text = "\n".join(lines) + ("\n" if lines else "")
    changed = raw != output_text.encode("utf-8") or norm_path(os.path.join(root, relative)) != norm_path(os.path.join(root, proposed_relative))
    status = "Ready" if changed else "Already organized"
    if not lines:
        status = "No usable lines"
    return LogRow(
        row_id=row_id(path), full_path=os.path.abspath(path), display_path=relative,
        file_name=os.path.basename(path), raw_sha256=sha256_bytes(raw), encoding=encoding,
        role=role, target_slot=target_slot, token_analysis=tokens,
        parent_category=category, destination_group=group, proposed_name=proposed_name,
        proposed_relative_path=proposed_relative,
        raw_physical_count=int(cleaned["raw_physical_count"]),
        raw_nonblank_count=int(cleaned["raw_nonblank_count"]),
        resolved_count=len(lines), duplicate_lines_removed=int(cleaned["duplicate_lines_removed"]),
        blank_lines_removed=int(cleaned["blank_lines_removed"]),
        header_lines_removed=int(cleaned["header_lines_removed"]),
        numbering_prefixes_stripped=int(cleaned["numbering_prefixes_stripped"]),
        brand_replacements=int(cleaned["brand_replacements"]), cleaned_lines=lines,
        content_hash=content_hash(lines), themes=themes,
        original_sample=_sample(text.splitlines()), resolved_sample=_sample(lines),
        is_master=is_master, include=changed and bool(lines), status=status, issues=issues,
    )


def _mark_exact_duplicates(rows: Sequence[LogRow], rules: RuleSet) -> None:
    groups: Dict[str, List[LogRow]] = {}
    for row in rows:
        if row.resolved_count:
            groups.setdefault(row.content_hash, []).append(row)
    for copies in groups.values():
        if len(copies) < 2:
            continue
        ordered = sorted(
            copies,
            key=lambda row: (
                not any(
                    row.display_path.casefold().startswith(category + os.sep.casefold())
                    for category in PARENT_CATEGORIES
                ),
                len(row.display_path), row.display_path.casefold(),
            ),
        )
        keeper = ordered[0]
        for duplicate in ordered[1:]:
            duplicate.is_exact_duplicate = True
            duplicate.duplicate_of = keeper.display_path
            duplicate.include = rules.archive_exact_duplicates
            duplicate.status = "Exact duplicate — archive on Apply" if duplicate.include else "Exact duplicate — review"
            duplicate.issues.append("exact duplicate of " + keeper.display_path)


def _resolve_preview_collisions(root: str, rows: Sequence[LogRow]) -> None:
    planned: set[str] = set()
    for row in sorted(rows, key=lambda item: item.display_path.casefold()):
        if row.is_exact_duplicate or not row.resolved_count:
            continue
        directory = os.path.dirname(row.proposed_relative_path)
        original = row.proposed_name
        number = 1
        while True:
            name = original if number == 1 else _variant_name(original, number)
            relative = os.path.join(directory, name) if directory else name
            target = os.path.abspath(os.path.join(root, relative))
            key = norm_path(target)
            same_source = key == norm_path(row.full_path)
            if key not in planned and (not os.path.lexists(target) or same_source):
                row.proposed_name = name
                row.proposed_relative_path = relative
                planned.add(key)
                break
            number += 1


def _finalize_preview_state(root: str, rows: Sequence[LogRow]) -> None:
    """Recalculate action state after duplicate and collision planning.

    Collision resolution can restore an already-organized file's existing
    ``Variant N`` path. Before v0.3 that row kept the stale pre-collision
    ``Ready`` flag forever, even though Apply had no remaining work to do.
    """
    for row in rows:
        if row.role == "Unreadable" or row.status.startswith("FAILED"):
            row.include = False
            continue
        if not row.resolved_count:
            row.include = False
            row.status = "No usable lines"
            continue
        if row.is_exact_duplicate:
            continue
        target = os.path.abspath(os.path.join(root, row.proposed_relative_path))
        output_sha = sha256_bytes(_output_text(row.cleaned_lines).encode("utf-8"))
        changed = norm_path(row.full_path) != norm_path(target) or row.raw_sha256 != output_sha
        row.include = changed
        row.status = "Ready" if changed else "Already organized"


def scan_logs(
    root: str,
    rules: RuleSet | None = None,
    cancel: Event | None = None,
    progress: Progress = _noop_progress,
) -> ScanBundle:
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise ValueError("Choose a valid prompt-log folder first.")
    selected_rules = rules or RuleSet()
    files = sorted(walk_text_files(root, cancel), key=str.casefold)
    theme_rules = load_theme_rules()
    rows: List[LogRow] = []
    total = len(files)
    for index, path in enumerate(files, start=1):
        check_cancel(cancel)
        progress("Analyzing prompt logs", index, total, os.path.basename(path), round(index / max(total, 1) * 92))
        try:
            rows.append(analyze_file(root, path, selected_rules, theme_rules))
        except Exception as exc:
            relative = os.path.relpath(path, root)
            rows.append(LogRow(
                row_id=row_id(path), full_path=os.path.abspath(path), display_path=relative,
                file_name=os.path.basename(path), raw_sha256="", encoding="Unknown",
                role="Unreadable", target_slot="", token_analysis=analyze_tokens([]),
                parent_category="prompts", destination_group="Uncharted", proposed_name=os.path.basename(path),
                proposed_relative_path=relative, raw_physical_count=0, raw_nonblank_count=0,
                resolved_count=0, duplicate_lines_removed=0, blank_lines_removed=0,
                header_lines_removed=0, numbering_prefixes_stripped=0, brand_replacements=0,
                include=False, status="FAILED: " + str(exc), issues=["analysis error: " + str(exc)],
            ))
    check_cancel(cancel)
    progress("Resolving duplicates", total, total, "", 96)
    _mark_exact_duplicates(rows, selected_rules)
    _resolve_preview_collisions(root, rows)
    _finalize_preview_state(root, rows)
    progress("Building preview", total, total, "", 100)
    return ScanBundle(root, selected_rules, rows)


def _is_link_like(path: str) -> bool:
    is_junction = getattr(os.path, "isjunction", None)
    return os.path.islink(path) or bool(is_junction and is_junction(path))


def _protected_empty_folder(root: str, path: str) -> bool:
    if norm_path(path) == norm_path(root):
        return True
    if norm_path(os.path.dirname(path)) != norm_path(root):
        return False
    return os.path.basename(path).casefold() in {
        *(category.casefold() for category in PARENT_CATEGORIES),
        "_solo_log_organizer",
    }


def find_empty_folders(root: str) -> List[str]:
    """Return folders that would be empty after a bottom-up cleanup.

    The selected root and Prompt Core's three required parent categories are
    always preserved. Symlinks/junction-like entries block removal.
    """
    root = os.path.abspath(os.path.expanduser(root))
    if not os.path.isdir(root):
        raise ValueError("Choose a valid prompt-log folder first.")
    removable: set[str] = set()
    relatives: List[str] = []
    for current, _directories, _files in os.walk(root, topdown=False, followlinks=False):
        current = os.path.abspath(current)
        if _protected_empty_folder(root, current) or _is_link_like(current):
            continue
        try:
            entries = list(os.scandir(current))
        except OSError:
            continue
        can_remove = True
        for entry in entries:
            try:
                child_key = norm_path(entry.path)
                if entry.is_dir(follow_symlinks=False) and not _is_link_like(entry.path) and child_key in removable:
                    continue
            except OSError:
                pass
            can_remove = False
            break
        if can_remove:
            removable.add(norm_path(current))
            relatives.append(os.path.relpath(current, root))
    return sorted(relatives, key=lambda value: (value.count(os.sep), value.casefold()), reverse=True)


def remove_empty_folders(root: str, relative_paths: Iterable[str]) -> Dict[str, Any]:
    """Remove only the exact, revalidated empty folders confirmed by the UI."""
    root = os.path.abspath(os.path.expanduser(root))
    if not os.path.isdir(root):
        raise ValueError("Choose a valid prompt-log folder first.")
    requested = list(dict.fromkeys(str(value) for value in relative_paths))
    if len(requested) > 10000:
        raise ValueError("Too many empty-folder cleanup targets were requested.")
    candidates: List[tuple[str, str]] = []
    for relative in requested:
        candidate = ensure_within(root, os.path.join(root, relative))
        if _protected_empty_folder(root, candidate):
            continue
        candidates.append((relative, candidate))
    candidates.sort(key=lambda item: (item[0].count(os.sep), item[0].casefold()), reverse=True)
    removed: List[str] = []
    skipped: List[str] = []
    for relative, candidate in candidates:
        if not os.path.isdir(candidate) or _is_link_like(candidate):
            skipped.append(relative)
            continue
        try:
            os.rmdir(candidate)
            removed.append(relative)
        except OSError:
            skipped.append(relative)
    return {
        "removed": len(removed),
        "skipped": len(skipped),
        "removed_folders": removed,
        "skipped_folders": skipped,
        "message": f"Empty-folder cleanup finished. {len(removed)} removed, {len(skipped)} skipped because they were no longer empty or accessible.",
    }


def latest_undo_manifest(manifests_dir: str | Path) -> Path | None:
    directory = Path(manifests_dir)
    try:
        candidates = [path for path in directory.glob("organization-*.json") if path.is_file()]
        return max(candidates, key=lambda path: path.stat().st_mtime_ns) if candidates else None
    except OSError:
        return None


def _write_manifest(path: Path, payload: Mapping[str, Any]) -> None:
    atomic_json_write(path, dict(payload))


def _output_text(lines: Sequence[str]) -> str:
    return "\n".join(lines) + ("\n" if lines else "")


def apply_changes(
    bundle: ScanBundle,
    selected_ids: Iterable[str],
    edits: Mapping[str, Mapping[str, Any]] | None,
    manifests_dir: str | Path,
) -> Dict[str, Any]:
    selected = set(selected_ids)
    rows = [row for row in bundle.rows if row.row_id in selected]
    if not rows:
        raise ValueError("There are no checked log changes to apply.")
    if any(row.role == "Unreadable" or not row.resolved_count for row in rows):
        raise ValueError("Unreadable or empty logs cannot be applied.")
    root = os.path.abspath(bundle.root)
    edits = edits or {}
    by_relative = {row.display_path: row for row in bundle.rows}

    # Every freshness and keeper check finishes before the first mutation.
    for row in rows:
        source = ensure_within(root, row.full_path)
        if not os.path.isfile(source) or sha256_file(source) != row.raw_sha256:
            raise ValueError("A selected log changed after scanning. Nothing was changed: " + source)
        if row.is_exact_duplicate:
            keeper = by_relative.get(row.duplicate_of)
            if keeper is None or not os.path.isfile(keeper.full_path) or sha256_file(keeper.full_path) != keeper.raw_sha256:
                raise ValueError("The verified duplicate keeper changed or disappeared. Nothing was changed.")

    run_id = _stamp()
    archive_root = ensure_within(root, os.path.join(root, "_SOLO_Log_Organizer", "Archive", run_id))
    operations: List[Dict[str, Any]] = []
    selected_sources = {norm_path(row.full_path) for row in rows}
    output_targets: set[str] = set()
    for row in rows:
        override = edits.get(row.row_id) or {}
        source = ensure_within(root, row.full_path)
        archive = ensure_within(root, os.path.join(archive_root, row.display_path))
        output_path = ""
        output_sha = ""
        proposed_name = row.proposed_name
        proposed_category = row.parent_category
        proposed_group = row.destination_group
        if not (row.is_exact_duplicate and bundle.rules.archive_exact_duplicates):
            proposed_name = safe_component(str(override.get("proposed_name", proposed_name)), "Prompt Set.txt", 180)
            if not proposed_name.casefold().endswith(".txt"):
                proposed_name += ".txt"
            if bundle.rules.organize_by_tokens:
                proposed_category = str(override.get("parent_category", proposed_category)).strip().casefold()
                if proposed_category not in PARENT_CATEGORIES:
                    raise ValueError(
                        "Category must be one of outfits, prompts, or scenes: " + proposed_category
                    )
                proposed_group = safe_component(str(override.get("destination_group", proposed_group)), "Token Free", 90)
                relative_output = os.path.join(proposed_category, proposed_group, proposed_name)
            else:
                relative_output = os.path.join(os.path.dirname(row.display_path), proposed_name)
            output_path = ensure_within(root, os.path.join(root, relative_output))
            output_key = norm_path(output_path)
            if output_key in output_targets:
                raise FileExistsError("Two selected logs target the same output: " + output_path)
            output_targets.add(output_key)
            if os.path.lexists(output_path) and output_key not in selected_sources:
                raise FileExistsError("Destination already exists: " + output_path)
            output_sha = sha256_bytes(_output_text(row.cleaned_lines).encode("utf-8"))
        operations.append({
            "row_id": row.row_id,
            "source": source,
            "archive": archive,
            "output": output_path,
            "output_sha256": output_sha,
            "original_sha256": row.raw_sha256,
            "duplicate": bool(row.is_exact_duplicate and bundle.rules.archive_exact_duplicates),
            "proposed_name": proposed_name,
            "parent_category": proposed_category,
            "destination_group": proposed_group,
        })

    manifest_directory = Path(manifests_dir)
    manifest_directory.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_directory / f"organization-{run_id}.json"
    manifest: Dict[str, Any] = {
        "schemaVersion": 2,
        "app": "SOLO Log Organizer",
        "createdAt": _now(),
        "state": "planned",
        "root": root,
        "rules": asdict(bundle.rules),
        "operations": operations,
    }
    _write_manifest(manifest_path, manifest)
    archived: List[Dict[str, Any]] = []
    written: List[Dict[str, Any]] = []
    try:
        for operation in operations:
            Path(operation["archive"]).parent.mkdir(parents=True, exist_ok=True)
            move_no_replace(operation["source"], operation["archive"])
            archived.append(operation)
        for operation, row in zip(operations, rows):
            if not operation["output"]:
                continue
            atomic_text_write_no_replace(operation["output"], _output_text(row.cleaned_lines))
            written.append(operation)
        manifest["state"] = "complete"
        manifest["completedAt"] = _now()
        _write_manifest(manifest_path, manifest)
    except Exception as exc:
        rollback_errors: List[str] = []
        for operation in reversed(written):
            try:
                if os.path.lexists(operation["output"]):
                    if os.path.isfile(operation["output"]) and sha256_file(operation["output"]) == operation["output_sha256"]:
                        os.unlink(operation["output"])
                    else:
                        rollback_errors.append("Generated output changed before rollback: " + operation["output"])
            except Exception as rollback_exc:
                rollback_errors.append(str(rollback_exc))
        for operation in reversed(archived):
            try:
                if not os.path.lexists(operation["archive"]):
                    rollback_errors.append("Archived original is missing: " + operation["archive"])
                elif os.path.lexists(operation["source"]):
                    rollback_errors.append("Original path became occupied during rollback: " + operation["source"])
                else:
                    Path(operation["source"]).parent.mkdir(parents=True, exist_ok=True)
                    move_no_replace(operation["archive"], operation["source"])
            except Exception as rollback_exc:
                rollback_errors.append(str(rollback_exc))
        manifest["state"] = "partial" if rollback_errors else "rolled_back"
        manifest["error"] = str(exc)
        manifest["rollbackErrors"] = rollback_errors
        _write_manifest(manifest_path, manifest)
        if not rollback_errors:
            manifest_path.rename(manifest_path.with_suffix(".json.rolledback"))
        suffix = " Manual Undo remains available." if rollback_errors else " All filesystem changes were rolled back."
        raise RuntimeError(str(exc) + suffix) from exc

    result_rows: List[Dict[str, Any]] = []
    for operation, row in zip(operations, rows):
        row.include = False
        if operation["duplicate"]:
            row.status = "Archived exact duplicate"
        else:
            row.status = "Applied"
            row.proposed_name = operation["proposed_name"]
            row.parent_category = operation["parent_category"]
            row.destination_group = operation["destination_group"]
            row.proposed_relative_path = os.path.relpath(operation["output"], root)
            row.full_path = operation["output"]
            row.display_path = row.proposed_relative_path
        result_rows.append({"row_id": row.row_id, "ok": True, "status": row.status})
    duplicates = sum(1 for operation in operations if operation["duplicate"])
    outputs = len(operations) - duplicates
    return {
        "done": len(operations), "failed": 0, "outputs": outputs, "duplicates_archived": duplicates,
        "manifest": str(manifest_path), "undo_available": True, "rows": result_rows,
        "message": f"Finished. {outputs} polished log(s) written, {duplicates} exact duplicate(s) archived. Undo is available.",
    }


def undo_last(manifests_dir: str | Path) -> Dict[str, Any]:
    manifest_path = latest_undo_manifest(manifests_dir)
    if manifest_path is None:
        raise ValueError("No SOLO Log Organizer manifest is available to undo.")
    with open(manifest_path, "r", encoding="utf-8-sig") as stream:
        manifest = json.load(stream)
    root = str(manifest.get("root") or "")
    operations = manifest.get("operations") or []
    if not root or not isinstance(operations, list):
        raise ValueError("The undo manifest is invalid.")
    blocked: set[int] = set()
    removed = restored = skipped = 0
    for index in range(len(operations) - 1, -1, -1):
        operation = operations[index]
        output = str(operation.get("output") or "")
        if not output or not os.path.lexists(output):
            continue
        output = ensure_within(root, output)
        expected = str(operation.get("output_sha256") or "")
        if not os.path.isfile(output) or not expected or sha256_file(output) != expected:
            blocked.add(index)
            skipped += 1
            continue
        os.unlink(output)
        removed += 1
    for index in range(len(operations) - 1, -1, -1):
        if index in blocked:
            continue
        operation = operations[index]
        source_value = str(operation.get("source") or "")
        archive_value = str(operation.get("archive") or "")
        if not source_value or not archive_value:
            skipped += 1
            continue
        source = ensure_within(root, source_value)
        archive = ensure_within(root, archive_value)
        if not os.path.lexists(archive) or os.path.lexists(source):
            skipped += 1
            continue
        Path(source).parent.mkdir(parents=True, exist_ok=True)
        move_no_replace(archive, source)
        restored += 1
    if skipped == 0:
        manifest["state"] = "undone"
        manifest["undoneAt"] = _now()
        _write_manifest(manifest_path, manifest)
        manifest_path.rename(manifest_path.with_suffix(".json.undone"))
    return {
        "removed_outputs": removed, "restored": restored, "skipped": skipped,
        "undo_available": skipped > 0,
        "message": f"Undo finished. {restored} original log(s) restored, {removed} generated output(s) removed, {skipped} skipped.",
    }


def audit_csv(bundle: ScanBundle) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow([
        "Selected", "Current Path", "Role", "Tokens", "Parent Category", "Destination Group",
        "Proposed Filename", "Raw Lines", "Resolved Lines", "Duplicate Lines",
        "Exact Duplicate", "Duplicate Of", "Issues",
    ])
    for row in bundle.rows:
        writer.writerow([
            row.include, row.display_path, row.role, row.token_analysis.display, row.parent_category,
            row.destination_group, row.proposed_name, row.raw_nonblank_count,
            row.resolved_count, row.duplicate_lines_removed, row.is_exact_duplicate, row.duplicate_of,
            "; ".join(row.issues),
        ])
    return stream.getvalue()
