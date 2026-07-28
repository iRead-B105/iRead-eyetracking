from __future__ import annotations

import asyncio
import json
import platform
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend_gaze_client import BackendGazeClient
from reading_storage import ReadingStorage
from tobii_launcher import launch_target, resolve_launch_targets
from tobii_sources import NativeProcessTracker, SimulatedTracker


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
CONFIG_EXAMPLE_PATH = ROOT / "config.example.json"
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"


def read_config() -> dict[str, Any]:
    path = CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_EXAMPLE_PATH
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


config = read_config()
app = FastAPI(title="Tobii Eye Tracker 5 Local Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
tracker = SimulatedTracker()
native_tracker = NativeProcessTracker(ROOT, config.get("nativeBridge", {}))
reading_storage = ReadingStorage(DATA_DIR / "reading_sessions.sqlite3")
backend_gaze_client = BackendGazeClient(config.get("backend", {}))
stream_mode = "simulation"
connected_clients: set[int] = set()


@app.get("/api/status")
async def status() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "mode": stream_mode,
            "clients": len(connected_clients),
            "platform": platform.platform(),
            "python": platform.python_version(),
            "launchTargets": resolve_launch_targets(config.get("launchTargets", {})),
            "nativeBridge": native_tracker.status(),
            "backend": backend_gaze_client.status(),
            "profiles": config.get("profiles", {}),
        }
    )


@app.get("/api/profiles")
async def profiles() -> JSONResponse:
    return JSONResponse({"profiles": config.get("profiles", {})})


@app.post("/api/mode")
async def set_mode(payload: dict[str, Any]) -> JSONResponse:
    global stream_mode
    requested = payload.get("mode")
    if requested == "native":
        started = await native_tracker.start()
        if not started:
            raise HTTPException(
                status_code=503,
                detail=native_tracker.last_error
                or "Native bridge executable is not available.",
            )
        stream_mode = "native"
    elif requested == "idle":
        stream_mode = "idle"
    else:
        stream_mode = "simulation"
    return JSONResponse({"ok": True, "mode": stream_mode})


@app.post("/api/launch")
async def launch(payload: dict[str, Any]) -> JSONResponse:
    target = str(payload.get("target", ""))
    result = launch_target(target, config.get("launchTargets", {}))
    if not result.get("ok"):
        return JSONResponse(result, status_code=404)
    return JSONResponse(result)


@app.post("/api/reading/sessions")
async def create_reading_session(payload: dict[str, Any]) -> JSONResponse:
    session = reading_storage.create_session(payload)
    backend_sync = await backend_gaze_client.start_session(payload)
    session["backendSync"] = backend_sync
    if backend_sync.get("ok"):
        gaze_session_id = (backend_sync.get("response") or {}).get("gazeSessionId")
        if gaze_session_id is not None:
            session["gazeSessionId"] = gaze_session_id
    return JSONResponse(session)


@app.post("/api/reading/sessions/{session_id}/metrics")
async def save_reading_metrics(session_id: int, payload: dict[str, Any]) -> JSONResponse:
    result = reading_storage.add_metrics(session_id, payload)
    if not result.get("ok"):
        return JSONResponse(result, status_code=404)
    gaze_session_id = payload.get("gazeSessionId") or payload.get("backendGazeSessionId")
    result["backendSync"] = await backend_gaze_client.complete_session(gaze_session_id, payload)
    return JSONResponse(result)


@app.get("/api/reading/sessions")
async def list_reading_sessions(limit: int = 20) -> JSONResponse:
    return JSONResponse({"sessions": reading_storage.list_sessions(limit)})


@app.get("/api/reading/sessions/{session_id}")
async def get_reading_session(session_id: int) -> JSONResponse:
    result = reading_storage.get_session(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Unknown session id: {session_id}")
    return JSONResponse(result)


@app.websocket("/gaze")
async def gaze_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    client_id = id(websocket)
    connected_clients.add(client_id)
    await websocket.send_json(
        {
            "type": "hello",
            "source": stream_mode,
            "message": "Connected to local Tobii bridge demo.",
        }
    )

    try:
        while True:
            if stream_mode == "idle":
                await asyncio.sleep(0.2)
                continue

            if stream_mode == "native":
                frame = await native_tracker.next_frame()
                if frame is None:
                    await asyncio.sleep(0.01)
                    continue
            else:
                frame = tracker.next_frame()
            await websocket.send_json(frame)
            if stream_mode != "native":
                await asyncio.sleep(1 / 60)
    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.discard(client_id)


if not PUBLIC_DIR.exists():
    raise RuntimeError(f"Missing public directory: {PUBLIC_DIR}")


app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
