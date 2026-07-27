from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any


class BackendGazeClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.enabled = bool(config.get("enabled", False))
        self.base_url = str(config.get("baseUrl") or "http://localhost:8080").rstrip("/")
        self.timeout = float(config.get("timeoutSeconds") or 5)
        self.session_cookie = str(config.get("sessionCookie") or "").strip()

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "baseUrl": self.base_url,
            "authenticated": bool(self.session_cookie),
        }

    async def start_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True, "reason": "Backend gaze sync is disabled."}

        try:
            student_id = _required_int(payload.get("studentId"), "studentId")
            content_type = str(payload.get("contentType") or "TEST").upper()
            content_id = _required_int(payload.get("contentId"), "contentId")
            request = {
                "studentId": student_id,
                "contentType": content_type,
                "calibrationStatus": str(payload.get("calibrationStatus") or "SUCCESS").upper(),
            }

            if content_type == "TEST":
                request["testId"] = content_id
            elif content_type == "TRAINING":
                request["trainingId"] = content_id
            elif content_type == "STORY":
                request["storyId"] = content_id
            else:
                raise ValueError(f"Unsupported contentType: {content_type}")

            response = await asyncio.to_thread(self._request, "POST", "/api/app/gaze/sessions", request)
            return {"ok": True, "request": request, "response": response}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def complete_session(self, gaze_session_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True, "reason": "Backend gaze sync is disabled."}

        try:
            session_id = _required_int(gaze_session_id, "gazeSessionId")
            student_id = _required_int(payload.get("studentId"), "studentId")
            summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
            words = payload.get("words") if isinstance(payload.get("words"), list) else []

            total_visited_duration = _summary_int(
                summary,
                "totalDwellMs",
                sum(_safe_int(word.get("dwellMs")) for word in words if isinstance(word, dict)),
            )
            total_visited_count = _summary_int(
                summary,
                "totalVisitCount",
                sum(_safe_int(word.get("visitCount")) for word in words if isinstance(word, dict)),
            )
            reverse_read_count = _summary_int(
                summary,
                "totalRegressionCount",
                sum(_safe_int(word.get("regressionCount")) for word in words if isinstance(word, dict)),
            )
            visited_words = _summary_int(
                summary,
                "visitedWords",
                sum(1 for word in words if isinstance(word, dict) and _safe_int(word.get("visitCount")) > 0),
            )
            avg_visited_duration = (
                round(total_visited_duration / visited_words) if visited_words > 0 else 0
            )

            analysis_request = {
                "studentId": student_id,
                "totalVisitedDuration": total_visited_duration,
                "totalVisitedCount": total_visited_count,
                "reverseReadCount": reverse_read_count,
                "avgVisitedDuration": avg_visited_duration,
            }
            analysis_response = await asyncio.to_thread(
                self._request,
                "POST",
                f"/api/app/gaze/sessions/{session_id}/analysis-results",
                analysis_request,
            )
            end_response = await asyncio.to_thread(
                self._request,
                "PATCH",
                f"/api/app/gaze/sessions/{session_id}/end",
                {"studentId": student_id, "status": "COMPLETED"},
            )
            return {
                "ok": True,
                "analysisRequest": analysis_request,
                "analysisResponse": analysis_response,
                "endResponse": end_response,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _request(self, method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                **self._cookie_header(),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Backend returned {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Backend request failed: {exc.reason}") from exc

    def _cookie_header(self) -> dict[str, str]:
        if not self.session_cookie:
            return {}
        cookie = self.session_cookie
        if "=" not in cookie:
            cookie = f"JSESSIONID={cookie}"
        return {"Cookie": cookie}


def _required_int(value: Any, field: str) -> int:
    if value in (None, ""):
        raise ValueError(f"{field} is required for backend gaze sync.")
    return int(value)


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _summary_int(summary: dict[str, Any], key: str, fallback: int) -> int:
    value = summary.get(key)
    return _safe_int(value) if value is not None else int(fallback)
