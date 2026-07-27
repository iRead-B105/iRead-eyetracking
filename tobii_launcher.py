from __future__ import annotations

import os
import subprocess
from glob import glob
from pathlib import Path
from typing import Any


def resolve_launch_targets(targets: dict[str, list[str]]) -> dict[str, list[dict[str, Any]]]:
    resolved: dict[str, list[dict[str, Any]]] = {}
    for name, candidates in targets.items():
        resolved[name] = []
        for candidate in candidates:
            paths = _candidate_paths(candidate)
            if paths:
                resolved[name].extend({"path": str(path), "exists": True} for path in paths)
            else:
                resolved[name].append({"path": _expand(candidate), "exists": False})
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
        paths = _candidate_paths(candidate)
        if not paths:
            checked.append(_expand(candidate))
            continue

        for candidate_path in paths:
            path = str(candidate_path)
            checked.append(path)
            try:
                process = subprocess.Popen(
                    [path],
                    cwd=str(candidate_path.parent),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
                )
            except OSError as error:
                return {
                    "ok": False,
                    "target": target,
                    "path": path,
                    "error": str(error),
                    "checked": checked,
                }
            return {"ok": True, "target": target, "path": path, "pid": process.pid}

    return {
        "ok": False,
        "target": target,
        "error": "Executable not found. Add the installed path to config.json.",
        "checked": checked,
    }


def _expand(value: str) -> str:
    return os.path.expandvars(value)


def _candidate_paths(value: str) -> list[Path]:
    expanded = _expand(value)
    if not any(mark in expanded for mark in "*?[]"):
        path = Path(expanded)
        return [path] if path.exists() else []

    return sorted((Path(path) for path in glob(expanded)), reverse=True)
