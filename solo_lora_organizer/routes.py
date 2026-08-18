from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from .service import SoloService


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
SERVICE = SoloService(PACKAGE_ROOT)


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
        root = str(payload.get("root") or "")
        mode = request.match_info["mode"]
        if mode == "organizer":
            data = SERVICE.start_organizer(root, payload.get("rules"), str(payload.get("api_token") or ""))
        elif mode == "duplicates":
            data = SERVICE.start_duplicates(root)
        elif mode == "cleanup":
            data = SERVICE.start_cleanup(root)
        else:
            raise ValueError("Unknown SOLO scan mode.")
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
            str(payload.get("job_id") or ""),
            payload.get("selected_ids") or [],
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


async def recycle(request: web.Request) -> web.Response:
    try:
        payload = await _json(request)
        mode = request.match_info["mode"]
        job_id = str(payload.get("job_id") or "")
        selected = payload.get("selected_ids") or []
        if mode == "duplicates":
            data = SERVICE.recycle_duplicates(job_id, selected)
        elif mode == "cleanup":
            data = SERVICE.recycle_cleanup(job_id, selected)
        else:
            raise ValueError("Unknown SOLO recycle mode.")
        return web.json_response({"ok": True, "data": data})
    except Exception as exc:
        return _error(exc)


def register_routes() -> None:
    from server import PromptServer

    routes = PromptServer.instance.routes
    root = "/sickollie/solo-organizer/api/v1"
    routes.get(f"{root}/status")(status)
    routes.get(f"{root}/settings")(settings_get)
    routes.post(f"{root}/settings")(settings_post)
    routes.get(f"{root}/browse")(browse)
    routes.post(f"{root}/scan/{{mode}}")(start_scan)
    routes.get(f"{root}/jobs/{{job_id}}")(get_job)
    routes.post(f"{root}/jobs/{{job_id}}/cancel")(cancel_job)
    routes.post(f"{root}/apply")(apply)
    routes.post(f"{root}/undo")(undo)
    routes.post(f"{root}/recycle/{{mode}}")(recycle)


register_routes()
