from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class ReadingStorage:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = _now_ms()
        student_id = str(payload.get("studentId") or "anonymous")
        text_id = str(payload.get("textId") or f"text-{now}")
        text = str(payload.get("text") or "")
        tobii_profile = payload.get("tobiiProfile")

        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO reading_sessions
                    (student_id, text_id, text, tobii_profile, started_at_ms, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    student_id,
                    text_id,
                    text,
                    tobii_profile,
                    now,
                    json.dumps(payload.get("metadata") or {}, ensure_ascii=False),
                ),
            )
            session_id = cursor.lastrowid

        return {
            "ok": True,
            "sessionId": session_id,
            "studentId": student_id,
            "textId": text_id,
            "startedAtMs": now,
        }

    def add_metrics(self, session_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        now = _now_ms()
        words = payload.get("words")
        if not isinstance(words, list):
            words = []

        with self._connect() as conn:
            session = conn.execute(
                "SELECT id FROM reading_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                return {"ok": False, "error": f"Unknown session id: {session_id}"}

            conn.execute("DELETE FROM word_metrics WHERE session_id = ?", (session_id,))
            for word in words:
                conn.execute(
                    """
                    INSERT INTO word_metrics
                        (
                            session_id, word_index, word_text, dwell_ms, visit_count,
                            regression_count, first_seen_ms, last_seen_ms, metadata_json
                        )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        int(word.get("index") or 0),
                        str(word.get("text") or ""),
                        int(word.get("dwellMs") or 0),
                        int(word.get("visitCount") or 0),
                        int(word.get("regressionCount") or 0),
                        _nullable_int(word.get("firstSeenMs")),
                        _nullable_int(word.get("lastSeenMs")),
                        json.dumps(word.get("metadata") or {}, ensure_ascii=False),
                    ),
                )

            conn.execute(
                """
                UPDATE reading_sessions
                SET ended_at_ms = ?, summary_json = ?
                WHERE id = ?
                """,
                (
                    now,
                    json.dumps(payload.get("summary") or {}, ensure_ascii=False),
                    session_id,
                ),
            )

        return {"ok": True, "sessionId": session_id, "savedWordCount": len(words), "endedAtMs": now}

    def get_session(self, session_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            session = conn.execute(
                """
                SELECT id, student_id, text_id, text, tobii_profile, started_at_ms,
                       ended_at_ms, metadata_json, summary_json
                FROM reading_sessions
                WHERE id = ?
                """,
                (session_id,),
            ).fetchone()
            if session is None:
                return None

            words = conn.execute(
                """
                SELECT word_index, word_text, dwell_ms, visit_count, regression_count,
                       first_seen_ms, last_seen_ms, metadata_json
                FROM word_metrics
                WHERE session_id = ?
                ORDER BY word_index ASC
                """,
                (session_id,),
            ).fetchall()

        return {
            "id": session["id"],
            "studentId": session["student_id"],
            "textId": session["text_id"],
            "text": session["text"],
            "tobiiProfile": session["tobii_profile"],
            "startedAtMs": session["started_at_ms"],
            "endedAtMs": session["ended_at_ms"],
            "metadata": _loads(session["metadata_json"]),
            "summary": _loads(session["summary_json"]),
            "words": [
                {
                    "index": row["word_index"],
                    "text": row["word_text"],
                    "dwellMs": row["dwell_ms"],
                    "visitCount": row["visit_count"],
                    "regressionCount": row["regression_count"],
                    "firstSeenMs": row["first_seen_ms"],
                    "lastSeenMs": row["last_seen_ms"],
                    "metadata": _loads(row["metadata_json"]),
                }
                for row in words
            ],
        }

    def list_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, student_id, text_id, started_at_ms, ended_at_ms, summary_json
                FROM reading_sessions
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [
            {
                "id": row["id"],
                "studentId": row["student_id"],
                "textId": row["text_id"],
                "startedAtMs": row["started_at_ms"],
                "endedAtMs": row["ended_at_ms"],
                "summary": _loads(row["summary_json"]),
            }
            for row in rows
        ]

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS reading_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL,
                    text_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    tobii_profile TEXT,
                    started_at_ms INTEGER NOT NULL,
                    ended_at_ms INTEGER,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    summary_json TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS word_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    word_index INTEGER NOT NULL,
                    word_text TEXT NOT NULL,
                    dwell_ms INTEGER NOT NULL DEFAULT 0,
                    visit_count INTEGER NOT NULL DEFAULT 0,
                    regression_count INTEGER NOT NULL DEFAULT 0,
                    first_seen_ms INTEGER,
                    last_seen_ms INTEGER,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(session_id) REFERENCES reading_sessions(id)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_word_metrics_session
                ON word_metrics(session_id, word_index)
                """
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn


def _now_ms() -> int:
    return round(time.time() * 1000)


def _nullable_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _loads(value: str | None) -> Any:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}
