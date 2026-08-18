from __future__ import annotations

import asyncio
import os
import re
import json
import struct
import torch
from collections import OrderedDict
from typing import Any

import folder_paths
import comfy.sd
import comfy.utils

from .civitai_trigger import (
    detect_civitai_trigger,
    detect_civitai_triggers,
    normalize_trigger_text as _normalize_civitai_trigger_text,
)
from .trigger_resolution import choose_automatic, classify_candidate

try:
    from aiohttp import web
    from server import PromptServer
except Exception:  # pragma: no cover - unavailable outside ComfyUI runtime
    web = None
    PromptServer = None


class _AnyType(str):
    """A Comfy wildcard type that accepts dynamic custom-widget values."""

    def __ne__(self, other):
        return False


class _FlexibleOptionalInputType(dict):
    """Allow a dynamic number of optional inputs from serialized widgets."""

    def __init__(self, flexible_type, data=None):
        self.flexible_type = flexible_type
        self.data = data or {}
        super().__init__(self.data)

    def __getitem__(self, key):
        if key in self.data:
            return self.data[key]
        return (self.flexible_type,)

    def __contains__(self, key):
        return True


_ANY_TYPE = _AnyType("*")


NO_LORA = "None"
ALL_FOLDERS = "[All LoRA folders]"
ROOT_FOLDER = "[LoRA root only]"
FAVORITES_FOLDER = "[★ Favorites]"
UNTESTED_FOLDER = "[◌ Untested / Retest]"
ALL_EPOCHS = "[All epochs]"
NO_EPOCH_TAG = "[No epoch tag]"
ALL_LIBRARY_STATES = "[All Library statuses]"
FAVORITES_FILTER = "[★ Favorites]"
TESTED_FILTER = "[✓ Tested]"
UNTESTED_FILTER = "[◌ Untested / Retest]"
LIBRARY_FILTERS = [ALL_LIBRARY_STATES, FAVORITES_FILTER, TESTED_FILTER, UNTESTED_FILTER]
SORT_NAME = "Name"
SORT_MOST_USED = "Most used"
SORT_LEAST_USED = "Least used"
SORT_RECENTLY_USED = "Recently used"
LORA_SORT_MODES = [SORT_NAME, SORT_MOST_USED, SORT_LEAST_USED, SORT_RECENTLY_USED]
CONTROL_MODES = ["fixed", "increment", "decrement", "randomize", "shuffle"]

DEFAULT_CLEAN_NAME_MODE = "auto:1"
LEGACY_DEFAULT_CLEANUP_RULES = r"""(?i)_\d+$
(?i)_sickollie$
(?i)_krea2$
(?i)_epoch$"""


def _normalize_path(value: str) -> str:
    return str(value).replace("\\", "/").strip("/")


def _all_lora_names() -> list[str]:
    names = list(folder_paths.get_filename_list("loras"))
    return [name for name in names if name != NO_LORA]


def _parent_folder(lora_name: str) -> str:
    normalized = _normalize_path(lora_name)
    if "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


def _leaf_folder_name(lora_name: str) -> str:
    parent = _parent_folder(lora_name)
    if not parent:
        return ""
    return parent.rsplit("/", 1)[-1]


def _folder_choices() -> list[str]:
    folders: set[str] = set()

    for name in _all_lora_names():
        parent = _parent_folder(name)
        if not parent:
            continue

        parts = parent.split("/")
        for index in range(1, len(parts) + 1):
            folders.add("/".join(parts[:index]))

    return [ALL_FOLDERS, ROOT_FOLDER, FAVORITES_FOLDER, UNTESTED_FOLDER] + sorted(folders, key=lambda value: value.lower())


def _main_lora_choices() -> list[str]:
    return [NO_LORA] + _all_lora_names()


def _epoch_number(lora_name: str) -> int | None:
    """Return a canonical epoch number from common filename forms.

    Recognized examples include epoch1, epoch_1, epoch-01, and epoch 001.
    Matching is performed against the filename stem, not its parent folders.
    """
    stem = os.path.splitext(
        os.path.basename(_normalize_path(lora_name))
    )[0]
    match = re.search(r"(?i)epoch[\s_-]*0*(\d+)", stem)
    if not match:
        return None
    return int(match.group(1))


def _epoch_label(number: int) -> str:
    return f"Epoch {int(number)}"


def _epoch_filter_choices(lora_names: list[str] | None = None) -> list[str]:
    names = list(lora_names) if lora_names is not None else _all_lora_names()
    numbers = sorted(
        {
            number
            for name in names
            if (number := _epoch_number(name)) is not None
        }
    )
    choices = [ALL_EPOCHS] + [_epoch_label(number) for number in numbers]

    if numbers and any(_epoch_number(name) is None for name in names):
        choices.append(NO_EPOCH_TAG)

    return choices


def _matches_epoch(lora_name: str, epoch_filter: str) -> bool:
    selected = str(epoch_filter or ALL_EPOCHS)
    if selected == ALL_EPOCHS:
        return True

    number = _epoch_number(lora_name)
    if selected == NO_EPOCH_TAG:
        return number is None

    match = re.fullmatch(r"(?i)epoch\s+(\d+)", selected.strip())
    if not match:
        return True

    return number == int(match.group(1))


def _matches_folder(lora_name: str, folder_name: str, include_subfolders: bool) -> bool:
    parent = _parent_folder(lora_name)

    if folder_name == ALL_FOLDERS:
        return True

    if folder_name == ROOT_FOLDER:
        return parent == ""

    if folder_name in {FAVORITES_FOLDER, UNTESTED_FOLDER}:
        return True

    selected = _normalize_path(folder_name)
    if include_subfolders:
        return parent == selected or parent.startswith(selected + "/")

    return parent == selected


def _library_annotations() -> dict[str, dict[str, Any]]:
    try:
        from .solo_catalog import get_catalog
        return {
            os.path.abspath(str(item.get("current_path", ""))): {
                "state": str(item.get("review_state") or "none"),
                "use_count": max(0, int(item.get("use_count") or 0)),
                "last_used_at": str(item.get("last_used_at") or ""),
            }
            for item in get_catalog().list_assets()
        }
    except Exception:
        return {}


def _lora_annotation(lora_name: str, annotations: dict[str, dict[str, Any]]) -> dict[str, Any]:
    getter = getattr(folder_paths, "get_full_path", None)
    full_path = getter("loras", lora_name) if callable(getter) else None
    if not full_path:
        return {"state": "none", "use_count": 0, "last_used_at": ""}
    return annotations.get(os.path.abspath(full_path), {"state": "none", "use_count": 0, "last_used_at": ""})


def _folder_loras(
    folder_name: str,
    include_subfolders: bool,
    library_filter: str = ALL_LIBRARY_STATES,
    sort_mode: str = SORT_NAME,
) -> list[str]:
    # Virtual-folder values from v2.2 remain readable, but new Studio nodes use
    # a separate Library filter so Favorite/Untested can be scoped to any real
    # character, style, or project folder just like the Epoch filter.
    legacy_filter = library_filter
    if folder_name == FAVORITES_FOLDER:
        legacy_filter = FAVORITES_FILTER
    elif folder_name == UNTESTED_FOLDER:
        legacy_filter = UNTESTED_FILTER

    names = [
        name for name in _all_lora_names()
        if _matches_folder(name, folder_name, include_subfolders)
    ]
    annotations = _library_annotations()
    if legacy_filter == FAVORITES_FILTER:
        names = [name for name in names if _lora_annotation(name, annotations)["state"] == "favorite"]
    elif legacy_filter == TESTED_FILTER:
        names = [
            name for name in names
            if _lora_annotation(name, annotations)["use_count"] > 0
            and _lora_annotation(name, annotations)["state"] != "retest"
        ]
    elif legacy_filter == UNTESTED_FILTER:
        names = [
            name for name in names
            if _lora_annotation(name, annotations)["use_count"] == 0
            or _lora_annotation(name, annotations)["state"] == "retest"
        ]

    if sort_mode == SORT_MOST_USED:
        return sorted(names, key=lambda name: (-_lora_annotation(name, annotations)["use_count"], name.lower()))
    if sort_mode == SORT_LEAST_USED:
        return sorted(names, key=lambda name: (_lora_annotation(name, annotations)["use_count"], name.lower()))
    if sort_mode == SORT_RECENTLY_USED:
        return sorted(names, key=lambda name: (_lora_annotation(name, annotations)["last_used_at"], name.lower()), reverse=True)
    return sorted(names, key=str.lower)

def _stem_groups(stem: str) -> list[str]:
    """Split a LoRA stem while keeping a trailing epoch tag atomic."""
    value = str(stem).strip(" _-.")
    if not value:
        return []

    epoch_match = re.search(
        r"(?i)(?:[_\-\s]|^)epoch[\s_-]*0*\d+$",
        value,
    )
    epoch_group = None

    if epoch_match:
        epoch_group = value[epoch_match.start():].lstrip(" _-.")
        value = value[:epoch_match.start()].rstrip(" _-.")

    groups = [part for part in value.split("_") if part]
    if epoch_group:
        groups.append(epoch_group)
    return groups


def _canonical_suffix_group(group: str) -> str:
    value = str(group).strip().lower()
    if re.fullmatch(r"epoch[\s_-]*0*\d+", value, re.IGNORECASE):
        return "<epoch>"
    return value


def _recognized_suffix_count(stem: str) -> int:
    """Fallback when a pool has only one usable filename."""
    groups = _stem_groups(stem)
    count = 0

    for group in reversed(groups):
        value = _canonical_suffix_group(group)
        if value == "<epoch>" or re.fullmatch(
            r"(?i)(?:krea\d*|sickollie|sdxl|flux\d*|pony|illustrious|"
            r"v\d+(?:\.\d+)*|ver\d+|version\d+|step\d+)",
            value,
        ):
            count += 1
            continue
        break

    return min(count, max(0, len(groups) - 1))


def _common_suffix_count(lora_names: list[str]) -> int:
    stems = [
        os.path.splitext(os.path.basename(_normalize_path(name)))[0]
        for name in lora_names
        if str(name or "") != NO_LORA
    ]
    grouped = [_stem_groups(stem) for stem in stems]
    grouped = [groups for groups in grouped if groups]

    if not grouped:
        return 0
    if len(grouped) == 1:
        return _recognized_suffix_count(stems[0])

    max_depth = min(max(0, len(groups) - 1) for groups in grouped)
    common = 0

    for depth in range(1, max_depth + 1):
        values = {
            _canonical_suffix_group(groups[-depth])
            for groups in grouped
        }
        if len(values) != 1:
            break
        common += 1

    return common


def _trim_suffix_groups(stem: str, count: int) -> str:
    groups = _stem_groups(stem)
    remove = max(0, min(int(count), max(0, len(groups) - 1)))
    kept = groups[:-remove] if remove else groups
    return "_".join(kept).strip(" _-.") or str(stem)


def _delimiter_prefixes(stem: str) -> list[str]:
    """Return progressive filename prefixes at common delimiter boundaries.

    The original text and delimiters are preserved so this works for arbitrary
    naming styles such as foo_bar, foo-bar, foo bar, or mixed forms.
    """
    value = str(stem or "").strip(" _-.")
    if not value:
        return []

    prefixes: list[str] = []
    # Split on runs of the filename delimiters people commonly use while
    # retaining the original prefix text for display/output.
    for match in re.finditer(r"[_.\-\s]+", value):
        candidate = value[:match.start()].rstrip(" _-.")
        if candidate and candidate not in prefixes:
            prefixes.append(candidate)

    if value not in prefixes:
        prefixes.append(value)
    return prefixes


def _clean_candidate_from_mode(stem: str, mode_value: str) -> str:
    """Resolve a clean-name dropdown choice against the current stem.

    New dropdown values are stored as ``N · candidate``.  When the candidate
    still belongs to the selected filename we return it directly, which also
    preserves old saved dropdown values during upgrades.  Otherwise N selects
    the Nth progressive delimiter prefix for the current filename.
    """
    mode_text = str(mode_value or "").strip()
    value = str(stem or "").strip(" _-.")
    prefixes = _delimiter_prefixes(value)
    if not prefixes:
        return value

    if "·" in mode_text:
        _label, candidate = mode_text.split("·", 1)
        candidate = candidate.strip()
        if candidate and (candidate == value or value.startswith(candidate)):
            # Only accept a saved candidate when it ends exactly at a known
            # delimiter boundary, preventing accidental partial-name matches.
            if candidate in prefixes:
                return candidate

    index = _clean_mode_index(mode_text)
    return prefixes[min(max(index, 1), len(prefixes)) - 1]


def _clean_mode_index(mode_value: str) -> int:
    text = str(mode_value or "").strip()
    match = re.search(r"(?:^auto:|^|keep[_:\s-]*)(\d+)", text, re.IGNORECASE)
    return max(1, int(match.group(1))) if match else 1


def _clean_name_from_mode(
    stem: str,
    mode_value: str,
    pool_loras: list[str] | None = None,
) -> str:
    mode_text = str(mode_value or "").strip()

    # Old multiline regex workflows remain loadable and resolve to their old
    # result until the frontend refreshes the slot into the new dropdown.
    if "\n" in mode_text or "(?i)" in mode_text or "=>" in mode_text:
        legacy = _apply_cleanup_rules(stem, mode_text)
        return legacy or str(stem)

    # Explicit dropdown selections use filename-agnostic delimiter prefixes.
    # Keep legacy ``auto:N`` behavior unchanged so existing/new default nodes do
    # not suddenly shorten multi-part names just because more choices are shown.
    if "·" in mode_text:
        return _clean_candidate_from_mode(stem, mode_text)

    shared = max(
        _common_suffix_count(list(pool_loras or [])),
        _recognized_suffix_count(stem),
    )
    index = _clean_mode_index(mode_text)
    remove_count = max(0, shared - (index - 1))
    return _trim_suffix_groups(stem, remove_count)


def _apply_cleanup_rules(stem: str, rules_text: str) -> str:
    """
    Apply sequential regex replacement rules repeatedly until stable.

    Rule formats:
      PATTERN
      PATTERN => REPLACEMENT

    A pattern without `=>` is replaced with an empty string.
    Blank lines and lines starting with # are ignored.
    """
    parsed_rules: list[tuple[re.Pattern, str]] = []

    for line_number, raw_line in enumerate(str(rules_text).splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if "=>" in line:
            pattern_text, replacement = line.split("=>", 1)
            pattern_text = pattern_text.strip()
            replacement = replacement.strip()
        else:
            pattern_text = line
            replacement = ""

        if not pattern_text:
            continue

        try:
            parsed_rules.append((re.compile(pattern_text), replacement))
        except re.error as error:
            print(
                "[Sick Ollie LoRA Tools] Ignoring invalid cleanup regex "
                f"on line {line_number}: {pattern_text!r} ({error})"
            )

    result = str(stem)

    # Repeating is what allows:
    # becky_krea2_epoch_12 -> becky_krea2_epoch -> becky_krea2 -> becky
    for _ in range(20):
        previous = result
        for pattern, replacement in parsed_rules:
            result = pattern.sub(replacement, result)

        if result == previous:
            break

    return result.strip(" _-.")



def _load_safetensors_metadata(path: str) -> dict[str, Any]:
    try:
        with open(path, "rb") as handle:
            header_length = struct.unpack("<Q", handle.read(8))[0]
            header = json.loads(handle.read(header_length))
    except Exception:
        return {}

    metadata = header.get("__metadata__")
    return metadata if isinstance(metadata, dict) else {}


def _read_json_file(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def _normalize_trigger_text(value: Any) -> str:
    return _normalize_civitai_trigger_text(value)


def _extract_word_from_entry(entry: Any) -> str:
    if isinstance(entry, str):
        return _normalize_trigger_text(entry)

    if isinstance(entry, dict):
        for key in ("word", "name", "value", "trigger", "text"):
            word = _normalize_trigger_text(entry.get(key))
            if word:
                return word

    return ""


_GENERIC_TRIGGER_TAGS = {
    "1girl", "1boy", "2girls", "2boys", "3girls", "solo",
    "looking at viewer", "simple background", "white background",
    "black background", "signature", "watermark", "text", "smile",
    "long hair", "short hair", "brown hair", "black hair", "blonde hair",
    "blue eyes", "brown eyes", "realistic", "photo", "photorealistic",
    "upper body", "portrait", "female", "male", "girl", "boy",
    "woman", "man", "young woman", "young man",
}


def _parse_json_maybe(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


def _trigger_from_explicit_metadata(metadata: dict[str, Any]) -> tuple[str, str]:
    if not isinstance(metadata, dict):
        return "", ""

    explicit_keys = (
        "modelspec.trigger_phrase",
        "modelspec.trigger",
        "trigger_phrase",
        "trigger",
        "trigger_words",
        "triggerWords",
        "trainedWords",
        "trained_words",
        "ss_trigger_words",
    )

    for key in explicit_keys:
        value = metadata.get(key)
        if value is None:
            continue

        if isinstance(value, list):
            for entry in value:
                word = _extract_word_from_entry(entry)
                if word:
                    return word, key
            continue

        parsed = _parse_json_maybe(value)
        if isinstance(parsed, list):
            for entry in parsed:
                word = _extract_word_from_entry(entry)
                if word:
                    return word, key
            continue
        if isinstance(parsed, dict):
            for subvalue in parsed.values():
                if isinstance(subvalue, list):
                    for entry in subvalue:
                        word = _extract_word_from_entry(entry)
                        if word:
                            return word, key
            continue

        word = _normalize_trigger_text(value)
        if word:
            return word, key

    return "", ""


def _score_trigger_candidate(tag: str, total_count: int, bucket_matches: int) -> int:
    value = str(tag or "").strip()
    if not value:
        return -10**9

    lower = value.lower()
    score = int(total_count) * 1000 + int(bucket_matches) * 250

    if lower in _GENERIC_TRIGGER_TAGS:
        score -= 5000

    if " " not in value:
        score += 150
    if any(ch.isdigit() for ch in value):
        score += 120
    if any(ch in value for ch in "_-"):
        score += 60
    if len(value) >= 4:
        score += 20
    if lower.startswith(("rly", "dr0", "so", "sc")):
        score += 20

    return score


def _trigger_from_ss_tag_frequency(metadata: dict[str, Any]) -> tuple[str, str]:
    if not isinstance(metadata, dict):
        return "", ""

    raw = metadata.get("ss_tag_frequency")
    parsed = _parse_json_maybe(raw)
    if not isinstance(parsed, dict):
        return "", ""

    totals: dict[str, int] = {}
    bucket_matches: dict[str, int] = {}

    for bucket_name, bucket_tags in parsed.items():
        if not isinstance(bucket_tags, dict):
            continue

        bucket_text = str(bucket_name or "")
        bucket_suffix = bucket_text.split("_", 1)[1].strip() if "_" in bucket_text else ""

        for tag, count in bucket_tags.items():
            tag_text = _normalize_trigger_text(tag)
            if not tag_text:
                continue

            try:
                numeric_count = int(count)
            except Exception:
                try:
                    numeric_count = int(float(count))
                except Exception:
                    numeric_count = 1

            totals[tag_text] = totals.get(tag_text, 0) + max(1, numeric_count)

            if bucket_suffix and tag_text == bucket_suffix:
                bucket_matches[tag_text] = bucket_matches.get(tag_text, 0) + 1

    if not totals:
        return "", ""

    ranked = sorted(
        totals.items(),
        key=lambda item: (
            -_score_trigger_candidate(item[0], item[1], bucket_matches.get(item[0], 0)),
            -item[1],
            item[0].lower(),
        ),
    )

    best_tag = ranked[0][0]
    if not best_tag:
        return "", ""

    return best_tag, "ss_tag_frequency"


def _trigger_from_modelspec_title(metadata: dict[str, Any]) -> tuple[str, str]:
    if not isinstance(metadata, dict):
        return "", ""

    title = _normalize_trigger_text(metadata.get("modelspec.title"))
    if title:
        return title, "modelspec.title"

    return "", ""


def _detect_main_trigger(lora_name: str) -> tuple[str, str]:
    selected = str(lora_name or NO_LORA)
    if not selected or selected == NO_LORA:
        return "", ""

    try:
        full_path = folder_paths.get_full_path_or_raise("loras", selected)
    except Exception:
        return "", ""

    metadata = _load_safetensors_metadata(full_path)

    # Prefer activation evidence carried by the file itself. If it has none,
    # ask the Civitai fallback (sidecar first, then exact SHA-256 API match).
    # ``modelspec.title`` is deliberately *not* an activation fallback: it is
    # a model identity/filename hint and has produced false-positive triggers
    # for files that explicitly declare no trigger at all.
    for resolver in (
        _trigger_from_explicit_metadata,
        _trigger_from_ss_tag_frequency,
    ):
        trigger, source = resolver(metadata)
        if trigger:
            return trigger, source

    trigger, source = detect_civitai_trigger(full_path)
    # Civitai can legitimately list a whole weighted recipe as a "trigger".
    # Keep that candidate available to the Studio Builder, but never inject it
    # as ``main_trigger`` without an explicit user choice.
    if trigger and classify_candidate(trigger, source).get("auto_select"):
        return trigger, source

    return "", ""


def _trigger_candidates(lora_name: str) -> list[dict[str, Any]]:
    """Expose trigger evidence without confusing model titles for triggers."""

    selected = str(lora_name or NO_LORA)
    if not selected or selected == NO_LORA:
        return []
    try:
        full_path = folder_paths.get_full_path_or_raise("loras", selected)
    except Exception:
        return []

    metadata = _load_safetensors_metadata(full_path)
    candidates: list[dict[str, Any]] = []
    for resolver in (_trigger_from_explicit_metadata, _trigger_from_ss_tag_frequency):
        trigger, source = resolver(metadata)
        if trigger:
            candidates.append(classify_candidate(trigger, source))

    civitai_values, civitai_source = detect_civitai_triggers(full_path)
    for value in civitai_values:
        candidates.append(classify_candidate(value, civitai_source))

    # A title is useful to explain a LoRA, but is never eligible for automatic
    # activation. It remains visible to the user as an identity-only hint.
    title, title_source = _trigger_from_modelspec_title(metadata)
    if title:
        candidates.append(classify_candidate(title, title_source))

    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        key = (str(candidate.get("raw", "")).casefold(), str(candidate.get("source", "")))
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get("/sickollie/studio/loader-core/main-trigger")
    async def so_loader_core_main_trigger(request):
        lora_name = request.rel_url.query.get("lora", "")
        # Hashing a large LoRA and making the optional network request must not
        # stall ComfyUI's aiohttp event loop.
        trigger, source = await asyncio.to_thread(_detect_main_trigger, lora_name)
        return web.json_response(
            {
                "ok": True,
                "trigger": str(trigger),
                "source": str(source),
            }
        )

    @PromptServer.instance.routes.get("/sickollie/studio/loader-core/trigger-candidates")
    async def so_loader_core_trigger_candidates(request):
        lora_name = request.rel_url.query.get("lora", "")
        candidates = await asyncio.to_thread(_trigger_candidates, lora_name)
        selected = choose_automatic(candidates)
        return web.json_response(
            {
                "ok": True,
                "candidates": candidates,
                "automatic": selected or {},
            }
        )


def _extra_dict(extra_pnginfo: Any) -> dict | None:
    if isinstance(extra_pnginfo, dict):
        return extra_pnginfo

    if isinstance(extra_pnginfo, list):
        for item in extra_pnginfo:
            if isinstance(item, dict):
                return item

    return None


def _find_workflow_node(workflow: dict, node_id: Any) -> dict | None:
    for node in workflow.get("nodes", []):
        if str(node.get("id")) == str(node_id):
            return node
    return None


def _replace_exact(value: Any, selected: str, replacement: str) -> Any:
    if isinstance(value, str):
        return replacement if value == selected else value

    if isinstance(value, list):
        return [_replace_exact(item, selected, replacement) for item in value]

    if isinstance(value, tuple):
        return tuple(_replace_exact(item, selected, replacement) for item in value)

    if isinstance(value, dict):
        return {
            key: _replace_exact(item, selected, replacement)
            for key, item in value.items()
        }

    return value


def _scrub_inactive_selection(
    *,
    prompt: Any,
    extra_pnginfo: Any,
    unique_id: Any,
    input_name: str,
    selected: str,
) -> None:
    """
    Remove an inactive selected LoRA from the prompt/workflow metadata while
    leaving the live canvas widget untouched.
    """
    if not selected or selected == NO_LORA:
        return

    if isinstance(prompt, dict):
        entry = prompt.get(str(unique_id))
        if entry is None:
            entry = prompt.get(unique_id)

        if isinstance(entry, dict):
            inputs = entry.get("inputs")
            if isinstance(inputs, dict):
                inputs[input_name] = NO_LORA

    extra = _extra_dict(extra_pnginfo)
    if extra is None:
        return

    workflow = extra.get("workflow")
    if not isinstance(workflow, dict):
        return

    node = _find_workflow_node(workflow, unique_id)
    if not isinstance(node, dict):
        return

    if "widgets_values" in node:
        node["widgets_values"] = _replace_exact(
            node["widgets_values"],
            selected,
            NO_LORA,
        )

    node.setdefault("properties", {})[
        f"so_scrubbed_{input_name}"
    ] = selected


class FolderBatchLoraStackModelOnly:
    """
    Folder-scoped main LoRA batch tester plus four fixed secondary LoRA slots.

    Queue-time progression is handled by the companion JavaScript extension.
    Python loads exactly the values serialized into each queued prompt.
    """

    CACHE_LIMIT = 8

    def __init__(self):
        self._lora_cache: OrderedDict[str, tuple[Any, Any]] = OrderedDict()

    @classmethod
    def INPUT_TYPES(cls):
        lora_combo = _main_lora_choices()

        required = {
            "model": ("MODEL",),
            "folder_name": (
                _folder_choices(),
                {
                    "default": ALL_FOLDERS,
                    "tooltip": (
                        "Restrict the main cycling LoRA to this folder. "
                        "The dropdown is generated from your ComfyUI LoRA directory."
                    ),
                },
            ),
            "include_subfolders": (
                "BOOLEAN",
                {
                    "default": False,
                    "tooltip": "Include nested LoRA folders beneath the selected folder.",
                },
            ),
            "main_lora": (
                lora_combo,
                {
                    "default": NO_LORA,
                    "tooltip": (
                        "Main LoRA tested sequentially. The browser filters this dropdown "
                        "to the selected folder."
                    ),
                },
            ),
            "control_after_generate": (
                CONTROL_MODES,
                {
                    "default": "increment",
                    "tooltip": (
                        "Changes main_lora after each prompt is queued, so large Queue counts "
                        "receive different LoRAs before execution begins."
                    ),
                },
            ),
            "loop_folder": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Wrap from the final LoRA back to the first LoRA.",
                },
            ),
            "skip_none_during_cycle": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": (
                        "Keep None available for manual use but exclude it from automatic cycling."
                    ),
                },
            ),
            "main_enabled": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Disable the main LoRA without falsely recording it in PNG metadata.",
                },
            ),
            "main_strength": (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            ),
            "off_name": (
                "STRING",
                {
                    "default": "no_lora",
                    "multiline": False,
                    "tooltip": "Name outputs used when the main LoRA is inactive.",
                },
            ),
            "auto_clean_name": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Create clean_name using the selected automatic trim level.",
                },
            ),
            "cleanup_rules": (
                "STRING",
                {
                    "default": DEFAULT_CLEAN_NAME_MODE,
                    "multiline": False,
                    "dynamicPrompts": False,
                    "tooltip": (
                        "Shown as a clean-name dropdown in the browser. "
                        "Its trim strategy is detected from suffixes shared by the active LoRA pool."
                    ),
                },
            ),
        }

        # Four fixed secondary slots are intentionally used instead of fragile
        # frontend-only autogrow widgets.
        for index in range(1, 5):
            required[f"secondary_{index}_lora"] = (
                lora_combo,
                {
                    "default": NO_LORA,
                    "tooltip": (
                        f"Optional fixed secondary LoRA {index}. "
                        "This slot does not participate in folder cycling."
                    ),
                },
            )
            required[f"secondary_{index}_enabled"] = (
                "BOOLEAN",
                {"default": False},
            )
            required[f"secondary_{index}_strength"] = (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            )

        return {
            "required": required,
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        "MODEL",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "BOOLEAN",
        "INT",
        "STRING",
        "STRING",
    )
    RETURN_NAMES = (
        "model",
        "main_file",
        "raw_stem",
        "clean_name",
        "applied_loras",
        "main_active",
        "folder_count",
        "main_trigger",
        "main_folder",
    )
    FUNCTION = "load_loras"
    CATEGORY = "Sick Ollie/Studio"
    DESCRIPTION = (
        "Folder-scoped, looping main LoRA tester with queue-time progression, "
        "editable regex name cleaning, four secondary LoRA slots, and inactive "
        "metadata scrubbing."
    )
    SEARCH_ALIASES = [
        "folder batch lora",
        "loop lora folder",
        "sequential lora tester",
        "lora stack",
        "lora name cleaner",
        "batch lora folder",
    ]

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Ensures metadata cleanup and string outputs run for every queued image.
        return float("nan")

    def _load_lora_state(self, lora_name: str):
        lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)

        if lora_path in self._lora_cache:
            value = self._lora_cache.pop(lora_path)
            self._lora_cache[lora_path] = value
            return value

        try:
            state, metadata = comfy.utils.load_torch_file(
                lora_path,
                safe_load=True,
                return_metadata=True,
            )
        except TypeError:
            state = comfy.utils.load_torch_file(
                lora_path,
                safe_load=True,
            )
            metadata = None

        self._lora_cache[lora_path] = (state, metadata)

        while len(self._lora_cache) > self.CACHE_LIMIT:
            self._lora_cache.popitem(last=False)

        return state, metadata

    @staticmethod
    def _apply_model_lora(model, state, strength: float, metadata):
        try:
            model_lora, _ = comfy.sd.load_lora_for_models(
                model,
                None,
                state,
                float(strength),
                0.0,
                lora_metadata=metadata,
            )
        except TypeError:
            model_lora, _ = comfy.sd.load_lora_for_models(
                model,
                None,
                state,
                float(strength),
                0.0,
            )

        return model_lora

    def load_loras(
        self,
        model,
        folder_name: str,
        include_subfolders: bool,
        main_lora: str,
        control_after_generate: str,
        loop_folder: bool,
        skip_none_during_cycle: bool,
        main_enabled: bool,
        main_strength: float,
        off_name: str,
        auto_clean_name: bool,
        cleanup_rules: str,
        secondary_1_lora: str,
        secondary_1_enabled: bool,
        secondary_1_strength: float,
        secondary_2_lora: str,
        secondary_2_enabled: bool,
        secondary_2_strength: float,
        secondary_3_lora: str,
        secondary_3_enabled: bool,
        secondary_3_strength: float,
        secondary_4_lora: str,
        secondary_4_enabled: bool,
        secondary_4_strength: float,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        selected_main = str(main_lora or NO_LORA)
        main_active = bool(
            main_enabled
            and selected_main != NO_LORA
            and float(main_strength) != 0.0
        )

        if main_active:
            main_file = selected_main
            raw_stem = os.path.splitext(
                os.path.basename(
                    _normalize_path(selected_main)
                )
            )[0]
        else:
            main_file = str(off_name).strip() or "no_lora"
            raw_stem = main_file
            _scrub_inactive_selection(
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
                unique_id=unique_id,
                input_name="main_lora",
                selected=selected_main,
            )

        clean_name = (
            _clean_name_from_mode(raw_stem, cleanup_rules)
            if auto_clean_name
            else raw_stem
        )
        if not clean_name:
            clean_name = raw_stem

        main_trigger, _main_trigger_source = (
            _detect_main_trigger(selected_main)
            if main_active
            else ("", "")
        )
        main_folder = _leaf_folder_name(selected_main) if main_active else ""

        current_model = model
        applied: list[str] = []

        if main_active:
            state, metadata = self._load_lora_state(selected_main)
            current_model = self._apply_model_lora(
                current_model,
                state,
                float(main_strength),
                metadata,
            )
            applied.append(f"{selected_main}@{float(main_strength):g}")

        secondary_values = [
            (
                "secondary_1_lora",
                str(secondary_1_lora or NO_LORA),
                bool(secondary_1_enabled),
                float(secondary_1_strength),
            ),
            (
                "secondary_2_lora",
                str(secondary_2_lora or NO_LORA),
                bool(secondary_2_enabled),
                float(secondary_2_strength),
            ),
            (
                "secondary_3_lora",
                str(secondary_3_lora or NO_LORA),
                bool(secondary_3_enabled),
                float(secondary_3_strength),
            ),
            (
                "secondary_4_lora",
                str(secondary_4_lora or NO_LORA),
                bool(secondary_4_enabled),
                float(secondary_4_strength),
            ),
        ]

        for input_name, lora_name, enabled, strength in secondary_values:
            active = bool(
                enabled
                and lora_name != NO_LORA
                and strength != 0.0
            )

            if not active:
                _scrub_inactive_selection(
                    prompt=prompt,
                    extra_pnginfo=extra_pnginfo,
                    unique_id=unique_id,
                    input_name=input_name,
                    selected=lora_name,
                )
                continue

            state, metadata = self._load_lora_state(lora_name)
            current_model = self._apply_model_lora(
                current_model,
                state,
                strength,
                metadata,
            )
            applied.append(f"{lora_name}@{strength:g}")
            secondary_applied.append({
                "file": str(lora_name),
                "strength": float(strength),
                "slot": str(input_name),
            })

        folder_count = len(
            _folder_loras(folder_name, bool(include_subfolders))
        )

        return (
            current_model,
            main_file,
            raw_stem,
            clean_name,
            "\n".join(applied),
            main_active,
            folder_count,
            str(main_trigger),
            str(main_folder),
        )


class LoaderCoreEngine(FolderBatchLoraStackModelOnly):
    """
    Diffusion-model loader, folder-cycling primary LoRA, and a dynamic
    rgthree-style secondary LoRA stack.
    """

    def __init__(self):
        super().__init__()
        self._base_model_cache = None

    @classmethod
    def INPUT_TYPES(cls):
        diffusion_models = list(
            folder_paths.get_filename_list("diffusion_models")
        )

        required = {
            "diffusion_model": (
                diffusion_models,
                {
                    "tooltip": (
                        "Diffusion model loaded internally before LoRAs."
                    ),
                },
            ),
            "weight_dtype": (
                [
                    "default",
                    "fp8_e4m3fn",
                    "fp8_e4m3fn_fast",
                    "fp8_e5m2",
                ],
                {
                    "default": "default",
                    "advanced": True,
                },
            ),
            "folder_name": (
                _folder_choices(),
                {
                    "default": ALL_FOLDERS,
                    "tooltip": (
                        "Restrict the primary cycling LoRA to this folder."
                    ),
                },
            ),
            "epoch_filter": (
                _epoch_filter_choices(),
                {
                    "default": ALL_EPOCHS,
                    "tooltip": (
                        "Optionally restrict the selected folder to one detected epoch. "
                        "Forms such as epoch1, epoch_1, epoch-01, and epoch 001 "
                        "are grouped under the same canonical Epoch number."
                    ),
                },
            ),
            "main_enabled": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Enable or disable the primary LoRA.",
                },
            ),
            "main_lora": (
                _main_lora_choices(),
                {
                    "default": NO_LORA,
                    "tooltip": "Primary LoRA used for folder batch testing.",
                },
            ),
            "main_strength": (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            ),
            "include_subfolders": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "loop_folder": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "control_after_generate": (
                CONTROL_MODES,
                {
                    "default": "increment",
                },
            ),
            "skip_none_during_cycle": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "off_name": (
                "STRING",
                {
                    "default": "no_lora",
                    "multiline": False,
                },
            ),
            "auto_clean_name": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "cleanup_rules": (
                "STRING",
                {
                    "default": DEFAULT_CLEAN_NAME_MODE,
                    "multiline": False,
                    "dynamicPrompts": False,
                },
            ),
            "library_filter": (
                LIBRARY_FILTERS,
                {
                    "default": ALL_LIBRARY_STATES,
                    "tooltip": (
                        "Filter the selected real folder to Favorites, Tested, or Untested / Retest. "
                        "The chosen folder scope stays active."
                    ),
                },
            ),
            "lora_sort": (
                LORA_SORT_MODES,
                {
                    "default": SORT_NAME,
                    "tooltip": "Sort the active folder pool by name or durable Library usage history.",
                },
            ),
        }

        return {
            "required": required,
            "optional": _FlexibleOptionalInputType(
                _ANY_TYPE,
                data={},
            ),
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        "MODEL",
        "STRING",
        "STRING",
        "STRING",
    )
    RETURN_NAMES = (
        "model",
        "clean_name",
        "main_trigger",
        "main_folder",
    )
    FUNCTION = "load_core"
    CATEGORY = "Sick Ollie/Studio"
    DESCRIPTION = (
        "Loads a diffusion model, applies a folder-cycling primary LoRA, "
        "then applies a dynamic rgthree-powered secondary LoRA stack."
    )
    SEARCH_ALIASES = [
        "loader core",
        "diffusion model lora loader",
        "folder batch lora",
        "power lora stack",
        "sequential lora tester",
    ]

    def _load_base_model(
        self,
        diffusion_model: str,
        weight_dtype: str,
    ):
        model_path = folder_paths.get_full_path_or_raise(
            "diffusion_models",
            diffusion_model,
        )
        cache_key = (model_path, str(weight_dtype))

        if (
            self._base_model_cache is not None
            and self._base_model_cache[0] == cache_key
        ):
            return self._base_model_cache[1]

        model_options = {}

        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2

        model = comfy.sd.load_diffusion_model(
            model_path,
            model_options=model_options,
        )
        self._base_model_cache = (cache_key, model)
        return model

    @staticmethod
    def _dynamic_secondary_values(kwargs):
        values = []

        for key, value in kwargs.items():
            if not str(key).startswith("secondary_lora_"):
                continue

            if not isinstance(value, dict):
                continue

            values.append(
                (
                    str(key),
                    bool(value.get("on", True)),
                    str(value.get("lora") or NO_LORA),
                    float(value.get("strength", 1.0)),
                )
            )

        def numeric_suffix(item):
            match = re.search(r"(\d+)$", item[0])
            return int(match.group(1)) if match else 0

        values.sort(key=numeric_suffix)
        return values

    def load_core(
        self,
        diffusion_model: str,
        weight_dtype: str,
        folder_name: str,
        epoch_filter: str,
        main_enabled: bool,
        main_lora: str,
        main_strength: float,
        include_subfolders: bool,
        loop_folder: bool,
        control_after_generate: str,
        skip_none_during_cycle: bool,
        off_name: str,
        auto_clean_name: bool,
        cleanup_rules: str,
        library_filter: str = ALL_LIBRARY_STATES,
        lora_sort: str = SORT_NAME,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
        **kwargs,
    ):
        base_model = self._load_base_model(
            str(diffusion_model),
            str(weight_dtype),
        )

        diffusion_model_file = str(diffusion_model)
        diffusion_model_stem = os.path.splitext(
            os.path.basename(
                _normalize_path(diffusion_model_file)
            )
        )[0]

        selected_main = str(main_lora or NO_LORA)
        main_active = bool(
            main_enabled
            and selected_main != NO_LORA
            and float(main_strength) != 0.0
        )

        if main_active:
            main_file = selected_main
            raw_stem = os.path.splitext(
                os.path.basename(
                    _normalize_path(selected_main)
                )
            )[0]
        else:
            main_file = str(off_name).strip() or "no_lora"
            raw_stem = main_file
            _scrub_inactive_selection(
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
                unique_id=unique_id,
                input_name="main_lora",
                selected=selected_main,
            )

        active_pool = [
            name
            for name in _folder_loras(folder_name, include_subfolders, library_filter, lora_sort)
            if _matches_epoch(name, epoch_filter)
        ]

        clean_name = (
            _clean_name_from_mode(raw_stem, cleanup_rules, active_pool)
            if auto_clean_name
            else raw_stem
        )
        if not clean_name:
            clean_name = raw_stem

        main_trigger, main_trigger_source = (
            _detect_main_trigger(selected_main)
            if main_active
            else ("", "")
        )
        main_folder = _leaf_folder_name(selected_main) if main_active else ""

        current_model = base_model
        applied: list[str] = []
        secondary_applied: list[dict[str, Any]] = []

        if main_active:
            state, metadata = self._load_lora_state(selected_main)
            current_model = self._apply_model_lora(
                current_model,
                state,
                float(main_strength),
                metadata,
            )
            applied.append(
                f"{selected_main}@{float(main_strength):g}"
            )

        for input_name, enabled, lora_name, strength in (
            self._dynamic_secondary_values(kwargs)
        ):
            active = bool(
                enabled
                and lora_name != NO_LORA
                and strength != 0.0
            )

            if not active:
                continue

            state, metadata = self._load_lora_state(lora_name)
            current_model = self._apply_model_lora(
                current_model,
                state,
                strength,
                metadata,
            )
            applied.append(f"{lora_name}@{strength:g}")
            secondary_applied.append({
                "file": str(lora_name),
                "strength": float(strength),
                "slot": str(input_name),
            })

        folder_count = len(
            [
                name
                for name in _folder_loras(
                    folder_name,
                    bool(include_subfolders),
                    library_filter,
                    lora_sort,
                )
                if _matches_epoch(name, epoch_filter)
            ]
        )

        extra = _extra_dict(extra_pnginfo)
        if extra is not None:
            extra["so_loader_core_diffusion_model"] = diffusion_model_file
            extra["so_loader_core_weight_dtype"] = str(weight_dtype)
            extra["so_loader_core_applied_loras"] = list(applied)
            extra["so_loader_core_main_active"] = bool(main_active)
            extra["so_loader_core_main_file"] = str(selected_main if main_active else "")
            extra["so_loader_core_main_strength"] = float(main_strength) if main_active else 0.0
            extra["so_loader_core_main_trigger"] = str(main_trigger)
            extra["so_loader_core_main_trigger_source"] = str(main_trigger_source)
            extra["so_loader_core_raw_stem"] = str(raw_stem)
            extra["so_loader_core_clean_name"] = str(clean_name)
            extra["so_loader_core_main_folder"] = str(main_folder)
            extra["so_loader_core_secondary_loras"] = list(secondary_applied)

        return (
            current_model,
            clean_name,
            str(main_trigger),
            str(main_folder),
        )


NODE_CLASS_MAPPINGS = {
    "SOLoaderCoreEngineStudio": LoaderCoreEngine,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SOLoaderCoreEngineStudio": "Loader Core",
}
