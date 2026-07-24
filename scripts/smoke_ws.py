from __future__ import annotations

import asyncio

import websockets


async def main() -> None:
    async with websockets.connect("ws://127.0.0.1:8765/gaze") as websocket:
        print(await websocket.recv())
        print(await websocket.recv())


if __name__ == "__main__":
    asyncio.run(main())
