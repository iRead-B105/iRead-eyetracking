from __future__ import annotations

import math
import asyncio
import json
import os
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
        self.process: asyncio.subprocess.Process | None = None
        self.reader_task: asyncio.Task[None] | None = None
        self.queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=4)
        self.last_error: str | None = None
        self.last_frame_at: int | None = None

    async def start(self) -> bool:
        if self.process and self.process.returncode is None:
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

        self.process = await asyncio.create_subprocess_exec(
            str(exe_path),
            cwd=str(exe_path.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        self.reader_task = asyncio.create_task(self._read_stdout())
        asyncio.create_task(self._read_stderr())
        self.last_error = None
        return True

    async def next_frame(self) -> dict[str, object] | None:
        if not await self.start():
            return None

        try:
            frame = await asyncio.wait_for(self.queue.get(), timeout=0.25)
        except asyncio.TimeoutError:
            return None

        self.last_frame_at = round(time.time() * 1000)
        return frame

    def status(self) -> dict[str, object]:
        exe_path = self._resolve_path(self.config.get("exePath", ""))
        return {
            "configured": bool(self.config.get("exePath")),
            "exePath": str(exe_path),
            "exists": exe_path.exists(),
            "running": bool(self.process and self.process.returncode is None),
            "lastFrameAt": self.last_frame_at,
            "lastError": self.last_error,
        }

    async def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        while True:
            line = await self.process.stdout.readline()
            if not line:
                break

            try:
                payload = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError:
                continue

            if payload.get("type") != "gaze":
                continue

            if self.queue.full():
                try:
                    self.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await self.queue.put(payload)

    async def _read_stderr(self) -> None:
        assert self.process and self.process.stderr
        while True:
            line = await self.process.stderr.readline()
            if not line:
                break
            self.last_error = line.decode("utf-8", errors="replace").strip()

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
