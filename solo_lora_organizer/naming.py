from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass
from typing import List, Sequence, Tuple

from .metadata import is_useful_identity
from .models import ScanRow
from .util import relative_path


ORGANIZER_CATEGORIES = (
    "Character", "Style", "Concept", "Clothing", "Base Model", "Background",
    "Poses", "Tool", "Assets", "Vehicle", "Buildings", "Objects", "Animal", "Action",
)


@dataclass
class NameChoice:
    base_name: str
    source: str


@dataclass
class TriggerResolution:
    identity: str = ""
    source: str = ""
    score: int = 0


def safe_name(name: str, fallback: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "")
    value = re.sub(r"\s+", " ", value).strip().rstrip(". ")
    if not value:
        value = fallback
    reserved = {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
    if value.upper() in reserved:
        value = "_" + value
    if len(value) > 170:
        value = value[:170].strip()
    return value


def _strip_unicode_symbols(value: str) -> str:
    return "".join(" " if unicodedata.category(char) in {"So", "Sk"} else char for char in value)


def clean_smart_name(name: str, kind: str) -> str:
    if not (name or "").strip():
        return ""
    value = name.strip()
    if value.lower().endswith(".safetensors"):
        value = os.path.splitext(value)[0]
    value = value.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    value = _strip_unicode_symbols(value)
    value = re.sub(r"^\s*[+*#~=]+\s*\d*\s*", "", value)
    value = re.sub(r"^\s*\d+\s*[.):\-]\s*", "", value)
    value = re.sub(
        r"^\s*(?:(?:original|fictional|ai)\s+character|character\s+lora|ai\s+girl|ai\s+model|original\s+model)\s*[:\-_|]+\s*",
        "", value, flags=re.I,
    )
    if kind == "model":
        value = re.sub(
            r"^\s*(?:krea\s*\.?\s*2|krea2|k2|sdxl|flux(?:[\s._-]*\d+)?|pony|z[\s._-]*image(?:[\s._-]*turbo)?)\s*[:\-_|_]+\s*",
            "", value, flags=re.I,
        )

    if kind == "model":
        for _ in range(4):
            before = value
            value = re.sub(r"\([^()]*\)", " ", value)
            value = re.sub(r"\[[^\[\]]*\]", " ", value)
            value = re.sub(r"\{[^{}]*\}", " ", value)
            if value == before:
                break
    else:
        junk = (
            r"(?:this\s+person\s+does\s+not\s+exist|the\s+person\s+does\s+not\s+exist|"
            r"person\s+does\s+not\s+exist|fictional\s+character|ai\s+(?:based\s+)?character|"
            r"not\s+real(?:\s+character)?|original\s+character|oc|bss|nsfw|sfw)"
        )
        for left, right in ((r"\(", r"\)"), (r"\[", r"\]"), (r"\{", r"\}")):
            value = re.sub(left + r"\s*" + junk + r"\s*" + right, " ", value, flags=re.I)
        technical = (
            r"(?:steps?|epochs?|similarity|realism|realistic|photoreal|final|fixed|training|trained|"
            r"checkpoint|ckpt|krea\s*\.?\s*2|krea2|raw|automagic|test)"
        )
        value = re.sub(r"\s*\[[^\]]*\b" + technical + r"\b[^\]]*\]\s*", " ", value, flags=re.I)
        value = re.sub(r"\s*\([^)]*\b" + technical + r"\b[^)]*\)\s*", " ", value, flags=re.I)

    boiler = (
        r"\bthis\s+person\s+does\s+not\s+exist\b", r"\bthe\s+person\s+does\s+not\s+exist\b",
        r"\bperson\s+does\s+not\s+exist\b", r"\bfictional\s+character\b", r"\bai\s+based\s+character\b",
        r"\bai\s+character\b", r"\bnot\s+real\s+character\b", r"\bnot\s+real\b",
    )
    for pattern in boiler:
        value = re.sub(pattern, " ", value, flags=re.I)

    if kind == "model":
        separator = re.search(r"\s+(?:\||-|:)\s+", value)
        if separator:
            left = value[:separator.start()].strip()
            right = value[separator.end():].strip()
            descriptor = re.compile(
                r"\b(?:person|character|influencer|e[\s-]*girl|girl|woman|man|boy|cute|blonde|brunette|"
                r"realism|realistic|photoreal|style|lora|model|krea|sdxl|flux|pony|universe|anime|game|"
                r"movie|series|tales|avatar|version|trained|training|dataset|steps?|similarity|nsfw|sfw|"
                r"oc|bss|based\s+on|from\s+)\b", re.I,
            )
            if left and descriptor.search(right):
                value = left
        trailing = re.compile(
            r"(?:[\s_.-]+)(?:krea\s*\.?\s*2|krea2|k2|sdxl|flux(?:[\s._-]*\d+)?|pony|"
            r"z[\s._-]*image(?:[\s._-]*turbo)?|fp8|bf16|epoch[\s._-]*\d+|step[\s._-]*\d+|"
            r"v(?:er(?:sion)?)?[\s._-]*\d+(?:\.\d+)*)\s*$", re.I,
        )
        for _ in range(5):
            trimmed = trailing.sub("", value)
            if trimmed == value or not trimmed.strip():
                break
            value = trimmed
        value = re.sub(r"\s*(?:[-_:]\s*)?(?:character\s+)?lora\s*$", "", value, flags=re.I)

    value = re.sub(r"\s*(?:\(\s*\d+\s*\)|\[\s*\d+\s*\])\s*$", "", value)
    value = re.sub(r"(?:[\s._-]+copy)+(?:[\s._-]*\d+)?\s*$", "", value, flags=re.I)
    value = re.sub(r"\s{2,}", " ", value)
    value = re.sub(r"\s*\|\s*", " - ", value)
    value = re.sub(r"(?:\s*[-:]\s*){2,}", " - ", value)
    value = re.sub(r"\(\s*\)|\[\s*\]|\{\s*\}", " ", value)
    value = re.sub(r"^[\s+\-_.|:\[\](){}]+|[\s+\-_.|:\[\](){}]+$", "", value)
    value = re.sub(r"\s{2,}", " ", value).strip()
    return safe_name(value, "") if value else ""


def identity_comparable(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def contains_identity_phrase(haystack: str, needle: str) -> bool:
    if not (haystack or "").strip() or not (needle or "").strip():
        return False
    left = re.sub(r"[^a-z0-9]+", " ", haystack.lower()).strip()
    right = re.sub(r"[^a-z0-9]+", " ", needle.lower()).strip()
    return bool(left and right and f" {right} " in f" {left} ")


def test_collection_title(value: str) -> bool:
    return bool(value and re.search(
        r"\b(?:character\s*pack|characters|collection|bundle|model\s*pack|models|series|girls|various|all[\s_-]*in[\s_-]*one)\b",
        value, flags=re.I,
    ))


def test_identity_noise_token(token: str) -> bool:
    if not (token or "").strip():
        return True
    value = re.sub(r"[^a-z0-9]+", "", token.lower())
    if not value or value.isdigit():
        return True
    if re.match(r"^(?:v|ver|version|epoch|step)\d+$", value):
        return True
    if re.match(r"^lds\d*$", value) or re.match(r"^automagic\d*(?:test)?$", value):
        return True
    return bool(re.match(
        r"^(?:krea|krea2|k2|raw|fp8|bf16|sdxl|xl|flux|pony|zimage|turbo|lora|character|characters|"
        r"style|model|models|trained|training|trigger|fixed|final|redux|latest|release|version|ver|epoch|"
        r"step|steps|copy|local|ulocal|lds|cv|hd|test|automagic|more|similarity|between|realism|realistic|"
        r"photoreal|checkpoint|ckpt|quality|detailed|detail|masterpiece|uhd)$", value,
    ))


def test_technical_version_name(value: str) -> bool:
    if not (value or "").strip():
        return True
    working = re.sub(r"([a-z])([A-Z])", r"\1 \2", value)
    tokens = [item for item in re.split(r"[^A-Za-z0-9]+", working) if item]
    return not tokens or all(test_identity_noise_token(token) for token in tokens)


def identity_phrase_candidates(value: str, max_words: int) -> List[Tuple[str, str]]:
    if not (value or "").strip():
        return []
    working = re.sub(r"([a-z])([A-Z])", r"\1 \2", value)
    tokens = [token for token in re.split(r"[^A-Za-z0-9]+", working) if token and not test_identity_noise_token(token)]
    results: List[Tuple[str, str]] = []
    limit = min(max(max_words, 1), len(tokens))
    for length in range(1, limit + 1):
        for start in range(0, len(tokens) - length + 1):
            display = " ".join(tokens[start:start + length]).strip()
            comparable = identity_comparable(display)
            if len(comparable) >= 2 and is_useful_identity(display):
                results.append((display, comparable))
    return results


def trigger_identity_from_evidence(row: ScanRow) -> TriggerResolution:
    result = TriggerResolution()
    info = row.civitai
    triggers = list(info.trained_words or [])
    if row.metadata.trigger:
        triggers.append(row.metadata.trigger.strip())
    seen: set[str] = set()
    model = clean_smart_name(info.model_name, "model")
    creator = identity_comparable(row.effective_creator or info.creator)
    other = (row.metadata.identity, os.path.splitext(os.path.basename(row.full_path))[0], info.version_name)

    for raw in triggers:
        trigger = (raw or "").strip()
        key = trigger.casefold()
        if not trigger or key in seen or not is_useful_identity(trigger):
            continue
        seen.add(key)
        comparable = identity_comparable(trigger)
        if re.match(r"^(?:ultradetailed|highquality|bestquality|masterpiece|photorealistic|youngwoman|youngman|woman|man|girl|boy|person|character|style|model|lora)$", comparable):
            continue
        best_display = ""
        best_length = 0
        for display, phrase in identity_phrase_candidates(model, 3):
            if len(phrase) >= 2 and phrase in comparable and len(phrase) > best_length:
                best_display, best_length = display, len(phrase)
        if best_display:
            score = 1000 + best_length
            if score > result.score:
                result = TriggerResolution(best_display, "Trigger + Civitai model", score)
            continue
        if creator and comparable.startswith(creator) and len(comparable) > len(creator):
            remainder = comparable[len(creator):]
            for candidate_source in other:
                for display, phrase in identity_phrase_candidates(candidate_source, 3):
                    if phrase == remainder:
                        score = 950 + len(remainder)
                        if score > result.score:
                            result = TriggerResolution(display, "Trigger - creator prefix", score)
    return result


def smart_base_name(row: ScanRow, series_mode: bool, series_reason: str) -> NameChoice:
    info = row.civitai
    model = clean_smart_name(info.model_name, "model")
    version = clean_smart_name(info.version_name, "version")
    embedded = clean_smart_name(row.metadata.identity, "model")
    original = clean_smart_name(os.path.splitext(os.path.basename(row.full_path))[0], "original")
    model_useful = is_useful_identity(model)
    version_useful = not test_technical_version_name(info.version_name) and is_useful_identity(version)
    embedded_useful = is_useful_identity(embedded)
    original_useful = is_useful_identity(original)
    trigger = trigger_identity_from_evidence(row)
    trigger_identity = clean_smart_name(trigger.identity, "model")
    trigger_useful = trigger.score >= 900 and is_useful_identity(trigger_identity)

    if series_mode and model_useful and test_collection_title(model) and version_useful:
        return NameChoice(version, f"Civitai version ({series_reason}; collection title)")
    if trigger_useful:
        return NameChoice(trigger_identity, trigger.source)
    if (original_useful and model_useful and len(original) <= 40 and not re.search(r"\d", original)
            and not re.search(r"\b(?:copy|final|fixed|raw|epoch|step|version|trigger|test|automagic)\b", original, flags=re.I)):
        original_comparable = identity_comparable(original)
        model_comparable = identity_comparable(model)
        clean_support = bool(original_comparable) and (
            model_comparable.startswith(original_comparable) or original_comparable in model_comparable
        )
        if original_comparable and (clean_support or contains_identity_phrase(info.model_name, original)):
            return NameChoice(original, "Original + Civitai model")
    if model_useful and not test_collection_title(model):
        return NameChoice(model, "Civitai model")
    if model_useful and test_collection_title(model) and version_useful:
        return NameChoice(version, "Civitai version (collection title)")
    if embedded_useful:
        return NameChoice(embedded, row.metadata.identity_source or "Embedded identity")
    if version_useful:
        return NameChoice(version, "Civitai version fallback")
    if original_useful:
        return NameChoice(original, "Original")
    for trained_word in info.trained_words or []:
        clean = clean_smart_name(trained_word, "original")
        if is_useful_identity(clean):
            return NameChoice(clean, "Trigger fallback")
    embedded_trigger = clean_smart_name(row.metadata.trigger, "original")
    if is_useful_identity(embedded_trigger):
        return NameChoice(embedded_trigger, "Trigger fallback")
    stem = os.path.splitext(os.path.basename(row.full_path))[0]
    return NameChoice(safe_name(stem, "Untitled"), "Original fallback")


def get_primary_category(tags: Sequence[str]) -> str:
    normalized = {tag.strip().casefold() for tag in tags or [] if tag and tag.strip()}
    aliases = (
        ("Character", "character", "characters"), ("Style", "style", "styles"),
        ("Concept", "concept", "concepts"), ("Clothing", "clothing", "clothes", "outfit", "outfits"),
        ("Base Model", "base model", "base models"), ("Background", "background", "backgrounds"),
        ("Poses", "pose", "poses"), ("Tool", "tool", "tools"), ("Assets", "asset", "assets"),
        ("Vehicle", "vehicle", "vehicles"), ("Buildings", "building", "buildings"),
        ("Objects", "object", "objects"), ("Animal", "animal", "animals"),
        ("Action", "action", "actions"),
    )
    for canonical, *names in aliases:
        if any(name.casefold() in normalized for name in names):
            return canonical
    return "Other"


def get_base_model_folder(base_model: str) -> str:
    if not (base_model or "").strip():
        return "Unknown Base"
    value = base_model.strip()
    normalized = value.lower()
    compact = re.sub(r"[^a-z0-9]+", "", normalized)
    if compact == "krea2" or re.match(r"^krea\s*[.\-_ ]?\s*2$", normalized, flags=re.I): return "Krea 2"
    if compact in {"zimageturbo", "zturbo"} or re.match(r"^z[\s\-_]*image[\s\-_]*turbo$", normalized, flags=re.I): return "Z-Turbo"
    if compact == "zimage" or re.match(r"^z[\s\-_]*image$", normalized, flags=re.I): return "Z-Image"
    if "illustrious" in normalized: return "Illustrious"
    if "pony" in normalized: return "Pony"
    if compact in {"sdxl", "stablediffusionxl"} or re.match(r"^stable\s+diffusion\s+xl$", normalized, flags=re.I): return "SDXL"
    if compact in {"sd15", "stablediffusion15"} or re.match(r"^stable\s+diffusion\s+1[. ]5$", normalized, flags=re.I): return "SD 1.5"
    if re.search(r"flux.*schnell|schnell.*flux", normalized, flags=re.I): return "Flux Schnell"
    if re.search(r"flux.*(?:dev|\.1\s*d)|(?:dev|\.1\s*d).*flux", normalized, flags=re.I): return "Flux Dev"
    if "flux" in normalized: return "Flux"
    if "hidream" in normalized: return "HiDream"
    if re.search(r"qwen.*image", normalized, flags=re.I): return "Qwen Image"
    if re.search(r"hunyuan.*video", normalized, flags=re.I): return "Hunyuan Video"
    if re.search(r"wan.*2[. ]2", normalized, flags=re.I): return "Wan 2.2"
    if re.search(r"wan.*2[. ]1", normalized, flags=re.I): return "Wan 2.1"
    if normalized.startswith("wan"): return "Wan"
    return value


def is_organizer_category_folder(folder: str) -> bool:
    return (folder or "").strip().casefold() in {name.casefold() for name in ORGANIZER_CATEGORIES}


def is_creator_shaped_folder(folder: str, base_folder: str, category: str) -> bool:
    value = (folder or "").strip()
    if not value or value in {".", ".."} or value.startswith("."):
        return False
    if base_folder and value.casefold() == base_folder.casefold():
        return False
    if category and value.casefold() == category.casefold():
        return False
    structural = {
        "Other", "Uncharted", "Unknown Base", "Unknown Creator", *ORGANIZER_CATEGORIES,
        "Krea 2", "Z-Turbo", "Z-Image", "Illustrious", "Pony", "SDXL", "SD 1.5",
        "Flux", "Flux Dev", "Flux Schnell", "HiDream", "Qwen Image", "Hunyuan Video",
        "Wan", "Wan 2.1", "Wan 2.2", "LoRA", "LoRAs", "Lora", "Loras", "models", "model",
        "checkpoints", "embeddings", "lycoris",
    }
    return value.casefold() not in {name.casefold() for name in structural}


def infer_creator_from_existing_folder(root: str, path: str, base_folder: str, category: str) -> str:
    try:
        directory = os.path.dirname(path)
        segments = [part.strip() for part in re.split(r"[\\/]", relative_path(root, directory)) if part.strip() and part != "."]
        for index, segment in enumerate(segments):
            if base_folder and base_folder != "Unknown Base" and segment.casefold() == base_folder.casefold():
                candidate = index + 1
                if candidate < len(segments) and (
                    (category and segments[candidate].casefold() == category.casefold())
                    or is_organizer_category_folder(segments[candidate])
                ):
                    candidate += 1
                if candidate < len(segments) and is_creator_shaped_folder(segments[candidate], base_folder, category):
                    return segments[candidate]
        for index in range(len(segments) - 1):
            if is_organizer_category_folder(segments[index]) and is_creator_shaped_folder(segments[index + 1], base_folder, category):
                return segments[index + 1]
        parent = os.path.basename(directory.rstrip("\\/"))
        return parent if is_creator_shaped_folder(parent, base_folder, category) else ""
    except Exception:
        return ""
