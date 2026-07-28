from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any

from gaze_payloads import (
    build_analysis_results_request,
    build_session_end_request,
    build_session_start_request,
)


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
            request = build_session_start_request(payload)
            response = await asyncio.to_thread(self._request, "POST", "/api/app/gaze/sessions", request)
            return {"ok": True, "request": request, "response": response}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def complete_session(self, gaze_session_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True, "reason": "Backend gaze sync is disabled."}

        try:
            session_id = _required_int(gaze_session_id, "gazeSessionId")
            analysis_request = build_analysis_results_request(payload)
            end_request = build_session_end_request(payload)
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
                end_request,
            )
            return {
                "ok": True,
                "analysisRequest": analysis_request,
                "analysisResponse": analysis_response,
                "endRequest": end_request,
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
