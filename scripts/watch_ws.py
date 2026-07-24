from __future__ import annotations

import asyncio
import json

import websockets


async def main() -> None:
    async with websockets.connect("ws://127.0.0.1:8765/gaze") as websocket:
        for _ in range(30):
            payload = json.loads(await websocket.recv())
            if payload.get("type") != "gaze":
                print(payload)
                continue
            print(
                f"source={payload.get('source')} "
                f"valid={payload.get('valid')} "
                f"presence={payload.get('presence')} "
                f"x={payload.get('x')} "
                f"y={payload.get('y')} "
                f"screen=({payload.get('screenX')},{payload.get('screenY')}) "
                f"raw=({payload.get('rawX', '-')},{payload.get('rawY', '-')}) "
                f"unit={payload.get('rawUnit', '-')} "
                f"clamped={payload.get('clamped', '-')}"
            )


if __name__ == "__main__":
    asyncio.run(main())
