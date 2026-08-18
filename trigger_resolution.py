from __future__ import annotations

"""Conservative trigger candidate normalization and ranking.

This module deliberately separates *evidence* from *injection*.  A Civitai
author can publish a whole prompt recipe as a trained word; it is useful to
show that evidence in the Trigger Builder, but unsafe to automatically treat
it as a concise LoRA activation token.
"""

import re
from typing import Any

from .civitai_trigger import normalize_trigger_text


_WEIGHT_SUFFIX = re.compile(r"\s*:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$")
_OUTER_WRAPPERS = re.compile(r"^[\s\[\](){}]+|[\s\[\](){}]+$")


def _first_top_level_segment(value: str) -> str:
    """Return text before the first top-level comma without breaking ``(a,b)``."""

    depth = 0
    for index, char in enumerate(value):
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            return value[:index]
    return value


def clean_candidate(value: Any) -> str:
    """Create a short candidate display without changing meaningful symbols."""

    text = normalize_trigger_text(value)
    if not text:
        return ""
    text = _first_top_level_segment(text)
    text = _OUTER_WRAPPERS.sub("", text)
    text = _WEIGHT_SUFFIX.sub("", text)
    return normalize_trigger_text(text)


def classify_candidate(value: Any, source: str) -> dict[str, Any]:
    """Return a UI-safe trigger candidate.

    ``auto_select`` is intentionally strict.  Anything that resembles a
    comma-delimited recipe, weighted prompt, or unusually long phrase remains
    available to the user but will never populate ``main_trigger`` by itself.
    """

    raw = normalize_trigger_text(value)
    clean = clean_candidate(raw)
    flags: list[str] = []
    lowered = raw.casefold()
    if len(raw) > 96:
        flags.append("long")
    if raw.count(",") >= 2:
        flags.append("recipe")
    if "(" in raw or ")" in raw or bool(_WEIGHT_SUFFIX.search(raw)):
        flags.append("weighted")
    if len(clean.split()) > 8:
        flags.append("verbose")
    if not clean:
        flags.append("empty")
    if source == "modelspec.title":
        flags.append("identity-only")

    confidence = {
        "modelspec.trigger_phrase": 0.98,
        "embedded": 0.94,
        "civitai.trainedWords": 0.88,
        "civitai.sidecar": 0.84,
        "ss_tag_frequency": 0.60,
        "modelspec.title": 0.10,
    }.get(source, 0.50)
    # Broad source aliases use their intended confidence too.
    if source.startswith("civitai."):
        confidence = 0.88 if source.endswith("trainedWords") else 0.84
    elif source.endswith("trigger_phrase") or source.endswith("trigger"):
        confidence = max(confidence, 0.94)

    return {
        "raw": raw,
        "clean": clean,
        "source": source,
        "confidence": confidence,
        "flags": flags,
        "auto_select": bool(clean and not flags),
        # Keep the original phrase intact for transparent inspection.
        "suggested": clean if clean and clean != raw else raw,
    }


def choose_automatic(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick only an explicitly safe candidate, preserving source priority."""

    safe = [item for item in candidates if item.get("auto_select")]
    if not safe:
        return None
    return max(safe, key=lambda item: float(item.get("confidence", 0)))
