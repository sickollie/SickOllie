from __future__ import annotations

import os
import string
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping

from . import __version__
from .engine import (
    apply_changes,
    audit_csv,
    find_empty_folders,
    latest_undo_manifest,
    remove_empty_folders,
    scan_logs,
    undo_last,
)
from .jobs import Job, JobManager
from .models import RuleSet
from .util import atomic_json_write, load_json


def default_data_dir(package_root: str | Path) -> Path:
    try:
        import folder_paths
        user_directory = folder_paths.get_user_directory()
        if user_directory:
            return Path(user_directory) / "solo_log_organizer"
    except Exception:
        pass
    return Path(package_root) / "data"


def default_log_root() -> Path:
    """Use the active ComfyUI input directory, with Ollie's Documents layout as fallback."""
    try:
        import folder_paths
        getter = getattr(folder_paths, "get_input_directory", None)
        if getter:
            input_directory = getter()
            if input_directory:
                return Path(input_directory).expanduser().resolve() / "SickOllieLogs"
    except Exception:
        pass
    return (Path.home() / "Documents" / "ComfyUI" / "input" / "SickOllieLogs").resolve()


def suggested_log_roots() -> list[str]:
    roots: list[str] = [str(default_log_root())]
    try:
        import folder_paths
        user = Path(folder_paths.get_user_directory())
        candidates = (
            user / "Sick Ollie" / "Prompt Logs",
            user / "sick_ollie" / "prompt_logs",
            user / "prompt_logs",
        )
        roots.extend(str(path.resolve()) for path in candidates if path.is_dir())
        if user.is_dir():
            roots.append(str(user.resolve()))
    except Exception:
        pass
    return list(dict.fromkeys(roots))


class SoloLogService:
    def __init__(self, package_root: str | Path):
        self.package_root = Path(package_root)
        self.data_dir = default_data_dir(self.package_root)
        self.manifests_dir = self.data_dir / "manifests"
        self.settings_path = self.data_dir / "settings.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.jobs = JobManager()
        self._settings_lock = threading.RLock()
        self._mutation_lock = threading.Lock()
        self._settings = self._load_settings()

    @staticmethod
    def _default_settings() -> Dict[str, Any]:
        return {"schema_version": 3, "last_folder": str(default_log_root()), "rules": asdict(RuleSet())}

    def _load_settings(self) -> Dict[str, Any]:
        defaults = self._default_settings()
        raw = load_json(self.settings_path, {})
        if not isinstance(raw, dict):
            return defaults
        try:
            schema_version = int(raw.get("schema_version") or 1)
        except (TypeError, ValueError):
            schema_version = 1
        return {
            "schema_version": 3,
            # v0.1 used a different output architecture. Its saved scan root is
            # migrated once so the compatibility release actually opens at
            # ComfyUI/input/SickOllieLogs; subsequent custom choices persist.
            "last_folder": (
                defaults["last_folder"]
                if schema_version < 2
                else str(raw.get("last_folder") or defaults["last_folder"])
            ),
            "rules": asdict(RuleSet.from_dict(raw.get("rules") if isinstance(raw.get("rules"), dict) else raw)),
        }

    def _save_settings(self) -> None:
        with self._settings_lock:
            atomic_json_write(self.settings_path, self._settings)

    def public_settings(self) -> Dict[str, Any]:
        with self._settings_lock:
            return {
                "last_folder": self._settings["last_folder"],
                "rules": dict(self._settings["rules"]),
                "suggested_roots": suggested_log_roots(),
                "undo_available": latest_undo_manifest(self.manifests_dir) is not None,
            }

    def update_settings(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        with self._settings_lock:
            if "last_folder" in payload:
                self._settings["last_folder"] = str(payload.get("last_folder") or "").strip()
            if isinstance(payload.get("rules"), dict):
                self._settings["rules"] = asdict(RuleSet.from_dict(dict(payload["rules"])))
        self._save_settings()
        return self.public_settings()

    def start_scan(self, root: str, rules: Mapping[str, Any] | None = None) -> Dict[str, Any]:
        root = os.path.abspath(os.path.expanduser(root))
        selected_rules = RuleSet.from_dict(dict(rules) if rules is not None else self._settings["rules"])
        self.update_settings({"last_folder": root, "rules": asdict(selected_rules)})

        def work(job: Job):
            progress = lambda stage, current, total, filename, percent: self.jobs.update(
                job, stage, current, total, filename, percent,
            )
            return scan_logs(root, selected_rules, job.cancel, progress)

        return self.jobs.start(work).public_dict(False)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        return self.jobs.get(job_id).public_dict(True)

    def cancel_job(self, job_id: str) -> Dict[str, Any]:
        return self.jobs.cancel_job(job_id).public_dict(False)

    def apply(self, job_id: str, selected_ids: Iterable[str], edits: Mapping[str, Mapping[str, Any]] | None) -> Dict[str, Any]:
        with self._mutation_lock:
            return apply_changes(self.jobs.result(job_id), selected_ids, edits, self.manifests_dir)

    def undo(self) -> Dict[str, Any]:
        with self._mutation_lock:
            return undo_last(self.manifests_dir)

    def empty_folders_preview(self, root: str) -> Dict[str, Any]:
        root = os.path.abspath(os.path.expanduser(root))
        folders = find_empty_folders(root)
        return {"root": root, "count": len(folders), "folders": folders}

    def empty_folders_remove(self, root: str, folders: Iterable[str]) -> Dict[str, Any]:
        with self._mutation_lock:
            return remove_empty_folders(root, folders)

    def audit(self, job_id: str) -> str:
        return audit_csv(self.jobs.result(job_id))

    def status(self) -> Dict[str, Any]:
        return {
            "name": "SOLO Log Organizer", "version": __version__,
            "settings": self.public_settings(), "active_jobs": self.jobs.active(),
            "default_log_root": str(default_log_root()),
            "parent_categories": ["outfits", "prompts", "scenes"],
        }

    def browse(self, path: str = "") -> Dict[str, Any]:
        requested = path.strip() or str(self._settings.get("last_folder") or "")
        roots = suggested_log_roots()
        if not requested:
            requested = roots[0] if roots else os.path.abspath(os.sep)
        requested = os.path.abspath(os.path.expanduser(requested))
        while not os.path.isdir(requested):
            parent = os.path.dirname(requested.rstrip("\\/")) or os.path.abspath(os.sep)
            if parent == requested:
                requested = os.path.abspath(os.sep)
                break
            requested = parent
        children = []
        try:
            for name in sorted(os.listdir(requested), key=str.casefold):
                child = os.path.join(requested, name)
                if os.path.isdir(child) and not os.path.islink(child):
                    children.append({"name": name, "path": child})
        except OSError:
            pass
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
