from __future__ import annotations

import http.client
import json
import time
import urllib.parse
from dataclasses import asdict
from pathlib import Path
from threading import Event, RLock
from typing import Any, Dict

from . import __version__
from .models import CivitaiInfo, CivitaiModelMeta
from .util import Cancelled, atomic_json_write, check_cancel, load_json


class CivitaiHTTPError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _string(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _strings(value: Any) -> list[str]:
    return [_string(item) for item in value] if isinstance(value, list) else []


class CivitaiClient:
    def __init__(self, cache_path: str | Path, user_agent: str = ""):
        self.cache_path = Path(cache_path)
        self.user_agent = user_agent or f"SOLO-LoRA-Organizer/{__version__}"
        self._lock = RLock()
        self._active: Dict[int, http.client.HTTPSConnection] = {}
        self.hash_cache: Dict[str, CivitaiInfo] = {}
        self.model_cache: Dict[str, CivitaiModelMeta] = {}
        self._load()

    def _load(self) -> None:
        raw = load_json(self.cache_path, {})
        if not isinstance(raw, dict):
            return
        for key, value in (raw.get("results") or {}).items():
            if not isinstance(value, dict):
                continue
            try:
                allowed = {field.name for field in CivitaiInfo.__dataclass_fields__.values()}
                info = CivitaiInfo(**{name: value[name] for name in allowed if name in value})
                if info.found or info.status == "Hash not found on Civitai":
                    self.hash_cache[key.upper()] = info
            except (TypeError, ValueError):
                continue
        for key, value in (raw.get("models") or {}).items():
            if not isinstance(value, dict):
                continue
            try:
                allowed = {field.name for field in CivitaiModelMeta.__dataclass_fields__.values()}
                meta = CivitaiModelMeta(**{name: value[name] for name in allowed if name in value})
                if meta.complete:
                    self.model_cache[str(key)] = meta
            except (TypeError, ValueError):
                continue

    def save(self) -> None:
        with self._lock:
            payload = {
                "cacheVersion": 4,
                "results": {key: asdict(value) for key, value in self.hash_cache.items()},
                "models": {key: asdict(value) for key, value in self.model_cache.items()},
                "fingerprints": {},
            }
        try:
            atomic_json_write(self.cache_path, payload)
        except OSError:
            pass

    def abort(self, cancel: Event | None) -> None:
        if cancel is None:
            return
        with self._lock:
            connection = self._active.get(id(cancel))
        if connection is not None:
            try:
                connection.close()
            except OSError:
                pass

    @staticmethod
    def _wait(seconds: float, cancel: Event | None) -> None:
        end = time.monotonic() + max(0.0, seconds)
        while time.monotonic() < end:
            check_cancel(cancel)
            time.sleep(min(0.05, max(0.0, end - time.monotonic())))
        check_cancel(cancel)

    def _get_json(self, url: str, token: str, attempts: int, cancel: Event | None) -> Dict[str, Any]:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "civitai.com":
            raise ValueError("SOLO only permits Civitai API requests to civitai.com")
        path = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        for attempt in range(1, attempts + 1):
            self._wait(0.1, cancel)
            connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=20)
            with self._lock:
                if cancel is not None:
                    self._active[id(cancel)] = connection
            try:
                headers = {"Accept": "application/json", "User-Agent": self.user_agent}
                if token.strip():
                    headers["Authorization"] = "Bearer " + token.strip()
                check_cancel(cancel)
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                status = int(response.status)
                body = response.read(16 * 1024 * 1024 + 1)
                check_cancel(cancel)
                if len(body) > 16 * 1024 * 1024:
                    raise CivitaiHTTPError(status, "Civitai response exceeded 16 MiB")
                if 200 <= status < 300:
                    value = json.loads(body.decode("utf-8"))
                    if not isinstance(value, dict):
                        raise CivitaiHTTPError(status, "unexpected JSON response")
                    return value
                retryable = status in {429, 500, 502, 503, 504}
                if retryable and attempt < attempts:
                    retry_after = response.getheader("Retry-After")
                    try:
                        delay = min(max(float(retry_after or 0), 0.0), 8.0)
                    except ValueError:
                        delay = 0.0
                    if delay <= 0:
                        delay = min(2 ** (attempt - 1), 8)
                    self._wait(delay, cancel)
                    continue
                raise CivitaiHTTPError(status, response.reason or f"HTTP {status}")
            except Cancelled:
                raise
            except (OSError, http.client.HTTPException, json.JSONDecodeError, UnicodeError) as exc:
                check_cancel(cancel)
                if attempt < attempts:
                    self._wait(min(2 ** (attempt - 1), 8), cancel)
                    continue
                raise CivitaiHTTPError(0, str(exc)) from exc
            finally:
                with self._lock:
                    if cancel is not None and self._active.get(id(cancel)) is connection:
                        self._active.pop(id(cancel), None)
                try:
                    connection.close()
                except OSError:
                    pass
        raise CivitaiHTTPError(0, "Civitai request failed after retries")

    def lookup_model(self, model_id: str, token: str, cancel: Event | None) -> CivitaiModelMeta:
        if not model_id:
            return CivitaiModelMeta(error="missing model id")
        with self._lock:
            cached = self.model_cache.get(model_id)
            if cached and cached.complete:
                return cached
        result = CivitaiModelMeta()
        try:
            model = self._get_json(
                "https://civitai.com/api/v1/models/" + urllib.parse.quote(model_id, safe=""),
                token, 4, cancel,
            )
            creator = model.get("creator") if isinstance(model.get("creator"), dict) else {}
            result = CivitaiModelMeta(
                complete=True,
                model_name=_string(model.get("name")),
                creator=_string(creator.get("username")),
                tags=_strings(model.get("tags")),
                model_type=_string(model.get("type")),
            )
            with self._lock:
                self.model_cache[model_id] = result
        except CivitaiHTTPError as exc:
            result.error = f"HTTP {exc.status}" if exc.status else str(exc)
        return result

    def lookup_hash(self, sha256: str, token: str = "", cancel: Event | None = None) -> CivitaiInfo:
        key = sha256.upper()
        with self._lock:
            cached = self.hash_cache.get(key)
            if cached and ((cached.found and cached.model_meta_complete) or (
                not cached.found and cached.status == "Hash not found on Civitai"
            )):
                return cached

        result = CivitaiInfo()
        try:
            version = self._get_json(
                "https://civitai.com/api/v1/model-versions/by-hash/" + urllib.parse.quote(key, safe=""),
                token, 4, cancel,
            )
            version_model = version.get("model") if isinstance(version.get("model"), dict) else {}
            model_id = _string(version.get("modelId") or version_model.get("id"))
            model_name = _string(version_model.get("name") or version.get("modelName"))
            creator_map = version_model.get("creator") if isinstance(version_model.get("creator"), dict) else {}
            creator = _string(creator_map.get("username"))
            tags = _strings(version_model.get("tags"))
            model_type = _string(version_model.get("type"))
            meta = self.lookup_model(model_id, token, cancel)
            if meta.model_name: model_name = meta.model_name
            if meta.creator: creator = meta.creator
            if meta.tags: tags = list(meta.tags)
            if meta.model_type: model_type = meta.model_type
            version_id = _string(version.get("id"))
            page_url = ""
            if model_id:
                page_url = "https://civitai.com/models/" + model_id
                if version_id:
                    page_url += "?modelVersionId=" + version_id
            status = "Found"
            if not meta.complete:
                status = "Found - model metadata lookup incomplete"
            elif not creator:
                status = "Found - Civitai did not provide a creator"
            result = CivitaiInfo(
                found=True,
                model_id=model_id,
                version_id=version_id,
                model_name=model_name,
                version_name=_string(version.get("name")),
                creator=creator,
                base_model=_string(version.get("baseModel")),
                trained_words=_strings(version.get("trainedWords")),
                tags=tags,
                model_type=model_type,
                page_url=page_url,
                status=status,
                model_meta_complete=meta.complete,
                model_lookup_error=meta.error,
            )
        except CivitaiHTTPError as exc:
            if exc.status == 404:
                result.status = "Hash not found on Civitai"
            elif exc.status in {401, 403}:
                result.status = "Civitai access denied (try an API token)"
            elif exc.status == 429:
                result.status = "Civitai rate limit persisted after retries"
            elif exc.status:
                result.status = f"Civitai HTTP {exc.status}"
            else:
                result.status = "API error: " + str(exc)
        if result.found or result.status == "Hash not found on Civitai":
            with self._lock:
                self.hash_cache[key] = result
        return result
