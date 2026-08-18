from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Event, RLock
from typing import Any, Callable, Dict

from .models import ScanBundle
from .util import Cancelled


@dataclass
class Job:
    job_id: str
    mode: str
    cancel: Event = field(default_factory=Event)
    status: str = "queued"
    stage: str = "Queued"
    current: int = 0
    total: int = 0
    filename: str = ""
    percent: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: ScanBundle | None = None
    error: str = ""

    def public_dict(self, include_result: bool = True) -> Dict[str, Any]:
        value: Dict[str, Any] = {
            "job_id": self.job_id,
            "mode": self.mode,
            "status": self.status,
            "stage": self.stage,
            "current": self.current,
            "total": self.total,
            "filename": self.filename,
            "percent": self.percent,
            "error": self.error,
        }
        if include_result and self.result is not None and self.status == "completed":
            value["result"] = self.result.public_dict()
        return value


class JobManager:
    def __init__(self, max_workers: int = 2, abort_callback: Callable[[Event], None] | None = None):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="solo-organizer")
        self._jobs: Dict[str, Job] = {}
        self._lock = RLock()
        self._abort_callback = abort_callback

    def start(self, mode: str, work: Callable[[Job], ScanBundle]) -> Job:
        job = Job(uuid.uuid4().hex, mode)
        with self._lock:
            self._jobs[job.job_id] = job
            self._prune_locked()

        def runner() -> None:
            with self._lock:
                job.status = "running"
                job.stage = "Starting"
                job.updated_at = time.time()
            try:
                result = work(job)
                with self._lock:
                    if job.cancel.is_set():
                        raise Cancelled("Scan stopped. No files were changed.")
                    job.result = result
                    job.status = "completed"
                    job.stage = "Complete"
                    job.percent = 100
                    job.updated_at = time.time()
            except Cancelled as exc:
                with self._lock:
                    job.status = "cancelled"
                    job.stage = "Stopped"
                    job.error = str(exc)
                    job.result = None
                    job.updated_at = time.time()
            except Exception as exc:
                with self._lock:
                    job.status = "failed"
                    job.stage = "Failed"
                    job.error = str(exc)
                    job.result = None
                    job.updated_at = time.time()

        self._executor.submit(runner)
        return job

    def update_progress(self, job: Job, stage: str, current: int, total: int, filename: str, percent: int) -> None:
        with self._lock:
            job.stage = stage
            job.current = max(0, int(current))
            job.total = max(0, int(total))
            job.filename = filename or ""
            job.percent = max(0, min(100, int(percent)))
            job.updated_at = time.time()

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError("Unknown or expired SOLO job.")
            return job

    def result(self, job_id: str, mode: str | None = None) -> ScanBundle:
        job = self.get(job_id)
        if job.status != "completed" or job.result is None:
            raise ValueError("The requested preview job has not completed.")
        if mode is not None and job.mode != mode:
            raise ValueError(f"Expected a {mode} preview, received {job.mode}.")
        return job.result

    def cancel_job(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status not in {"queued", "running", "cancelling"}:
            return job
        job.cancel.set()
        with self._lock:
            job.status = "cancelling"
            job.stage = "Stopping"
            job.updated_at = time.time()
        if self._abort_callback:
            self._abort_callback(job.cancel)
        return job

    def active(self) -> list[Dict[str, Any]]:
        with self._lock:
            return [job.public_dict(False) for job in self._jobs.values() if job.status in {"queued", "running", "cancelling"}]

    def _prune_locked(self) -> None:
        cutoff = time.time() - 3600
        stale = [
            job_id for job_id, job in self._jobs.items()
            if job.updated_at < cutoff and job.status not in {"queued", "running", "cancelling"}
        ]
        for job_id in stale:
            self._jobs.pop(job_id, None)

