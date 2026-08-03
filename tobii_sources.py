from __future__ import annotations

import math
import asyncio
import json
import os
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class GazeFrame:
    type: str
    source: str
    x: float
    y: float
    screenX: int
    screenY: int
    valid: bool
    presence: bool
    timestamp: int


class SimulatedTracker:
    def __init__(self, screen_width: int = 1920, screen_height: int = 1080) -> None:
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.frame_index = 0

    def next_frame(self) -> dict[str, object]:
        self.frame_index += 1
        seconds = self.frame_index / 60
        x = _clamp01(
            0.5
            + math.sin(seconds * 1.45) * 0.33
            + math.sin(seconds * 0.31) * 0.08
        )
        y = _clamp01(
            0.5
            + math.cos(seconds * 1.1) * 0.25
            + math.sin(seconds * 0.77) * 0.06
        )

        frame = GazeFrame(
            type="gaze",
            source="simulation",
            x=x,
            y=y,
            screenX=round(x * self.screen_width),
            screenY=round(y * self.screen_height),
            valid=True,
            presence=True,
            timestamp=round(time.time() * 1000),
        )
        return frame.__dict__


class NativeTobiiTracker:
    """Placeholder for a real Tobii SDK-backed source.

    Keep the output contract identical to SimulatedTracker.next_frame().
    A practical implementation is usually one of these:
    - A C#/C++ Tobii Game Integration API process that writes JSON lines.
    - A Python native extension/wrapper around Stream Engine.
    - A separate local service that this FastAPI app reads from.
    """

    def next_frame(self) -> dict[str, object]:
        raise NotImplementedError("Connect this class to Tobii SDK output.")


class NativeProcessTracker:
    def __init__(self, root: Path, config: dict[str, Any]) -> None:
        self.root = root
        self.config = config
        self.process: subprocess.Popen[str] | None = None
        self.stdout_thread: threading.Thread | None = None
        self.stderr_thread: threading.Thread | None = None
        self.queue: queue.Queue[dict[str, object]] = queue.Queue(maxsize=4)
        self.last_error: str | None = None
        self.last_frame_at: int | None = None

    async def start(self) -> bool:
        if self.process and self.process.poll() is None:
            return True

        exe_path = self._resolve_path(self.config.get("exePath", ""))
        if not exe_path.exists():
            self.last_error = f"Native bridge executable not found: {exe_path}"
            return False

        env = os.environ.copy()
        sdk_dir = self.config.get("sdkDir")
        if sdk_dir:
            dll_dir = str(Path(sdk_dir) / "bin" / "x64")
            env["PATH"] = dll_dir + os.pathsep + env.get("PATH", "")
        env["TOBII_BRIDGE_FLIP_X"] = "1" if self.config.get("flipX") else "0"
        env["TOBII_BRIDGE_FLIP_Y"] = "1" if self.config.get("flipY") else "0"
        if self.config.get("unitMode"):
            env["TOBII_BRIDGE_UNIT_MODE"] = str(self.config["unitMode"])

        try:
            self.process = subprocess.Popen(
                [str(exe_path)],
                cwd=str(exe_path.parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except OSError as error:
            self.last_error = f"Failed to start native bridge: {error}"
            return False

        self.stdout_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self.stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self.stdout_thread.start()
        self.stderr_thread.start()
        self.last_error = None
        return True

    async def next_frame(self) -> dict[str, object] | None:
        if not await self.start():
            return None

        try:
            frame = await asyncio.to_thread(self.queue.get, True, 0.25)
        except queue.Empty:
            return None

        self.last_frame_at = round(time.time() * 1000)
        return frame

    def status(self) -> dict[str, object]:
        exe_path = self._resolve_path(self.config.get("exePath", ""))
        return {
            "configured": bool(self.config.get("exePath")),
            "exePath": str(exe_path),
            "exists": exe_path.exists(),
            "running": bool(self.process and self.process.poll() is None),
            "lastFrameAt": self.last_frame_at,
            "lastError": self.last_error,
        }

    def _read_stdout(self) -> None:
        if not self.process or not self.process.stdout:
            return

        for line in self.process.stdout:
            if not line.strip():
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue

            if payload.get("type") != "gaze":
                continue

            if self.queue.full():
                try:
                    self.queue.get_nowait()
                except queue.Empty:
                    pass
            self.queue.put(payload)

    def _read_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return

        for line in self.process.stderr:
            if line.strip():
                self.last_error = line.strip()

    def _resolve_path(self, value: str) -> Path:
        if not value:
            return self.root / "native" / "build" / "tobii_native_bridge.exe"

        expanded = os.path.expandvars(value)
        path = Path(expanded)
        if path.is_absolute():
            return path
        return self.root / path


def _clamp01(value: float) -> float:
    return max(0, min(1, value))
