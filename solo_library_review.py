from __future__ import annotations

"""Visual LoRA catalog, review state, compact thumbnails, and safe local API."""

import asyncio
import hashlib
import io
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import folder_paths
from PIL import Image, ImageOps

from .civitai_trigger import fetch_civitai_payload, triggers_from_civitai_payload
from .solo_catalog import get_catalog

try:
    from aiohttp import web
    from server import PromptServer
except Exception:  # pragma: no cover
    web = None
    PromptServer = None


_MAX_UPLOAD_BYTES = 24 * 1024 * 1024
_MAX_REMOTE_BYTES = 16 * 1024 * 1024
_MAX_THUMB_BYTES = 160 * 1024
_MAX_IMAGE_PIXELS = 100_000_000
_THUMB_BOUND = (384, 512)
_EPOCH_RE = re.compile(r"(?:^|[_\-\s])epoch[_\-\s]?(\d+)(?=$|[_\-\s.])", re.IGNORECASE)
_SUPPORTED_REMOTE_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _lora_roots() -> list[Path]:
    getter = getattr(folder_paths, "get_folder_paths", None)
    roots = getter("loras") if callable(getter) else []
    return [Path(path).resolve() for path in roots if Path(path).is_dir()]


def _inside_lora_root(path: Path) -> bool:
    try:
        resolved = path.resolve()
        return any(resolved.is_relative_to(root) for root in _lora_roots())
    except (OSError, ValueError):
        return False


def _path_asset_id(path: Path) -> str:
    return get_catalog().path_asset_id(path.resolve())


def _resolve_lora_name(lora_name: str) -> Path | None:
    clean = str(lora_name or "").strip()
    if not clean:
        return None
    getter = getattr(folder_paths, "get_full_path", None)
    if callable(getter):
        try:
            found = getter("loras", clean)
            if found and Path(found).is_file():
                return Path(found).resolve()
        except Exception:
            pass
    normalized = clean.replace("\\", "/")
    for root in _lora_roots():
        candidate = root / Path(normalized)
        if candidate.is_file():
            return candidate.resolve()
    return None


def _relative_lora_name(path: str | os.PathLike[str]) -> str:
    resolved = Path(path).resolve()
    for root in _lora_roots():
        try:
            return resolved.relative_to(root).as_posix()
        except ValueError:
            continue
    return ""


def _epoch_number(value: str) -> int | None:
    match = _EPOCH_RE.search(Path(value).stem)
    return int(match.group(1)) if match else None


def _enrich_asset(asset: dict[str, Any]) -> dict[str, Any]:
    value = dict(asset)
    relative = _relative_lora_name(str(value.get("current_path") or ""))
    value["relative_lora"] = relative
    parent = Path(relative).parent.as_posix() if relative else ""
    value["folder"] = "[Root]" if parent in {"", "."} else parent
    value["epoch"] = _epoch_number(relative or str(value.get("model_name") or ""))
    remote = value.get("remote_metadata")
    if isinstance(remote, dict):
        cleaned_remote = dict(remote)
        cleaned_remote["images"] = [
            clean for clean in (_valid_civitai_image_url(item) for item in (remote.get("images") or [])) if clean
        ]
        value["remote_metadata"] = cleaned_remote
    if value.get("civitai_preview") and not _valid_civitai_image_url(value.get("civitai_preview")):
        value["civitai_preview"] = ""
    thumbnail = value.get("thumbnail")
    filename = str((thumbnail or {}).get("filename") or value.get("thumbnail_ref") or "")
    available = bool(filename and Path(filename).name == filename and (_thumbnail_directory() / filename).is_file())
    value["thumbnail_available"] = available
    if thumbnail is not None and not available:
        value["thumbnail"] = None
    return value


def _is_live_library_asset(asset: dict[str, Any]) -> bool:
    """The catalog keeps history, but the visual library only shows live LoRAs."""
    try:
        path = Path(str(asset.get("current_path") or ""))
        return path.is_file() and _inside_lora_root(path)
    except OSError:
        return False


def _live_catalog_assets(state: str = "", query: str = "", sort: str = "recent") -> list[dict[str, Any]]:
    return [
        asset for asset in get_catalog().list_assets(state, query, sort)
        if _is_live_library_asset(asset)
    ]


def _sidecar_candidates(lora_path: Path) -> list[Path]:
    base = lora_path.with_suffix("")
    values = [
        Path(f"{base}.civitai.info"), Path(f"{base}.civitai.json"),
        Path(f"{base}.metadata.json"), Path(f"{base}.info.json"),
        Path(f"{base}.rgthree-info.json"), Path(f"{base}.json"),
        Path(f"{lora_path}.json"), Path(f"{lora_path}.rgthree-info.json"),
    ]
    return list(dict.fromkeys(values))


def _read_json(path: Path) -> Any:
    try:
        if path.stat().st_size > 8 * 1024 * 1024:
            return None
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def _sidecar_payload(lora_path: Path) -> tuple[Any, str]:
    for path in _sidecar_candidates(lora_path):
        if path.is_file():
            payload = _read_json(path)
            if isinstance(payload, (dict, list)):
                return payload, path.name
    return None, ""


def _valid_civitai_image_url(value: Any) -> str:
    url = str(value or "").strip()
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host == "civitai.com" or host.endswith(".civitai.com")):
        return ""
    if Path(parsed.path).suffix.casefold() not in _SUPPORTED_REMOTE_IMAGE_SUFFIXES:
        return ""
    return url


def _image_urls(payload: Any, depth: int = 0) -> list[str]:
    if depth > 8:
        return []
    values: list[str] = []
    if isinstance(payload, dict):
        for key, item in payload.items():
            if str(key).casefold() == "images" and isinstance(item, list):
                for image in item:
                    if isinstance(image, dict):
                        url = _valid_civitai_image_url(image.get("url"))
                    else:
                        url = _valid_civitai_image_url(image)
                    if url:
                        values.append(url)
            elif isinstance(item, (dict, list)):
                values.extend(_image_urls(item, depth + 1))
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, (dict, list)):
                values.extend(_image_urls(item, depth + 1))
    return list(dict.fromkeys(values))[:24]


def _normalized_civitai(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    model = payload.get("model") if isinstance(payload.get("model"), dict) else {}
    creator = model.get("creator") if isinstance(model.get("creator"), dict) else {}
    model_id = payload.get("modelId") or payload.get("model_id") or model.get("id") or ""
    version_id = payload.get("id") or payload.get("modelVersionId") or payload.get("model_version_id") or ""
    creator_value = creator.get("username") or payload.get("creator") or ""
    if isinstance(creator_value, dict):
        creator_value = creator_value.get("username") or creator_value.get("name") or ""
    return {
        "model_id": str(model_id or ""),
        "version_id": str(version_id or ""),
        "model_name": str(model.get("name") or payload.get("modelName") or payload.get("name") or ""),
        "version_name": str(payload.get("name") or payload.get("versionName") or ""),
        "creator": str(creator_value or ""),
        "base_model": str(payload.get("baseModel") or payload.get("base_model") or ""),
        "trained_words": triggers_from_civitai_payload(payload),
        "images": _image_urls(payload),
        "published_at": str(payload.get("publishedAt") or payload.get("createdAt") or ""),
        "model_page": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id else "",
    }


def _local_preview(lora_path: Path) -> Path | None:
    base = lora_path.with_suffix("")
    candidates: list[Path] = []
    for suffix in (".webp", ".png", ".jpg", ".jpeg"):
        candidates.extend([
            Path(f"{base}.preview{suffix}"), Path(f"{lora_path}.preview{suffix}"),
            Path(f"{base}{suffix}"),
        ])
    return next((path for path in dict.fromkeys(candidates) if path.is_file()), None)


def _thumbnail_directory() -> Path:
    directory = get_catalog().path.parent / "lora_thumbnails"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _thumbnail_filename(asset_id: str) -> str:
    return f"{hashlib.sha1(asset_id.encode('utf-8')).hexdigest()}.webp"

def _thumbnail_record_available(thumbnail: dict[str, Any] | None) -> bool:
    filename = str((thumbnail or {}).get("filename") or "")
    if not filename or Path(filename).name != filename or not filename.endswith(".webp"):
        return False
    return (_thumbnail_directory() / filename).is_file()


def _delete_thumbnail_files(records: list[dict[str, Any]], *, purge_all: bool = False) -> int:
    directory = _thumbnail_directory()
    deleted = 0
    if purge_all:
        for path in directory.glob("*.webp"):
            try:
                path.unlink(missing_ok=True)
                deleted += 1
            except OSError:
                pass
        return deleted
    seen: set[str] = set()
    for record in records or []:
        filename = Path(str(record.get("filename") or "")).name
        if not filename or filename in seen or not filename.endswith(".webp"):
            continue
        seen.add(filename)
        path = directory / filename
        try:
            existed = path.is_file()
            path.unlink(missing_ok=True)
            if existed:
                deleted += 1
        except OSError:
            pass
    return deleted


def _save_thumbnail(image: Image.Image, asset_id: str, source: str, source_url: str = "") -> dict[str, Any]:
    if int(image.width) * int(image.height) > _MAX_IMAGE_PIXELS:
        raise ValueError("Thumbnail source images are limited to 100 megapixels")
    prepared = ImageOps.exif_transpose(image).convert("RGB")
    # Every gallery asset is physically portrait too, rather than asking the
    # browser to repeatedly crop arbitrary full-size showcase images.
    source_ratio = prepared.width / prepared.height
    target_ratio = _THUMB_BOUND[0] / _THUMB_BOUND[1]
    if source_ratio > target_ratio:
        crop_width = max(1, round(prepared.height * target_ratio))
        left = max(0, (prepared.width - crop_width) // 2)
        prepared = prepared.crop((left, 0, left + crop_width, prepared.height))
    elif source_ratio < target_ratio:
        crop_height = max(1, round(prepared.width / target_ratio))
        top = max(0, (prepared.height - crop_height) // 2)
        prepared = prepared.crop((0, top, prepared.width, top + crop_height))
    prepared.thumbnail(_THUMB_BOUND, Image.Resampling.LANCZOS)
    if not prepared.width or not prepared.height:
        raise ValueError("The selected image has no usable pixels")
    encoded = b""
    working = prepared
    for scale in (1.0, .88, .76):
        if scale != 1.0:
            working = prepared.resize(
                (max(1, round(prepared.width * scale)), max(1, round(prepared.height * scale))),
                Image.Resampling.LANCZOS,
            )
        for quality in (76, 68, 60, 52):
            buffer = io.BytesIO()
            working.save(buffer, "WEBP", quality=quality, method=6)
            encoded = buffer.getvalue()
            if len(encoded) <= _MAX_THUMB_BYTES:
                break
        if len(encoded) <= _MAX_THUMB_BYTES:
            break
    filename = _thumbnail_filename(asset_id)
    target = _thumbnail_directory() / filename
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(encoded)
    temporary.replace(target)
    get_catalog().set_thumbnail(
        asset_id, filename, source, source_url=source_url,
        width=working.width, height=working.height, byte_size=len(encoded),
    )
    return {
        "filename": filename, "source": source, "width": working.width,
        "height": working.height, "byte_size": len(encoded),
    }


def _save_thumbnail_path(path: Path, asset_id: str, source: str) -> dict[str, Any]:
    with Image.open(path) as image:
        return _save_thumbnail(image, asset_id, source, str(path))


def _image_from_remote(url: str) -> Image.Image:
    clean = _valid_civitai_image_url(url)
    if not clean:
        raise ValueError("Only an image URL returned by Civitai may be cached")
    request = Request(clean, headers={"Accept": "image/*", "User-Agent": "ComfyUI-SickOllie/2.4.0"})
    with urlopen(request, timeout=12.0) as response:
        content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type and not content_type.startswith("image/"):
            raise ValueError(f"Civitai returned non-image media ({content_type})")
        raw = response.read(_MAX_REMOTE_BYTES + 1)
    if len(raw) > _MAX_REMOTE_BYTES:
        raise ValueError("The Civitai image exceeded the 16 MB import limit")
    image = Image.open(io.BytesIO(raw))
    if int(image.width) * int(image.height) > _MAX_IMAGE_PIXELS:
        raise ValueError("The Civitai image exceeds the 100 megapixel safety limit")
    image.load()
    return image


def _resolve_comfy_image(data: dict[str, Any]) -> Path:
    filename = str(data.get("filename") or "").strip()
    subfolder = str(data.get("subfolder") or "").strip().replace("\\", "/")
    image_type = str(data.get("type") or "temp").strip().lower()
    if not filename or Path(filename).name != filename:
        raise ValueError("Preview image reference is invalid")
    getters = {
        "temp": getattr(folder_paths, "get_temp_directory", None),
        "output": getattr(folder_paths, "get_output_directory", None),
        "input": getattr(folder_paths, "get_input_directory", None),
    }
    getter = getters.get(image_type)
    if not callable(getter):
        raise ValueError("Preview image type is not supported")
    root = Path(getter()).resolve()
    candidate = (root / Path(subfolder) / filename).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise ValueError("Preview image is no longer available")
    return candidate


def _asset_from_reference(asset_id: str = "", lora: str = "") -> tuple[str, dict[str, Any]]:
    catalog = get_catalog()
    if asset_id:
        asset = catalog.asset(asset_id)
        if asset:
            return asset_id, asset
    path = _resolve_lora_name(lora)
    if path is None:
        raise ValueError("Choose a LoRA that exists inside a configured LoRA folder")
    resolved_id = catalog.ensure_path_asset(path, "thumbnail capture")
    asset = catalog.asset(resolved_id)
    if not asset:
        raise ValueError("The LoRA could not be added to the catalog")
    return resolved_id, asset


def _scan_sidecar(asset_id: str, path: Path) -> bool:
    payload, sidecar_name = _sidecar_payload(path)
    metadata = _normalized_civitai(payload)
    if not any(metadata.get(key) for key in ("images", "model_id", "version_id", "trained_words")):
        return False
    get_catalog().set_remote_metadata(asset_id, metadata, f"sidecar:{sidecar_name}")
    return True


def scan_library(limit: int = 0) -> dict[str, Any]:
    catalog = get_catalog()
    found = thumbnails = sidecars = 0
    for root in _lora_roots():
        for path in root.rglob("*.safetensors"):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            asset_id = _path_asset_id(path)
            catalog.upsert_asset(
                asset_id=asset_id, path=str(path), size=stat.st_size,
                model_name=path.stem, reason="visual library scan",
            )
            if _scan_sidecar(asset_id, path):
                sidecars += 1
            existing_thumbnail = catalog.thumbnail(asset_id)
            if existing_thumbnail and not _thumbnail_record_available(existing_thumbnail):
                catalog.clear_thumbnail(asset_id)
                existing_thumbnail = None
            if existing_thumbnail is None:
                preview = _local_preview(path)
                if preview:
                    try:
                        _save_thumbnail_path(preview, asset_id, "local-sidecar")
                        thumbnails += 1
                    except (OSError, ValueError):
                        pass
            found += 1
            if limit and found >= limit:
                return {"ok": True, "scanned": found, "thumbnails": thumbnails, "sidecars": sidecars, "limited": True}
    return {"ok": True, "scanned": found, "thumbnails": thumbnails, "sidecars": sidecars, "limited": False}


def _asset_detail(asset_id: str) -> dict[str, Any]:
    catalog = get_catalog()
    asset = catalog.asset(asset_id)
    if not asset:
        raise ValueError("Unknown catalog asset")
    path = Path(str(asset.get("current_path") or ""))
    relative = _relative_lora_name(path)
    if not asset.get("remote_metadata") and path.is_file():
        _scan_sidecar(asset_id, path)
        asset = catalog.asset(asset_id) or asset
    if not asset.get("triggers") and relative:
        try:
            from .studio_loader_core import _trigger_candidates
            candidates = _trigger_candidates(relative)
            catalog.replace_trigger_candidates(asset_id, candidates)
            asset = catalog.asset(asset_id) or asset
        except Exception:
            pass
    return _enrich_asset(asset)


def _refresh_civitai(asset_id: str) -> dict[str, Any]:
    catalog = get_catalog()
    asset = catalog.asset(asset_id)
    if not asset:
        raise ValueError("Unknown catalog asset")
    path = Path(str(asset.get("current_path") or ""))
    if not path.is_file() or not _inside_lora_root(path):
        raise ValueError("The LoRA file is unavailable")
    payload, sidecar_name = _sidecar_payload(path)
    source = f"sidecar:{sidecar_name}" if payload is not None else "civitai:sha256"
    if payload is None:
        payload = fetch_civitai_payload(str(path))
    metadata = _normalized_civitai(payload)
    if not any(metadata.get(key) for key in ("model_id", "version_id", "images", "trained_words")):
        raise ValueError("Civitai did not return matching model metadata")
    catalog.set_remote_metadata(asset_id, metadata, source)
    return metadata


def _quarantine_asset(asset_id: str, bucket: Path | None = None) -> dict[str, Any]:
    catalog = get_catalog()
    asset = catalog.asset(asset_id)
    if not asset:
        raise ValueError("Unknown catalog asset")
    source = Path(str(asset["current_path"]))
    if not source.is_file() or not _inside_lora_root(source):
        raise ValueError("Only an existing LoRA inside a configured LoRA root may be quarantined")
    if bucket is None:
        user_dir = Path(getattr(folder_paths, "get_user_directory", lambda: source.parent)())
        bucket = user_dir / "SickOllie" / "quarantine" / datetime.now().strftime("%Y%m%d-%H%M%S")
    bucket.mkdir(parents=True, exist_ok=True)
    target = bucket / source.name
    suffix = 2
    while target.exists():
        target = bucket / f"{source.stem}_{suffix}{source.suffix}"
        suffix += 1
    moved = []
    companions = [source]
    companions.extend(path for path in source.parent.glob(source.name + ".*") if path.is_file())
    companions.extend(path for path in source.parent.glob(source.stem + ".civitai.*") if path.is_file())
    for companion in dict.fromkeys(companions):
        destination = bucket / companion.name
        number = 2
        while destination.exists():
            destination = bucket / f"{companion.stem}_{number}{companion.suffix}"
            number += 1
        shutil.move(str(companion), str(destination))
        moved.append(str(destination))
    catalog.record_relocation(asset_id, str(source), str(target), "SOLO LoRA Library quarantine")
    catalog.set_review(asset_id, "reject")
    return {"ok": True, "source": str(source), "quarantine_path": str(target), "moved_files": moved}


def quarantine_asset(asset_id: str) -> dict[str, Any]:
    return _quarantine_asset(asset_id)


def quarantine_rejected_assets() -> dict[str, Any]:
    rejected = _live_catalog_assets(state="reject")
    if not rejected:
        return {"ok": True, "quarantined": 0, "skipped": 0, "errors": [], "quarantine_path": ""}
    user_dir = Path(getattr(folder_paths, "get_user_directory", lambda: Path.cwd())())
    bucket = user_dir / "SickOllie" / "quarantine" / datetime.now().strftime("%Y%m%d-%H%M%S")
    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for asset in rejected:
        try:
            results.append(_quarantine_asset(str(asset["asset_id"]), bucket))
        except (OSError, ValueError) as error:
            errors.append(f"{asset.get('model_name') or asset.get('asset_id')}: {error}")
    return {
        "ok": True,
        "quarantined": len(results),
        "skipped": len(rejected) - len(results),
        "errors": errors,
        "quarantine_path": str(bucket) if results else "",
    }


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get("/sickollie/library-review/folders")
    async def solo_library_folders(request):
        folders: set[str] = set()
        for root in _lora_roots():
            for path in root.rglob("*"):
                if path.is_dir():
                    relative = path.relative_to(root).as_posix()
                    if relative and not relative.startswith("."):
                        folders.add(relative)
        return web.json_response(sorted(folders, key=str.casefold))

    @PromptServer.instance.routes.get("/sickollie/library-review/lora-files")
    async def solo_library_lora_files(request):
        getter = getattr(folder_paths, "get_filename_list", None)
        names = getter("loras") if callable(getter) else []
        return web.json_response(sorted({str(name) for name in names}, key=str.casefold))

    @PromptServer.instance.routes.get("/sickollie/library-review/assets")
    async def solo_library_assets(request):
        assets = _live_catalog_assets(
            str(request.rel_url.query.get("state", "") or ""),
            str(request.rel_url.query.get("q", "") or ""),
            str(request.rel_url.query.get("sort", "recent") or "recent"),
        )
        return web.json_response([_enrich_asset(asset) for asset in assets])

    @PromptServer.instance.routes.get("/sickollie/library-review/asset/{asset_id}")
    async def solo_library_asset(request):
        try:
            return web.json_response(await asyncio.to_thread(_asset_detail, request.match_info["asset_id"]))
        except ValueError as error:
            return web.json_response({"ok": False, "error": str(error)}, status=404)

    @PromptServer.instance.routes.get("/sickollie/library-review/thumbnail/{filename}")
    async def solo_library_thumbnail(request):
        filename = Path(str(request.match_info["filename"])).name
        if filename != request.match_info["filename"] or not filename.endswith(".webp"):
            raise web.HTTPNotFound()
        path = _thumbnail_directory() / filename
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @PromptServer.instance.routes.post("/sickollie/library-review/scan")
    async def solo_library_scan(request):
        payload = await request.json() if request.can_read_body else {}
        limit = max(0, min(10000, int((payload or {}).get("limit", 0) or 0)))
        return web.json_response(await asyncio.to_thread(scan_library, limit))

    @PromptServer.instance.routes.post("/sickollie/library-review/maintenance")
    async def solo_library_maintenance(request):
        try:
            payload = await request.json()
            action = str(payload.get("action") or "").strip().lower()
            all_assets = bool(payload.get("all_assets", False))
            catalog = get_catalog()
            if all_assets:
                asset_ids = [str(asset.get("asset_id") or "") for asset in catalog.list_assets() if asset.get("asset_id")]
            else:
                raw_ids = payload.get("asset_ids") or []
                if not isinstance(raw_ids, list):
                    raise ValueError("asset_ids must be a list")
                asset_ids = list(dict.fromkeys(str(item or "").strip() for item in raw_ids if str(item or "").strip()))
            if not asset_ids:
                raise ValueError("The selected catalog scope is empty")
            if len(asset_ids) > 100_000:
                raise ValueError("Catalog maintenance scope is unexpectedly large")
            if action == "clear_thumbnails":
                removed = await asyncio.to_thread(catalog.clear_thumbnails, asset_ids)
                deleted = await asyncio.to_thread(_delete_thumbnail_files, removed, purge_all=all_assets)
                return web.json_response({"ok": True, "cleared": len(removed), "files_deleted": deleted})
            if action == "purge_rebuild":
                result = await asyncio.to_thread(catalog.purge_assets, asset_ids)
                deleted = await asyncio.to_thread(_delete_thumbnail_files, list(result.get("thumbnails") or []), purge_all=all_assets)
                scan_result = await asyncio.to_thread(scan_library, 0)
                return web.json_response({
                    "ok": True, "purged": int(result.get("purged") or 0), "files_deleted": deleted,
                    "scanned": int(scan_result.get("scanned") or 0), "thumbnails": int(scan_result.get("thumbnails") or 0),
                    "sidecars": int(scan_result.get("sidecars") or 0),
                })
            raise ValueError("Unknown catalog maintenance action")
        except (OSError, ValueError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/sickollie/library-review/review")
    async def solo_library_set_review(request):
        payload = await request.json()
        get_catalog().set_review(
            str(payload.get("asset_id", "")), str(payload.get("state", "untested")),
            payload.get("rating"), str(payload.get("note", "")),
        )
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/sickollie/library-review/reset")
    async def solo_library_reset(request):
        payload = await request.json()
        get_catalog().reset_status(
            str(payload.get("asset_id", "")),
            include_testing=bool(payload.get("include_testing", False)),
        )
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/sickollie/library-review/review-lora")
    async def solo_library_review_lora(request):
        payload = await request.json()
        path = _resolve_lora_name(str(payload.get("lora", "")))
        if path is None:
            return web.json_response({"ok": False, "error": "The selected LoRA could not be resolved inside a configured LoRA folder"}, status=404)
        catalog = get_catalog()
        asset_id = catalog.ensure_path_asset(path, "Loader Core review")
        state = str(payload.get("state", "untested"))
        catalog.set_review(asset_id, state)
        return web.json_response({"ok": True, "asset_id": asset_id, "state": state, "lora": _relative_lora_name(path)})

    @PromptServer.instance.routes.post("/sickollie/library-review/thumbnail/from-preview")
    async def solo_library_thumbnail_from_preview(request):
        try:
            payload = await request.json()
            asset_id, _asset = _asset_from_reference(str(payload.get("asset_id") or ""), str(payload.get("lora") or ""))
            existing = get_catalog().thumbnail(asset_id)
            if existing and not _thumbnail_record_available(existing):
                get_catalog().clear_thumbnail(asset_id)
                existing = None
            if existing and not bool(payload.get("replace", False)):
                return web.json_response({"ok": True, "skipped": True, "asset_id": asset_id, "thumbnail": existing})
            image_path = _resolve_comfy_image(dict(payload.get("image") or {}))
            result = await asyncio.to_thread(
                _save_thumbnail_path, image_path, asset_id,
                str(payload.get("source") or "generated:preview"),
            )
            return web.json_response({"ok": True, "skipped": False, "asset_id": asset_id, "thumbnail": result})
        except (OSError, ValueError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/sickollie/library-review/thumbnail/upload/{asset_id}")
    async def solo_library_thumbnail_upload(request):
        try:
            asset_id, _asset = _asset_from_reference(request.match_info["asset_id"], "")
            reader = await request.multipart()
            part = await reader.next()
            if part is None or part.name != "file":
                raise ValueError("Choose an image file")
            raw = bytearray()
            while True:
                chunk = await part.read_chunk(size=256 * 1024)
                if not chunk:
                    break
                raw.extend(chunk)
                if len(raw) > _MAX_UPLOAD_BYTES:
                    raise ValueError("Custom thumbnail images are limited to 24 MB")
            image = Image.open(io.BytesIO(bytes(raw)))
            if int(image.width) * int(image.height) > _MAX_IMAGE_PIXELS:
                raise ValueError("Custom thumbnail images are limited to 100 megapixels")
            image.load()
            result = await asyncio.to_thread(_save_thumbnail, image, asset_id, "custom-upload", str(part.filename or ""))
            return web.json_response({"ok": True, "thumbnail": result})
        except (OSError, ValueError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.delete("/sickollie/library-review/thumbnail/{asset_id}")
    async def solo_library_thumbnail_delete(request):
        existing = get_catalog().clear_thumbnail(request.match_info["asset_id"])
        if existing:
            (_thumbnail_directory() / Path(str(existing.get("filename") or "")).name).unlink(missing_ok=True)
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/sickollie/library-review/civitai/{asset_id}")
    async def solo_library_civitai(request):
        try:
            metadata = await asyncio.to_thread(_refresh_civitai, request.match_info["asset_id"])
            return web.json_response({"ok": True, "metadata": metadata})
        except Exception as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/sickollie/library-review/thumbnail/cache-civitai/{asset_id}")
    async def solo_library_cache_civitai(request):
        try:
            payload = await request.json()
            asset = get_catalog().asset(request.match_info["asset_id"])
            if not asset:
                raise ValueError("Unknown catalog asset")
            url = str(payload.get("url") or "")
            allowed = [str(item) for item in (asset.get("remote_metadata") or {}).get("images", [])]
            if url not in allowed:
                raise ValueError("That image is not part of this LoRA's detected Civitai showcase")
            image = await asyncio.to_thread(_image_from_remote, url)
            result = await asyncio.to_thread(_save_thumbnail, image, request.match_info["asset_id"], "civitai-showcase", url)
            return web.json_response({"ok": True, "thumbnail": result})
        except Exception as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.get("/sickollie/library-review/collections")
    async def solo_library_collections(request):
        states: dict[str, str] = {}
        usage: dict[str, int] = {}
        last_used: dict[str, str] = {}
        favorites: list[str] = []
        untested: list[str] = []
        for asset in _live_catalog_assets():
            relative = _relative_lora_name(str(asset.get("current_path", "")))
            if not relative:
                continue
            review_state = str(asset.get("review_state") or "none")
            key = relative.replace("\\", "/").lower()
            states[key] = review_state
            use_count = max(0, int(asset.get("use_count") or 0))
            usage[key] = use_count
            last_used[key] = str(asset.get("last_used_at") or "")
            if review_state == "favorite":
                favorites.append(relative)
            if use_count == 0 or review_state == "retest":
                untested.append(relative)
        return web.json_response({
            "states": states, "usage": usage, "last_used": last_used,
            "favorites": sorted(favorites, key=str.lower),
            "untested": sorted(untested, key=str.lower),
        })

    @PromptServer.instance.routes.post("/sickollie/library-review/quarantine")
    async def solo_library_quarantine(request):
        payload = await request.json()
        try:
            result = await asyncio.to_thread(quarantine_asset, str(payload.get("asset_id", "")))
            return web.json_response(result)
        except ValueError as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/sickollie/library-review/quarantine-rejected")
    async def solo_library_quarantine_rejected(request):
        result = await asyncio.to_thread(quarantine_rejected_assets)
        return web.json_response(result)

    @PromptServer.instance.routes.get("/sickollie/library-review/filters")
    async def solo_library_filters(request):
        return web.json_response(get_catalog().filters())

    @PromptServer.instance.routes.post("/sickollie/library-review/filters")
    async def solo_library_save_filter(request):
        payload = await request.json()
        get_catalog().save_filter(str(payload.get("name", "")), dict(payload.get("query") or {}))
        return web.json_response({"ok": True})
