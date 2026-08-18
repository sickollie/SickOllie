from __future__ import annotations

"""Durable, local catalog shared by Sick Ollie Studio tools.

The catalog is intentionally an index, never a second LoRA library: files stay
where the user put them and the SQLite data can be rebuilt from paths/hashes.
It supplies stable identity, history, trigger choices, tokens, and review
state to later Studio, Review, and Recipe surfaces.
"""

import json
import os
import sqlite3
import threading
import hashlib
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse


SCHEMA_VERSION = 4
_LOCK = threading.RLock()

_SUPPORTED_CIVITAI_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _supported_remote_images(remote: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for item in remote.get("images") or []:
        url = str(item or "").strip()
        if not url:
            continue
        try:
            parsed = urlparse(url)
        except ValueError:
            continue
        if Path(parsed.path).suffix.casefold() not in _SUPPORTED_CIVITAI_IMAGE_SUFFIXES:
            continue
        values.append(url)
    return list(dict.fromkeys(values))



def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_catalog_path() -> Path:
    try:
        import folder_paths

        user_dir = getattr(folder_paths, "get_user_directory", lambda: "")()
    except Exception:
        user_dir = ""
    root = Path(user_dir) if user_dir else Path(__file__).resolve().parent / "data"
    return root / "SickOllie" / "solo_catalog.sqlite3"


class SoloCatalog:
    def __init__(self, database_path: str | os.PathLike[str] | None = None):
        self.path = Path(database_path or default_catalog_path())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with _LOCK, self._connection() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS assets (
                    asset_id TEXT PRIMARY KEY,
                    sha256 TEXT UNIQUE,
                    size INTEGER NOT NULL DEFAULT 0,
                    current_path TEXT NOT NULL,
                    model_name TEXT NOT NULL DEFAULT '',
                    civitai_model_id TEXT NOT NULL DEFAULT '',
                    civitai_version_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS asset_paths (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id TEXT NOT NULL REFERENCES assets(asset_id),
                    path TEXT NOT NULL,
                    seen_at TEXT NOT NULL,
                    reason TEXT NOT NULL DEFAULT 'scan',
                    UNIQUE(asset_id, path)
                );
                CREATE TABLE IF NOT EXISTS trigger_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id TEXT NOT NULL REFERENCES assets(asset_id),
                    raw_text TEXT NOT NULL,
                    clean_text TEXT NOT NULL,
                    source TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0,
                    flags_json TEXT NOT NULL DEFAULT '[]',
                    pinned INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(asset_id, raw_text, source)
                );
                CREATE TABLE IF NOT EXISTS token_registry (
                    token TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    color TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS asset_reviews (
                    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id),
                    state TEXT NOT NULL DEFAULT 'untested',
                    rating INTEGER,
                    note TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS asset_usage (
                    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id),
                    use_count INTEGER NOT NULL DEFAULT 0,
                    last_used_at TEXT NOT NULL DEFAULT '',
                    last_output TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS asset_usage_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id TEXT NOT NULL REFERENCES assets(asset_id),
                    used_at TEXT NOT NULL,
                    output_path TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS asset_usage_events_asset_time
                    ON asset_usage_events(asset_id, used_at DESC);
                CREATE TABLE IF NOT EXISTS asset_thumbnails (
                    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id),
                    filename TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    source_url TEXT NOT NULL DEFAULT '',
                    width INTEGER NOT NULL DEFAULT 0,
                    height INTEGER NOT NULL DEFAULT 0,
                    byte_size INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS asset_remote_metadata (
                    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id),
                    source TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    fetched_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS relocation_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id TEXT NOT NULL REFERENCES assets(asset_id),
                    old_path TEXT NOT NULL,
                    new_path TEXT NOT NULL,
                    manifest_path TEXT NOT NULL DEFAULT '',
                    recorded_at TEXT NOT NULL,
                    UNIQUE(asset_id, old_path, new_path)
                );
                CREATE TABLE IF NOT EXISTS saved_filters (
                    name TEXT PRIMARY KEY,
                    query_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS recipes (
                    recipe_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    preview_ref TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            db.execute("INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),))
        self.ensure_default_tokens()

    def ensure_default_tokens(self) -> None:
        defaults = {
            "NAME": ("identity", "#f2df55", "Linked Loader clean name"),
            "OUTFIT": ("outfit", "#ff4dc4", "Primary outfit insertion"),
            "OUTFIT_A": ("outfit", "#ff4dc4", "Outfit A insertion"),
            "OUTFIT_B": ("outfit", "#f2df55", "Outfit B insertion"),
            "OUTFIT_C": ("outfit", "#28d8ff", "Outfit C insertion"),
            "SCENE": ("scene", "#63e6a4", "Scene insertion"),
            "ITEM": ("item", "#28d8ff", "Dynamic item / brand insertion"),
            "TRIGGER": ("trigger", "#a98cff", "Selected LoRA activation phrase"),
        }
        now = _now()
        with _LOCK, self._connection() as db:
            for token, (kind, color, description) in defaults.items():
                db.execute(
                    "INSERT OR IGNORE INTO token_registry(token, kind, color, description, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (token, kind, color, description, now),
                )

    def upsert_asset(self, *, asset_id: str, path: str, sha256: str = "", size: int = 0, model_name: str = "", civitai_model_id: str = "", civitai_version_id: str = "", reason: str = "scan") -> None:
        now = _now()
        full_path = os.path.abspath(path)
        with _LOCK, self._connection() as db:
            db.execute(
                """INSERT INTO assets(asset_id, sha256, size, current_path, model_name, civitai_model_id, civitai_version_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET sha256=COALESCE(excluded.sha256, assets.sha256), size=excluded.size, current_path=excluded.current_path,
                    model_name=excluded.model_name,
                    civitai_model_id=CASE WHEN excluded.civitai_model_id<>'' THEN excluded.civitai_model_id ELSE assets.civitai_model_id END,
                    civitai_version_id=CASE WHEN excluded.civitai_version_id<>'' THEN excluded.civitai_version_id ELSE assets.civitai_version_id END,
                    updated_at=excluded.updated_at""",
                (asset_id, sha256 or None, int(size or 0), full_path, model_name, civitai_model_id, civitai_version_id, now, now),
            )
            db.execute("INSERT OR REPLACE INTO asset_paths(asset_id, path, seen_at, reason) VALUES (?, ?, ?, ?)", (asset_id, full_path, now, reason))

    @staticmethod
    def path_asset_id(path: str | os.PathLike[str]) -> str:
        return "path:" + hashlib.sha1(os.path.abspath(os.fspath(path)).encode("utf-8")).hexdigest()

    def ensure_path_asset(self, path: str | os.PathLike[str], reason: str = "runtime") -> str:
        full_path = os.path.abspath(os.fspath(path))
        asset_id = self.path_asset_id(full_path)
        try:
            size = os.path.getsize(full_path)
        except OSError:
            size = 0
        self.upsert_asset(asset_id=asset_id, path=full_path, size=size, model_name=Path(full_path).stem, reason=reason)
        return asset_id

    def record_usage(self, path: str | os.PathLike[str], last_output: str = "") -> dict[str, Any]:
        """Record durable tested history without changing the user's rating.

        Review state and tested history are deliberately independent.  A run
        proves that an asset was tested; it must not silently turn that asset
        into a green Keep rating or erase a Retest/Favorite/Reject choice.
        """
        asset_id = self.ensure_path_asset(path, "completed generation")
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute(
                """INSERT INTO asset_usage(asset_id, use_count, last_used_at, last_output) VALUES (?, 1, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET use_count=asset_usage.use_count+1,
                last_used_at=excluded.last_used_at, last_output=excluded.last_output""",
                (asset_id, now, str(last_output or "")),
            )
            db.execute(
                "INSERT INTO asset_usage_events(asset_id, used_at, output_path) VALUES (?, ?, ?)",
                (asset_id, now, str(last_output or "")),
            )
        return {"asset_id": asset_id, "tested": True, "last_used_at": now}

    def record_relocation(self, asset_id: str, old_path: str, new_path: str, manifest_path: str = "") -> None:
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute("INSERT OR IGNORE INTO relocation_ledger(asset_id, old_path, new_path, manifest_path, recorded_at) VALUES (?, ?, ?, ?, ?)", (asset_id, os.path.abspath(old_path), os.path.abspath(new_path), manifest_path, now))
            db.execute("UPDATE assets SET current_path=?, updated_at=? WHERE asset_id=?", (os.path.abspath(new_path), now, asset_id))
            db.execute("INSERT OR REPLACE INTO asset_paths(asset_id, path, seen_at, reason) VALUES (?, ?, ?, 'relocation')", (asset_id, os.path.abspath(new_path), now))

    def replace_trigger_candidates(self, asset_id: str, candidates: list[dict[str, Any]]) -> None:
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute("DELETE FROM trigger_candidates WHERE asset_id=? AND pinned=0", (asset_id,))
            for item in candidates:
                raw = str(item.get("raw", "")).strip()
                if not raw:
                    continue
                db.execute(
                    """INSERT INTO trigger_candidates(asset_id, raw_text, clean_text, source, confidence, flags_json, pinned, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                    ON CONFLICT(asset_id, raw_text, source) DO UPDATE SET clean_text=excluded.clean_text, confidence=excluded.confidence, flags_json=excluded.flags_json, updated_at=excluded.updated_at""",
                    (asset_id, raw, str(item.get("clean", raw)), str(item.get("source", "")), float(item.get("confidence", 0)), json.dumps(item.get("flags", [])), now, now),
                )

    def pin_trigger(self, asset_id: str, raw_text: str, source: str = "user.pinned") -> None:
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute("UPDATE trigger_candidates SET pinned=0 WHERE asset_id=?", (asset_id,))
            db.execute(
                "INSERT OR REPLACE INTO trigger_candidates(asset_id, raw_text, clean_text, source, confidence, flags_json, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 1, '[]', 1, ?, ?)",
                (asset_id, raw_text, raw_text, source, now, now),
            )

    def set_review(self, asset_id: str, state: str, rating: int | None = None, note: str = "") -> None:
        normalized = str(state or "none").strip().lower()
        if normalized not in {"none", "untested", "generated", "unreviewed", "keep", "favorite", "reject", "retest"}:
            raise ValueError("Unknown review state")
        with _LOCK, self._connection() as db:
            if normalized in {"none", "untested", "generated", "unreviewed"}:
                db.execute("DELETE FROM asset_reviews WHERE asset_id=?", (asset_id,))
                return
            implied_rating = 4 if normalized == "favorite" else 3 if normalized == "keep" else rating
            db.execute(
                "INSERT OR REPLACE INTO asset_reviews(asset_id, state, rating, note, updated_at) VALUES (?, ?, ?, ?, ?)",
                (asset_id, normalized, implied_rating, note, _now()),
            )

    def reset_status(self, asset_id: str, *, include_testing: bool = False) -> None:
        """Clear deliberate status, optionally erasing tested/use history too."""
        with _LOCK, self._connection() as db:
            db.execute("DELETE FROM asset_reviews WHERE asset_id=?", (asset_id,))
            if include_testing:
                db.execute("DELETE FROM asset_usage WHERE asset_id=?", (asset_id,))
                db.execute("DELETE FROM asset_usage_events WHERE asset_id=?", (asset_id,))

    @staticmethod
    def _clean_asset_ids(asset_ids: list[str] | tuple[str, ...] | set[str]) -> list[str]:
        return list(dict.fromkeys(str(asset_id or "").strip() for asset_id in asset_ids if str(asset_id or "").strip()))

    def clear_thumbnails(self, asset_ids: list[str] | tuple[str, ...] | set[str]) -> list[dict[str, Any]]:
        """Remove thumbnail records for selected assets and return the removed rows.

        The caller owns deletion of the corresponding cache files. Keeping file
        mutation outside the catalog makes this method safe for tests and other
        catalog consumers.
        """
        ids = self._clean_asset_ids(asset_ids)
        if not ids:
            return []
        with _LOCK, self._connection() as db:
            removed: list[dict[str, Any]] = []
            for asset_id in ids:
                row = db.execute("SELECT * FROM asset_thumbnails WHERE asset_id=?", (asset_id,)).fetchone()
                if row:
                    removed.append(dict(row))
            db.executemany("DELETE FROM asset_thumbnails WHERE asset_id=?", [(asset_id,) for asset_id in ids])
        return removed

    def purge_assets(self, asset_ids: list[str] | tuple[str, ...] | set[str]) -> dict[str, Any]:
        """Remove selected LoRA catalog records without touching model files.

        Recipes, saved filters, and the shared token registry intentionally live
        outside the purge boundary. This is the safe equivalent of rebuilding a
        portion of the LoRA Library rather than deleting the shared SQLite file.
        """
        ids = self._clean_asset_ids(asset_ids)
        if not ids:
            return {"purged": 0, "thumbnails": []}
        child_tables = (
            "asset_paths", "trigger_candidates", "asset_reviews", "asset_usage",
            "asset_usage_events", "asset_thumbnails", "asset_remote_metadata",
            "relocation_ledger",
        )
        with _LOCK, self._connection() as db:
            existing_ids: list[str] = []
            thumbnails: list[dict[str, Any]] = []
            for asset_id in ids:
                row = db.execute("SELECT asset_id FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
                if not row:
                    continue
                existing_ids.append(asset_id)
                thumb = db.execute("SELECT * FROM asset_thumbnails WHERE asset_id=?", (asset_id,)).fetchone()
                if thumb:
                    thumbnails.append(dict(thumb))
            if not existing_ids:
                return {"purged": 0, "thumbnails": []}
            rows = [(asset_id,) for asset_id in existing_ids]
            for table in child_tables:
                db.executemany(f"DELETE FROM {table} WHERE asset_id=?", rows)
            db.executemany("DELETE FROM assets WHERE asset_id=?", rows)
        return {"purged": len(existing_ids), "thumbnails": thumbnails}

    def asset(self, asset_id: str) -> dict[str, Any] | None:
        with _LOCK, self._connection() as db:
            row = db.execute("SELECT * FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
            if row is None:
                return None
            value = dict(row)
            value["paths"] = [entry[0] for entry in db.execute("SELECT path FROM asset_paths WHERE asset_id=? ORDER BY seen_at DESC", (asset_id,))]
            value["triggers"] = [dict(entry) | {"flags": json.loads(entry["flags_json"])} for entry in db.execute("SELECT * FROM trigger_candidates WHERE asset_id=? ORDER BY pinned DESC, confidence DESC", (asset_id,))]
            review = db.execute("SELECT * FROM asset_reviews WHERE asset_id=?", (asset_id,)).fetchone()
            value["review"] = dict(review) if review else {"state": "untested"}
            usage = db.execute("SELECT * FROM asset_usage WHERE asset_id=?", (asset_id,)).fetchone()
            value["usage"] = dict(usage) if usage else {"use_count": 0, "last_used_at": "", "last_output": ""}
            value["usage_events"] = [
                dict(entry) for entry in db.execute(
                    "SELECT used_at, output_path FROM asset_usage_events WHERE asset_id=? ORDER BY used_at DESC LIMIT 24",
                    (asset_id,),
                )
            ]
            first_use = db.execute("SELECT MIN(used_at) FROM asset_usage_events WHERE asset_id=?", (asset_id,)).fetchone()
            value["first_used_at"] = str(first_use[0] or "") if first_use else ""
            thumbnail = db.execute("SELECT * FROM asset_thumbnails WHERE asset_id=?", (asset_id,)).fetchone()
            value["thumbnail"] = dict(thumbnail) if thumbnail else None
            remote = db.execute("SELECT * FROM asset_remote_metadata WHERE asset_id=?", (asset_id,)).fetchone()
            value["remote_metadata"] = json.loads(remote["payload_json"]) if remote else {}
            if remote:
                value["remote_metadata_source"] = remote["source"]
                value["remote_metadata_fetched_at"] = remote["fetched_at"]
            return value

    def thumbnail(self, asset_id: str) -> dict[str, Any] | None:
        with _LOCK, self._connection() as db:
            row = db.execute("SELECT * FROM asset_thumbnails WHERE asset_id=?", (asset_id,)).fetchone()
        return dict(row) if row else None

    def set_thumbnail(
        self, asset_id: str, filename: str, source: str, *, source_url: str = "",
        width: int = 0, height: int = 0, byte_size: int = 0,
    ) -> None:
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute(
                """INSERT INTO asset_thumbnails(asset_id, filename, source, source_url, width, height, byte_size, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET filename=excluded.filename, source=excluded.source,
                source_url=excluded.source_url, width=excluded.width, height=excluded.height,
                byte_size=excluded.byte_size, updated_at=excluded.updated_at""",
                (asset_id, filename, source, source_url, int(width), int(height), int(byte_size), now, now),
            )

    def clear_thumbnail(self, asset_id: str) -> dict[str, Any] | None:
        existing = self.thumbnail(asset_id)
        with _LOCK, self._connection() as db:
            db.execute("DELETE FROM asset_thumbnails WHERE asset_id=?", (asset_id,))
        return existing

    def set_remote_metadata(self, asset_id: str, payload: dict[str, Any], source: str) -> None:
        clean = dict(payload or {})
        model_id = str(clean.get("model_id") or "")
        version_id = str(clean.get("version_id") or "")
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute(
                """INSERT INTO asset_remote_metadata(asset_id, source, payload_json, fetched_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET source=excluded.source, payload_json=excluded.payload_json, fetched_at=excluded.fetched_at""",
                (asset_id, str(source or ""), json.dumps(clean, sort_keys=True), now),
            )
            if model_id or version_id:
                db.execute(
                    """UPDATE assets SET
                    civitai_model_id=CASE WHEN ?<>'' THEN ? ELSE civitai_model_id END,
                    civitai_version_id=CASE WHEN ?<>'' THEN ? ELSE civitai_version_id END,
                    updated_at=? WHERE asset_id=?""",
                    (model_id, model_id, version_id, version_id, now, asset_id),
                )

    @staticmethod
    def _decode_remote(value: Any) -> dict[str, Any]:
        try:
            return json.loads(str(value or "{}"))
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}

    def exact_repair_target(self, *, sha256: str = "", old_path: str = "") -> str | None:
        """Return an automatic repair only when identity is exact and unique.

        Filename similarity is intentionally excluded: a wrong LoRA route is
        more harmful than leaving a broken reference visible for review.
        """

        with _LOCK, self._connection() as db:
            if sha256:
                rows = db.execute("SELECT current_path FROM assets WHERE sha256=?", (sha256,)).fetchall()
            elif old_path:
                rows = db.execute("SELECT a.current_path FROM assets a JOIN asset_paths p ON p.asset_id=a.asset_id WHERE p.path=?", (os.path.abspath(old_path),)).fetchall()
            else:
                return None
        paths = {str(row[0]) for row in rows if row[0]}
        return next(iter(paths)) if len(paths) == 1 else None

    def list_assets(self, state: str = "", query: str = "", sort: str = "recent") -> list[dict[str, Any]]:
        terms: list[str] = []
        clauses: list[str] = []
        params: list[Any] = []
        normalized_state = str(state or "").strip().lower()
        if normalized_state == "tested":
            clauses.append("COALESCE(u.use_count, 0)>0")
        elif normalized_state == "untested":
            clauses.append("COALESCE(u.use_count, 0)=0")
        elif normalized_state in {"keep", "favorite", "retest", "reject"}:
            clauses.append("r.state=?")
            params.append(normalized_state)
        if query.strip():
            clauses.append("(a.current_path LIKE ? OR a.model_name LIKE ?)")
            needle = f"%{query.strip()}%"
            params.extend([needle, needle])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order = {
            "most_used": "COALESCE(u.use_count, 0) DESC, a.model_name COLLATE NOCASE ASC",
            "least_used": "COALESCE(u.use_count, 0) ASC, a.model_name COLLATE NOCASE ASC",
            "name": "a.model_name COLLATE NOCASE ASC",
            "last_used": "COALESCE(u.last_used_at, '') DESC, a.model_name COLLATE NOCASE ASC",
        }.get(str(sort or "recent"), "a.updated_at DESC")
        with _LOCK, self._connection() as db:
            rows = db.execute(
                f"""SELECT a.*,
                CASE WHEN r.state IN ('keep', 'favorite', 'retest', 'reject') THEN r.state ELSE 'none' END AS review_state,
                COALESCE(r.rating, 0) AS rating, COALESCE(r.note, '') AS note,
                COALESCE(u.use_count, 0) AS use_count, COALESCE(u.last_used_at, '') AS last_used_at,
                COALESCE(u.last_output, '') AS last_output,
                COALESCE(t.filename, '') AS thumbnail_ref, COALESCE(t.source, '') AS thumbnail_source,
                COALESCE(t.width, 0) AS thumbnail_width, COALESCE(t.height, 0) AS thumbnail_height,
                COALESCE(t.byte_size, 0) AS thumbnail_bytes, COALESCE(t.updated_at, '') AS thumbnail_updated_at,
                COALESCE(m.payload_json, '{{}}') AS remote_json,
                CASE WHEN COALESCE(u.use_count, 0)>0 THEN 1 ELSE 0 END AS tested
                FROM assets a LEFT JOIN asset_reviews r ON r.asset_id=a.asset_id
                LEFT JOIN asset_usage u ON u.asset_id=a.asset_id
                LEFT JOIN asset_thumbnails t ON t.asset_id=a.asset_id
                LEFT JOIN asset_remote_metadata m ON m.asset_id=a.asset_id
                {where}
                ORDER BY {order}""",
                params,
            ).fetchall()
        values: list[dict[str, Any]] = []
        for row in rows:
            value = dict(row)
            remote = self._decode_remote(value.pop("remote_json", "{}"))
            remote_images = _supported_remote_images(remote)
            value["civitai_preview"] = remote_images[0] if remote_images else ""
            value["civitai_image_count"] = len(remote_images)
            value["civitai_creator"] = str(remote.get("creator") or "")
            value["base_model"] = str(remote.get("base_model") or "")
            values.append(value)
        return values

    def save_filter(self, name: str, query: dict[str, Any]) -> None:
        clean = str(name).strip()
        if not clean:
            raise ValueError("Filter name is required")
        with _LOCK, self._connection() as db:
            db.execute("INSERT OR REPLACE INTO saved_filters(name, query_json, updated_at) VALUES (?, ?, ?)", (clean, json.dumps(query, sort_keys=True), _now()))

    def filters(self) -> list[dict[str, Any]]:
        with _LOCK, self._connection() as db:
            rows = db.execute("SELECT name, query_json, updated_at FROM saved_filters ORDER BY name COLLATE NOCASE").fetchall()
        return [{"name": row["name"], "query": json.loads(row["query_json"]), "updated_at": row["updated_at"]} for row in rows]

    def save_recipe(self, recipe_id: str, name: str, payload: dict[str, Any], preview_ref: str = "") -> None:
        clean_name = str(name).strip()
        if not clean_name:
            raise ValueError("Recipe name is required")
        now = _now()
        with _LOCK, self._connection() as db:
            db.execute(
                """INSERT INTO recipes(recipe_id, name, payload_json, preview_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(recipe_id) DO UPDATE SET name=excluded.name, payload_json=excluded.payload_json, preview_ref=excluded.preview_ref, updated_at=excluded.updated_at""",
                (recipe_id, clean_name, json.dumps(payload, sort_keys=True), str(preview_ref or ""), now, now),
            )

    def recipes(self) -> list[dict[str, Any]]:
        with _LOCK, self._connection() as db:
            rows = db.execute("SELECT * FROM recipes ORDER BY updated_at DESC").fetchall()
        return [dict(row) | {"payload": json.loads(row["payload_json"])} for row in rows]

    def delete_recipe(self, recipe_id: str) -> None:
        with _LOCK, self._connection() as db:
            db.execute("DELETE FROM recipes WHERE recipe_id=?", (recipe_id,))


_CATALOG: SoloCatalog | None = None


def get_catalog() -> SoloCatalog:
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = SoloCatalog()
    return _CATALOG
