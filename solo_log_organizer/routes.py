from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from .service import SoloLogService


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
SERVICE = SoloLogService(PACKAGE_ROOT)


async def _json(request: web.Request) -> Dict[str, Any]:
    if not request.can_read_body:
        return {}
    value = await request.json()
    if not isinstance(value, dict):
        raise ValueError("Request body must be a JSON object.")
    return value


def _error(exc: Exception) -> web.Response:
    status = 404 if isinstance(exc, KeyError) else 400
    return web.json_response({"ok": False, "error": str(exc).strip("'\"")}, status=status)


async def status(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "data": SERVICE.status()})


async def settings_get(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "data": SERVICE.public_settings()})


async def settings_post(request: web.Request) -> web.Response:
    try:
        return web.json_response({"ok": True, "data": SERVICE.update_settings(await _json(request))})
    except Exception as exc:
        return _error(exc)


async def browse(request: web.Request) -> web.Response:
    try:
        return web.json_response({"ok": True, "data": SERVICE.browse(request.query.get("path", ""))})
    except Exception as exc:
        return _error(exc)


async def start_scan(request: web.Request) -> web.Response:
    try:
        payload = await _json(request)
        data = SERVICE.start_scan(str(payload.get("root") or ""), payload.get("rules"))
        return web.json_response({"ok": True, "data": data})
    except Exception as exc:
        return _error(exc)


async def get_job(request: web.Request) -> web.Response:
    try:
        return web.json_response({"ok": True, "data": SERVICE.get_job(request.match_info["job_id"])})
    except Exception as exc:
        return _error(exc)


async def cancel_job(request: web.Request) -> web.Response:
    try:
        return web.json_response({"ok": True, "data": SERVICE.cancel_job(request.match_info["job_id"])})
    except Exception as exc:
        return _error(exc)


async def apply(request: web.Request) -> web.Response:
    try:
        payload = await _json(request)
        data = SERVICE.apply(
            str(payload.get("job_id") or ""), payload.get("selected_ids") or [],
            payload.get("edits") if isinstance(payload.get("edits"), dict) else {},
        )
        return web.json_response({"ok": True, "data": data})
    except Exception as exc:
        return _error(exc)


async def undo(request: web.Request) -> web.Response:
    try:
        return web.json_response({"ok": True, "data": SERVICE.undo()})
    except Exception as exc:
        return _error(exc)


async def empty_folders_preview(request: web.Request) -> web.Response:
    try:
        payload = await _json(request)
        data = SERVICE.empty_folders_preview(str(payload.get("root") or ""))
        return web.json_response({"ok": True, "data": data})
    except Exception as exc:
        return _error(exc)


async def empty_folders_remove(request: web.Request) -> web.Response:
    try:
        payload = await _json(request)
        folders = payload.get("folders")
        if not isinstance(folders, list) or not all(isinstance(value, str) for value in folders):
            raise ValueError("Empty-folder targets must be a list of relative folder paths.")
        data = SERVICE.empty_folders_remove(str(payload.get("root") or ""), folders)
        return web.json_response({"ok": True, "data": data})
    except Exception as exc:
        return _error(exc)


async def audit(request: web.Request) -> web.Response:
    try:
        value = SERVICE.audit(request.match_info["job_id"])
        return web.Response(
            text=value,
            content_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="SOLO-Log-Audit.csv"'},
        )
    except Exception as exc:
        return _error(exc)


def register_routes() -> None:
    from server import PromptServer

    routes = PromptServer.instance.routes
    root = "/sickollie/solo-log-organizer/api/v1"
    routes.get(f"{root}/status")(status)
    routes.get(f"{root}/settings")(settings_get)
    routes.post(f"{root}/settings")(settings_post)
    routes.get(f"{root}/browse")(browse)
    routes.post(f"{root}/scan")(start_scan)
    routes.get(f"{root}/jobs/{{job_id}}")(get_job)
    routes.post(f"{root}/jobs/{{job_id}}/cancel")(cancel_job)
    routes.post(f"{root}/apply")(apply)
    routes.post(f"{root}/undo")(undo)
    routes.post(f"{root}/empty-folders/preview")(empty_folders_preview)
    routes.post(f"{root}/empty-folders/remove")(empty_folders_remove)
    routes.get(f"{root}/audit/{{job_id}}")(audit)


register_routes()
