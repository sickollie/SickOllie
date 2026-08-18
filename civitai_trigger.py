from __future__ import annotations

"""Civitai trigger-word fallback shared by Classic and Studio Loader Core.

The LoRA itself remains the first source of truth.  This module is only called
after embedded trigger metadata and tag-frequency inference have produced no
answer.  It checks common Civitai sidecars before using the file's SHA-256 with
Civitai's public model-version-by-hash endpoint.
"""

import hashlib
import html
import json
import os
import threading
import time
from typing import Any
from urllib.request import Request, urlopen


_API_ROOT = "https://civitai.com/api/v1/model-versions/by-hash"
_MAX_SIDECAR_BYTES = 8 * 1024 * 1024
_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_NEGATIVE_CACHE_SECONDS = 10 * 60
_CACHE_LOCK = threading.RLock()
_CacheKey = tuple[str, int, int, tuple[tuple[str, int, int], ...]]
_CACHE: dict[_CacheKey, tuple[float, str, str]] = {}
_CANDIDATE_CACHE: dict[_CacheKey, tuple[float, tuple[str, ...], str]] = {}

_TRIGGER_KEYS = (
    "trainedWords",
    "trained_words",
    "triggerWords",
    "trigger_words",
    "triggerPhrase",
    "trigger_phrase",
    "activationText",
    "activation_text",
    "ss_trigger_words",
    "trigger",
)

_ENTRY_KEYS = (
    "word",
    "value",
    "trigger",
    "text",
    "name",
)

_NESTED_HINT_KEYS = (
    "modelVersion",
    "model_version",
    "version",
    "metadata",
    "civitai",
    "model",
)


def normalize_trigger_text(value: Any) -> str:
    """Normalize whitespace/entities while preserving meaningful punctuation."""

    if value is None or isinstance(value, (dict, list, tuple, set)):
        return ""
    text = html.unescape(str(value)).replace("\x00", "")
    return " ".join(text.split()).strip()


def _triggers_from_entry(value: Any) -> list[str]:
    if isinstance(value, str):
        trigger = normalize_trigger_text(value)
        return [trigger] if trigger else []

    if isinstance(value, (list, tuple)):
        values: list[str] = []
        for item in value:
            values.extend(_triggers_from_entry(item))
        return values

    if isinstance(value, dict):
        for key in _ENTRY_KEYS:
            if key in value:
                values = _triggers_from_entry(value.get(key))
                if values:
                    return values
    return []


def _trigger_from_entry(value: Any) -> str:
    """Compatibility helper returning the first declared trigger."""

    values = _triggers_from_entry(value)
    return values[0] if values else ""


def triggers_from_civitai_payload(payload: Any, depth: int = 0) -> list[str]:
    """Return every explicit trigger declared by a Civitai payload.

    Civitai's ``trainedWords`` is often a proper list.  The prior helper
    returned only its first value, which discarded useful alternatives and
    made a later Trigger Builder impossible.  Strings unrelated to explicit
    trigger keys are still never guessed.
    """

    if depth > 8:
        return []

    values: list[str] = []
    if isinstance(payload, dict):
        for key in _TRIGGER_KEYS:
            if key in payload:
                values.extend(_triggers_from_entry(payload.get(key)))

        visited: set[str] = set()
        for key in _NESTED_HINT_KEYS:
            if key not in payload:
                continue
            visited.add(key)
            values.extend(triggers_from_civitai_payload(payload.get(key), depth + 1))

        for key, value in payload.items():
            if key in visited or not isinstance(value, (dict, list, tuple)):
                continue
            values.extend(triggers_from_civitai_payload(value, depth + 1))
    elif isinstance(payload, (list, tuple)):
        for value in payload:
            if isinstance(value, (dict, list, tuple)):
                values.extend(triggers_from_civitai_payload(value, depth + 1))

    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = normalize_trigger_text(value)
        key = normalized.casefold()
        if normalized and key not in seen:
            seen.add(key)
            unique.append(normalized)
    return unique


def trigger_from_civitai_payload(payload: Any, depth: int = 0) -> str:
    """Read a declared trigger from Civitai API data or common sidecar shapes."""

    values = triggers_from_civitai_payload(payload, depth)
    return values[0] if values else ""


def _sidecar_candidates(lora_path: str) -> list[str]:
    base, _extension = os.path.splitext(lora_path)
    candidates = (
        f"{base}.civitai.info",
        f"{base}.civitai.json",
        f"{base}.metadata.json",
        f"{base}.info.json",
        f"{base}.rgthree-info.json",
        f"{base}.json",
        f"{lora_path}.json",
        f"{lora_path}.rgthree-info.json",
    )
    return list(dict.fromkeys(candidates))


def _read_json_file(path: str) -> Any:
    try:
        if os.path.getsize(path) > _MAX_SIDECAR_BYTES:
            return None
        with open(path, "r", encoding="utf-8-sig") as handle:
            return json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def _file_identity(path: str) -> _CacheKey | None:
    try:
        stat = os.stat(path)
    except OSError:
        return None

    sidecars: list[tuple[str, int, int]] = []
    for candidate in _sidecar_candidates(path):
        try:
            sidecar_stat = os.stat(candidate)
        except OSError:
            continue
        sidecars.append(
            (
                os.path.abspath(candidate),
                int(sidecar_stat.st_size),
                int(sidecar_stat.st_mtime_ns),
            )
        )

    return (
        os.path.abspath(path),
        int(stat.st_size),
        int(stat.st_mtime_ns),
        tuple(sidecars),
    )


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _api_payload(file_hash: str, timeout: float) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "ComfyUI-SickOllie/2.2.0",
    }
    token = os.getenv("CIVITAI_API_TOKEN") or os.getenv("CIVITAI_API_KEY")
    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"

    request = Request(f"{_API_ROOT}/{file_hash}", headers=headers, method="GET")
    with urlopen(request, timeout=timeout) as response:
        body = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(body) > _MAX_RESPONSE_BYTES:
        raise ValueError("Civitai response exceeded the safety limit")
    return json.loads(body.decode("utf-8"))


def fetch_civitai_payload(lora_path: str, timeout: float = 9.0) -> Any:
    """Return the exact Civitai model-version payload for a local LoRA.

    Library surfaces use the same bounded request and optional API token as
    trigger fallback.  The lookup is exact-hash only; filenames are never used
    to guess a model page.
    """

    if not os.path.isfile(lora_path):
        raise FileNotFoundError(lora_path)
    return _api_payload(_sha256(lora_path), timeout)


def _cached(identity: _CacheKey) -> tuple[str, str] | None:
    with _CACHE_LOCK:
        cached = _CACHE.get(identity)
    if cached is None:
        return None
    cached_at, trigger, source = cached
    if trigger or time.monotonic() - cached_at < _NEGATIVE_CACHE_SECONDS:
        return trigger, source
    with _CACHE_LOCK:
        _CACHE.pop(identity, None)
    return None


def _store(identity: _CacheKey, trigger: str, source: str) -> tuple[str, str]:
    result = normalize_trigger_text(trigger), str(source or "")
    with _CACHE_LOCK:
        _CACHE[identity] = (time.monotonic(), result[0], result[1])
    return result


def detect_civitai_trigger(lora_path: str, timeout: float = 7.0) -> tuple[str, str]:
    """Return ``(trigger, source)`` from sidecar/API, or two empty strings.

    Results are cached by path, size, and nanosecond modification time.  That
    keeps normal node refreshes instant while invalidating a replaced LoRA.
    """

    identity = _file_identity(lora_path)
    if identity is None:
        return "", ""

    cached = _cached(identity)
    if cached is not None:
        return cached

    for sidecar in _sidecar_candidates(lora_path):
        if not os.path.isfile(sidecar):
            continue
        trigger = trigger_from_civitai_payload(_read_json_file(sidecar))
        if trigger:
            return _store(identity, trigger, "civitai.sidecar")

    try:
        payload = _api_payload(_sha256(lora_path), timeout)
        trigger = trigger_from_civitai_payload(payload)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        trigger = ""

    if trigger:
        return _store(identity, trigger, "civitai.trainedWords")
    return _store(identity, "", "")


def detect_civitai_triggers(lora_path: str, timeout: float = 7.0) -> tuple[list[str], str]:
    """Return all declared Civitai trigger candidates and their provenance."""

    identity = _file_identity(lora_path)
    if identity is None:
        return [], ""
    with _CACHE_LOCK:
        cached = _CANDIDATE_CACHE.get(identity)
    if cached is not None:
        cached_at, values, source = cached
        if values or time.monotonic() - cached_at < _NEGATIVE_CACHE_SECONDS:
            return list(values), source

    values: list[str] = []
    source = ""
    for sidecar in _sidecar_candidates(lora_path):
        if not os.path.isfile(sidecar):
            continue
        values = triggers_from_civitai_payload(_read_json_file(sidecar))
        if values:
            source = "civitai.sidecar"
            break
    if not values:
        try:
            values = triggers_from_civitai_payload(_api_payload(_sha256(lora_path), timeout))
        except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
            values = []
        if values:
            source = "civitai.trainedWords"
    with _CACHE_LOCK:
        _CANDIDATE_CACHE[identity] = (time.monotonic(), tuple(values), source)
    return values, source


def clear_trigger_cache() -> None:
    """Clear the in-process fallback cache (primarily useful to tests)."""

    with _CACHE_LOCK:
        _CACHE.clear()
        _CANDIDATE_CACHE.clear()
