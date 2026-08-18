from __future__ import annotations

import os
import string
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping

from . import __version__
from .civitai import CivitaiClient
from .cleanup import scan_cleanup
from .jobs import Job, JobManager
from .models import RuleSet, ScanRow
from .operations import (
    apply_organization,
    latest_undo_manifest,
    recycle_cleanup,
    recycle_duplicates,
    trash_capabilities,
    undo_last,
)
from .scanning import scan_duplicates, scan_organizer
from .util import atomic_json_write, load_json, norm_path


def default_lora_roots() -> list[str]:
    try:
        import folder_paths  # ComfyUI core module
        roots = folder_paths.get_folder_paths("loras") or []
        return [os.path.abspath(path) for path in roots if os.path.isdir(path)]
    except Exception:
        return []


def default_data_dir(package_root: str | Path) -> Path:
    try:
        import folder_paths
        user_directory = folder_paths.get_user_directory()
        if user_directory:
            return Path(user_directory) / "solo_lora_organizer"
    except Exception:
        pass
    return Path(package_root) / "data"


class SoloService:
    def __init__(self, package_root: str | Path):
        self.package_root = Path(package_root)
        self.data_dir = default_data_dir(self.package_root)
        self.manifests_dir = self.data_dir / "manifests"
        self.settings_path = self.data_dir / "settings.json"
        self.cache_path = self.data_dir / "civitai-cache.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.client = CivitaiClient(self.cache_path)
        self.jobs = JobManager(max_workers=2, abort_callback=self.client.abort)
        self._settings_lock = threading.RLock()
        self._mutation_lock = threading.Lock()
        self._session_token = ""
        self._settings = self._load_settings()
        self._last_organized_paths: set[str] = set()

    @staticmethod
    def _default_settings() -> Dict[str, Any]:
        roots = default_lora_roots()
        return {
            "last_folder": roots[0] if roots else "",
            "save_token": False,
            "api_token": "",
            "rules": asdict(RuleSet()),
        }

    def _load_settings(self) -> Dict[str, Any]:
        defaults = self._default_settings()
        raw = load_json(self.settings_path, {})
        if not isinstance(raw, dict):
            return defaults
        result = dict(defaults)
        result["last_folder"] = str(raw.get("last_folder") or raw.get("lastFolder") or defaults["last_folder"])
        result["save_token"] = bool(raw.get("save_token", raw.get("saveToken", False)))
        result["api_token"] = str(raw.get("api_token") or raw.get("apiToken") or "") if result["save_token"] else ""
        rules = raw.get("rules") if isinstance(raw.get("rules"), dict) else raw
        aliases = {
            "renameFiles": "rename_files",
            "organizeCreators": "organize_creators",
            "organizeCategories": "organize_categories",
            "organizeBaseModels": "organize_base_models",
            "groupOneOffCreators": "group_one_off_creators",
            "groupUnidentified": "group_unidentified",
            "reprocessExistingSubfolders": "reprocess_existing_subfolders",
        }
        normalized = dict(rules)
        for old, new in aliases.items():
            if old in normalized and new not in normalized:
                normalized[new] = normalized[old]
        result["rules"] = asdict(RuleSet.from_dict(normalized))
        return result

    def _save_settings(self) -> None:
        with self._settings_lock:
            payload = {
                "last_folder": self._settings["last_folder"],
                "save_token": bool(self._settings["save_token"]),
                "api_token": self._settings["api_token"] if self._settings["save_token"] else "",
                "rules": dict(self._settings["rules"]),
            }
        atomic_json_write(self.settings_path, payload)

    def public_settings(self) -> Dict[str, Any]:
        with self._settings_lock:
            return {
                "last_folder": self._settings["last_folder"],
                "save_token": bool(self._settings["save_token"]),
                "token_configured": bool(self._session_token or self._settings["api_token"]),
                "rules": dict(self._settings["rules"]),
                "lora_roots": default_lora_roots(),
                "undo_available": latest_undo_manifest(self.manifests_dir) is not None,
            }

    def update_settings(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        with self._settings_lock:
            if bool(payload.get("clear_token")):
                self._session_token = ""
                self._settings["api_token"] = ""
            if "last_folder" in payload:
                self._settings["last_folder"] = str(payload.get("last_folder") or "").strip()
            if isinstance(payload.get("rules"), dict):
                self._settings["rules"] = asdict(RuleSet.from_dict(payload["rules"]))
            if "api_token" in payload and not bool(payload.get("clear_token")):
                self._session_token = str(payload.get("api_token") or "").strip()
            if "save_token" in payload:
                self._settings["save_token"] = bool(payload.get("save_token"))
            if self._settings["save_token"]:
                if self._session_token:
                    self._settings["api_token"] = self._session_token
            else:
                self._settings["api_token"] = ""
        self._save_settings()
        return self.public_settings()

    def _token(self, explicit: str = "") -> str:
        return explicit.strip() or self._session_token or str(self._settings.get("api_token") or "")

    def _rules(self, value: Mapping[str, Any] | None) -> RuleSet:
        return RuleSet.from_dict(dict(value) if value is not None else self._settings.get("rules"))

    def _progress(self, job: Job):
        return lambda stage, current, total, filename, percent: self.jobs.update_progress(
            job, stage, current, total, filename, percent,
        )

    def start_organizer(self, root: str, rules: Mapping[str, Any] | None = None, token: str = "") -> Dict[str, Any]:
        root = os.path.abspath(root)
        selected_rules = self._rules(rules)
        self.update_settings({"last_folder": root, "rules": asdict(selected_rules)})

        def work(job: Job):
            bundle = scan_organizer(root, selected_rules, self.client, self._token(token), job.cancel, self._progress(job))
            self._last_organized_paths = {norm_path(row.full_path) for row in bundle.rows if isinstance(row, ScanRow)}
            return bundle

        return self.jobs.start("organizer", work).public_dict(False)

    def start_duplicates(self, root: str) -> Dict[str, Any]:
        root = os.path.abspath(root)
        self.update_settings({"last_folder": root})
        return self.jobs.start(
            "duplicates",
            lambda job: scan_duplicates(root, job.cancel, self._progress(job), set(self._last_organized_paths)),
        ).public_dict(False)

    def start_cleanup(self, root: str) -> Dict[str, Any]:
        root = os.path.abspath(root)
        self.update_settings({"last_folder": root})
        return self.jobs.start(
            "cleanup",
            lambda job: scan_cleanup(root, job.cancel, self._progress(job)),
        ).public_dict(False)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        return self.jobs.get(job_id).public_dict(True)

    def cancel_job(self, job_id: str) -> Dict[str, Any]:
        return self.jobs.cancel_job(job_id).public_dict(False)

    def apply(self, job_id: str, selected_ids: Iterable[str], edits: Mapping[str, Mapping[str, Any]] | None) -> Dict[str, Any]:
        with self._mutation_lock:
            return apply_organization(self.jobs.result(job_id, "organizer"), selected_ids, edits, self.manifests_dir)

    def undo(self) -> Dict[str, Any]:
        with self._mutation_lock:
            return undo_last(self.manifests_dir)

    def recycle_duplicates(self, job_id: str, selected_ids: Iterable[str]) -> Dict[str, Any]:
        with self._mutation_lock:
            return recycle_duplicates(self.jobs.result(job_id, "duplicates"), selected_ids, self.manifests_dir)

    def recycle_cleanup(self, job_id: str, selected_ids: Iterable[str]) -> Dict[str, Any]:
        with self._mutation_lock:
            return recycle_cleanup(self.jobs.result(job_id, "cleanup"), selected_ids, self.manifests_dir)

    def status(self) -> Dict[str, Any]:
        return {
            "name": "SOLO LoRA Organizer",
            "version": __version__,
            "settings": self.public_settings(),
            "active_jobs": self.jobs.active(),
            "trash": trash_capabilities(),
        }

    def browse(self, path: str = "") -> Dict[str, Any]:
        requested = path.strip() or str(self._settings.get("last_folder") or "")
        roots = default_lora_roots()
        if not requested:
            requested = roots[0] if roots else os.path.abspath(os.sep)
        requested = os.path.abspath(os.path.expanduser(requested))
        if not os.path.isdir(requested):
            requested = os.path.dirname(requested) or os.path.abspath(os.sep)
        children = []
        try:
            for name in sorted(os.listdir(requested), key=str.casefold):
                child = os.path.join(requested, name)
                if os.path.isdir(child) and not os.path.islink(child):
                    children.append({"name": name, "path": child})
        except OSError:
            children = []
        root_choices = list(roots)
        if os.name == "nt":
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.isdir(drive) and drive not in root_choices:
                    root_choices.append(drive)
        elif os.path.abspath(os.sep) not in root_choices:
            root_choices.append(os.path.abspath(os.sep))
        parent = os.path.dirname(requested.rstrip("\\/")) or requested
        return {"current": requested, "parent": parent, "children": children, "roots": root_choices}
