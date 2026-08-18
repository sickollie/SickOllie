from __future__ import annotations

import json
import re
import struct
from typing import Any, Dict

from .models import SafeTensorMetadata


MAX_HEADER_BYTES = 64 * 1024 * 1024


def _text(metadata: Dict[str, Any], key: str) -> str:
    value = metadata.get(key, "")
    if value is None:
        return ""
    return str(value).strip()


def best_tag_from_frequency(raw: str) -> str:
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return ""
    best = ""
    best_count = -1
    if not isinstance(data, dict):
        return ""
    for bucket in data.values():
        if not isinstance(bucket, dict):
            continue
        for tag, count in bucket.items():
            if not str(tag).strip():
                continue
            try:
                numeric = int(count)
            except (TypeError, ValueError):
                numeric = 0
            if numeric > best_count:
                best_count = numeric
                best = str(tag).strip()
    return best


def normalize_identity(value: str) -> str:
    return re.sub(r"\s{2,}", " ", value.strip().replace("_", " ")).strip()


def contains_cjk(value: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]", value or ""))


def test_generic_name(value: str) -> bool:
    if not value.strip():
        return True
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    tokens = normalized.split()
    if not tokens:
        return True
    noise = re.compile(
        r"^(?:\d+|krea|krea2|k2|sdxl|xl|flux\d*|fp8|bf16|v\d+|ver\d+|version\d+|"
        r"epoch\d+|step\d+|final|latest|release|character|characters|lora|model|models|"
        r"pack|collection|bundle|series|girls|girl)$"
    )
    return all(noise.match(token) for token in tokens)


def is_useful_identity(value: str) -> bool:
    text = (value or "").strip()
    if len(text) < 2 or len(text) > 120 or contains_cjk(text) or test_generic_name(text):
        return False
    normalized = text.lower().strip()
    exact_noise = re.compile(
        r"^(?:young\s+woman|young\s+man|woman|man|girl|boy|person|female|male|subject|character|"
        r"model|lora|untitled|default|none|null|ultra\s*detailed|high\s*detail(?:ed)?|high\s*quality|"
        r"best\s*quality|masterpiece|very\s*detailed|extremely\s*detailed|highly\s*detailed|"
        r"photorealistic|photo\s*realistic|cinematic\s*quality|4k|8k|uhd)$"
    )
    if exact_noise.match(normalized):
        return False
    if re.match(r"^(?:epoch|step|checkpoint|ckpt)[\s_.-]*\d+$", normalized):
        return False
    if re.match(r"^(?:training|train|output|model)[\s_.-]*\d{4,}(?:[\s_.-]\d+)*$", normalized):
        return False
    return not normalized.isdigit()


def read_safetensor_metadata(path: str) -> SafeTensorMetadata:
    result = SafeTensorMetadata()
    try:
        with open(path, "rb") as stream:
            raw_length = stream.read(8)
            if len(raw_length) != 8:
                return result
            header_length = struct.unpack("<Q", raw_length)[0]
            if header_length <= 1 or header_length > MAX_HEADER_BYTES:
                return result
            raw_header = stream.read(header_length)
            if len(raw_header) != header_length:
                return result
        root = json.loads(raw_header.decode("utf-8"))
        result.readable = True
        metadata = root.get("__metadata__", {}) if isinstance(root, dict) else {}
        if not isinstance(metadata, dict):
            return result
        result.title = _text(metadata, "modelspec.title")
        result.trigger = _text(metadata, "modelspec.trigger_phrase")
        if not result.trigger:
            result.trigger = best_tag_from_frequency(_text(metadata, "ss_tag_frequency"))
        result.name = _text(metadata, "name")
        result.output_name = _text(metadata, "ss_output_name")
        result.base_model = _text(metadata, "ss_base_model_version")
        result.model_hash = _text(metadata, "sshs_model_hash")
        result.legacy_hash = _text(metadata, "sshs_legacy_hash")
        choose_embedded_identity(result)
    except (OSError, UnicodeError, ValueError, TypeError, struct.error):
        return result
    return result


def choose_embedded_identity(info: SafeTensorMetadata) -> None:
    # Import locally to keep metadata parsing independent during package startup.
    from .naming import clean_smart_name

    values = (info.title, info.name, info.output_name, info.trigger)
    sources = ("Embedded title", "Embedded name", "Embedded output name", "Embedded trigger")
    kinds = ("model", "model", "model", "original")
    for value, source, kind in zip(values, sources, kinds):
        cleaned = clean_smart_name(value, kind)
        if is_useful_identity(cleaned):
            info.identity = cleaned
            info.identity_source = source
            return
