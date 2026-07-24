from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any


def resolve_launch_targets(targets: dict[str, list[str]]) -> dict[str, list[dict[str, Any]]]:
    resolved: dict[str, list[dict[str, Any]]] = {}
    for name, candidates in targets.items():
        resolved[name] = [
            {"path": _expand(candidate), "exists": Path(_expand(candidate)).exists()}
            for candidate in candidates
        ]
    return resolved


def launch_target(target: str, targets: dict[str, list[str]]) -> dict[str, Any]:
    if target == "all":
        results = [
            {"target": name, **launch_target(name, targets)}
            for name in targets.keys()
        ]
        return {"ok": any(item.get("ok") for item in results), "results": results}

    candidates = targets.get(target)
    if candidates is None:
        return {"ok": False, "error": f"Unknown target: {target}"}

    checked: list[str] = []
    for candidate in candidates:
        path = _expand(candidate)
        checked.append(path)
        if Path(path).exists():
            subprocess.Popen(
                [path],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            )
            return {"ok": True, "target": target, "path": path}

    return {
        "ok": False,
        "target": target,
        "error": "Executable not found. Add the installed path to config.json.",
        "checked": checked,
    }


def _expand(value: str) -> str:
    return os.path.expandvars(value)
