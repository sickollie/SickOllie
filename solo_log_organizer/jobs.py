from __future__ import annotations

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
            "job_id": self.job_id, "mode": "organizer", "status": self.status,
            "stage": self.stage, "current": self.current, "total": self.total,
            "filename": self.filename, "percent": self.percent, "error": self.error,
        }
        if include_result and self.result is not None and self.status == "completed":
            value["result"] = self.result.public_dict()
        return value


class JobManager:
    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="solo-log-organizer")
        self._jobs: Dict[str, Job] = {}
        self._lock = RLock()

    def start(self, work: Callable[[Job], ScanBundle]) -> Job:
        job = Job(uuid.uuid4().hex)
        with self._lock:
            self._jobs[job.job_id] = job
            self._prune_locked()

        def runner() -> None:
            with self._lock:
                job.status, job.stage, job.updated_at = "running", "Starting", time.time()
            try:
                result = work(job)
                with self._lock:
                    if job.cancel.is_set():
                        raise Cancelled("Scan stopped. No files were changed.")
                    job.result, job.status, job.stage = result, "completed", "Complete"
                    job.percent, job.updated_at = 100, time.time()
            except Cancelled as exc:
                with self._lock:
                    job.status, job.stage, job.error = "cancelled", "Stopped", str(exc)
                    job.result, job.updated_at = None, time.time()
            except Exception as exc:
                with self._lock:
                    job.status, job.stage, job.error = "failed", "Failed", str(exc)
                    job.result, job.updated_at = None, time.time()

        self._executor.submit(runner)
        return job

    def update(self, job: Job, stage: str, current: int, total: int, filename: str, percent: int) -> None:
        with self._lock:
            job.stage, job.current, job.total = stage, max(0, int(current)), max(0, int(total))
            job.filename, job.percent = filename or "", max(0, min(100, int(percent)))
            job.updated_at = time.time()

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError("Unknown or expired SOLO Log Organizer job.")
            return job

    def result(self, job_id: str) -> ScanBundle:
        job = self.get(job_id)
        if job.status != "completed" or job.result is None:
            raise ValueError("The requested preview job has not completed.")
        return job.result

    def cancel_job(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status not in {"queued", "running", "cancelling"}:
            return job
        job.cancel.set()
        with self._lock:
            job.status, job.stage, job.updated_at = "cancelling", "Stopping", time.time()
        return job

    def active(self) -> list[Dict[str, Any]]:
        with self._lock:
            return [job.public_dict(False) for job in self._jobs.values() if job.status in {"queued", "running", "cancelling"}]

    def _prune_locked(self) -> None:
        cutoff = time.time() - 3600
        for job_id in [
            key for key, job in self._jobs.items()
            if job.updated_at < cutoff and job.status not in {"queued", "running", "cancelling"}
        ]:
            self._jobs.pop(job_id, None)
