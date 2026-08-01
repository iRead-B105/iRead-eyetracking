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
        # 백엔드는 Authorization: Bearer(JWT)로 인증한다. 학생 access token을 주입한다.
        # sessionCookie 키는 하위 호환용으로 남둔다. 다중 학생 지원은 P5-E에서 다룬다.
        self.access_token = str(
            config.get("accessToken") or config.get("sessionCookie") or ""
        ).strip()

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "baseUrl": self.base_url,
            "authenticated": bool(self.access_token),
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
            # 백엔드 saveAnalysisResult는 세션이 COMPLETED 상태일 때만 허용한다.
            # 따라서 end(PATCH)로 먼저 COMPLETED로 만든 뒤 analysis-results(POST)를 보낸다.
            end_response = await asyncio.to_thread(
                self._request,
                "PATCH",
                f"/api/app/gaze/sessions/{session_id}/end",
                end_request,
            )
            analysis_response = await asyncio.to_thread(
                self._request,
                "POST",
                f"/api/app/gaze/sessions/{session_id}/analysis-results",
                analysis_request,
            )
            return {
                "ok": True,
                "endRequest": end_request,
                "endResponse": end_response,
                "analysisRequest": analysis_request,
                "analysisResponse": analysis_response,
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
                **self._auth_header(),
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

    def _auth_header(self) -> dict[str, str]:
        if not self.access_token:
            return {}
        return {"Authorization": f"Bearer {self.access_token}"}


def _required_int(value: Any, field: str) -> int:
    if value in (None, ""):
        raise ValueError(f"{field} is required for backend gaze sync.")
    return int(value)
