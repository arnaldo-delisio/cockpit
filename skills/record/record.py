#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""record — live meeting audio capture for Cockpit.

Mechanical helper for the shared `record` skill:
- detect RUNNING Pulse/PipeWire sources via pactl
- record one or more sources to canonical .opus audio under ~/.cockpit/artifacts/
- transcribe by delegating to ~/.cockpit/skills/watch/watch.py
- never writes meeting-note prose; the agent writes the note from the transcript
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

COCKPIT = Path.home() / ".cockpit"
MEMORY = COCKPIT / "memory"
SCOPES_FILE = MEMORY / "scopes.json"
ARTIFACTS = COCKPIT / "artifacts" / "meetings"
WATCH = COCKPIT / "skills" / "watch" / "watch.py"
STATE_NAME = "current.json"


def eprint(*args: object) -> None:
    print("[record]", *args, file=sys.stderr)


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    text = re.sub(r"[\s_-]+", "-", text)
    return (text or "meeting")[:80]


def now_slug(title: str | None = None) -> str:
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M")
    suffix = slugify(title or "meeting")
    return f"{stamp}-{suffix}"


def load_scopes() -> list[str]:
    if not SCOPES_FILE.exists():
        return ["global", "cockpit"]
    try:
        data = json.loads(SCOPES_FILE.read_text())
    except Exception as exc:
        raise SystemExit(f"Cannot read {SCOPES_FILE}: {exc}") from exc
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise SystemExit(f"Invalid scopes file: {SCOPES_FILE}")
    return data


def resolve_scope(raw: str | None) -> str:
    scope = raw or os.environ.get("COCKPIT_SCOPE")
    scopes = load_scopes()
    if not scope:
        raise SystemExit(
            "Missing --scope and COCKPIT_SCOPE is unset. Available scopes: " + ", ".join(scopes)
        )
    if scope not in scopes:
        raise SystemExit(f"Unknown scope {scope!r}. Available scopes: {', '.join(scopes)}")
    return scope


def dirs(scope: str) -> dict[str, Path]:
    root = ARTIFACTS / scope
    paths = {
        "root": root,
        "recordings": root / "recordings",
        "notes": root / "notes",
        "state": root / "state",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def state_path(scope: str) -> Path:
    return dirs(scope)["state"] / STATE_NAME


def find_active_state() -> tuple[str, Path, dict[str, Any]] | None:
    for p in sorted(ARTIFACTS.glob(f"*/state/{STATE_NAME}")):
        try:
            state = json.loads(p.read_text())
        except Exception:
            continue
        pid = state.get("pid")
        if isinstance(pid, int) and process_alive(pid):
            return p.parts[-3], p, state
    return None


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def parse_pactl_sources() -> list[dict[str, str]]:
    if not shutil.which("pactl"):
        raise SystemExit("pactl not found; cannot detect live audio sources")
    proc = subprocess.run(["pactl", "list", "sources"], capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit("pactl list sources failed:\n" + proc.stderr[-1000:])

    sources: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    for line in proc.stdout.splitlines():
        if line.startswith("Source #"):
            if cur:
                sources.append(cur)
            cur = {"id": line.split("#", 1)[1].strip()}
            continue
        if cur is None:
            continue
        stripped = line.strip()
        if stripped.startswith("State:"):
            cur["state"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Name:"):
            cur["name"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Description:"):
            cur["description"] = stripped.split(":", 1)[1].strip()
    if cur:
        sources.append(cur)
    return sources


def pick_running_sources() -> list[dict[str, str]]:
    sources = parse_pactl_sources()
    running = [s for s in sources if s.get("state") == "RUNNING" and s.get("name")]
    if running:
        return order_sources(running)

    summary = [
        f"- {s.get('state', '?'):8} {s.get('name', '?')} ({s.get('description', '')})"
        for s in sources
    ]
    raise SystemExit("No RUNNING audio sources found. pactl saw:\n" + "\n".join(summary))


def order_sources(sources: list[dict[str, str]]) -> list[dict[str, str]]:
    def score(src: dict[str, str]) -> tuple[int, int, str]:
        name = src.get("name", "")
        desc = src.get("description", "")
        hay = f"{name} {desc}".lower()
        is_monitor = ".monitor" in name or "monitor" in hay
        is_bt = "bluez" in hay or "bluetooth" in hay
        # Prefer bluetooth and balanced monitor/mic ordering; all RUNNING sources are allowed.
        return (0 if is_bt else 1, 0 if is_monitor else 1, name)

    return sorted(sources, key=score)


def ffmpeg_record_command(sources: list[dict[str, str]], output: Path) -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
    for src in sources:
        cmd += ["-f", "pulse", "-i", src["name"]]
    if len(sources) > 1:
        cmd += ["-filter_complex", f"amix=inputs={len(sources)}:duration=longest:normalize=0"]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", str(output)]
    return cmd


def duration_hhmmss(path: Path) -> str | None:
    if not shutil.which("ffprobe") or not path.exists():
        return None
    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    try:
        seconds = int(float(proc.stdout.strip()))
    except ValueError:
        return None
    return str(dt.timedelta(seconds=seconds))


def run_watch(audio: Path, scope: str) -> Path:
    if not WATCH.exists():
        raise SystemExit(f"watch.py not found at {WATCH}")
    cmd = ["uv", "run", str(WATCH), str(audio), "--scope", scope]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise SystemExit("watch.py failed:\n" + proc.stdout + proc.stderr[-1200:])
    print(proc.stdout, end="", file=sys.stderr)
    match = re.search(r"^saved:\s*(.+)$", proc.stdout, flags=re.MULTILINE)
    if not match:
        raise SystemExit("watch.py did not print a saved transcript path")
    return Path(match.group(1).strip())


def convert_to_opus(src: Path, dst: Path) -> None:
    if not src.exists():
        raise SystemExit(f"Input file not found: {src}")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", str(src),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not dst.exists():
        raise SystemExit("ffmpeg conversion failed:\n" + proc.stderr[-1200:])


def command_scopes(_: argparse.Namespace) -> None:
    for scope in load_scopes():
        print(scope)


def command_status(_: argparse.Namespace) -> None:
    active = find_active_state()
    if not active:
        print(json.dumps({"active": False}, indent=2))
        return
    scope, path, state = active
    print(json.dumps({"active": True, "scope": scope, "state_path": str(path), **state}, indent=2))


def command_start(args: argparse.Namespace) -> None:
    scope = resolve_scope(args.scope)
    active = find_active_state()
    if active and not args.force:
        _, path, state = active
        raise SystemExit(
            f"A recording is already active (pid {state.get('pid')}, state {path}). Use --force only after confirming it is safe."
        )

    paths = dirs(scope)
    slug = now_slug(args.title)
    audio = paths["recordings"] / f"{slug}.opus"
    sources = pick_running_sources()
    cmd = ffmpeg_record_command(sources, audio)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    time.sleep(0.8)
    if proc.poll() is not None:
        err = proc.stderr.read() if proc.stderr else ""
        raise SystemExit("ffmpeg exited immediately:\n" + err[-1200:])

    state = {
        "pid": proc.pid,
        "scope": scope,
        "slug": slug,
        "title": args.title or "meeting",
        "audio_path": str(audio),
        "started_at": dt.datetime.now().isoformat(timespec="seconds"),
        "sources": sources,
        "command": cmd,
    }
    sp = state_path(scope)
    sp.write_text(json.dumps(state, indent=2))
    print(json.dumps({"started": True, "state_path": str(sp), **state}, indent=2))


def stop_process(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGINT)
    except ProcessLookupError:
        return
    except Exception:
        try:
            os.kill(pid, signal.SIGINT)
        except ProcessLookupError:
            return
    for _ in range(30):
        if not process_alive(pid):
            return
        time.sleep(0.2)
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def command_stop(args: argparse.Namespace) -> None:
    active = find_active_state()
    if not active:
        raise SystemExit("No active recording found")
    scope, sp, state = active
    pid = state["pid"]
    stop_process(pid)
    audio = Path(state["audio_path"])
    for _ in range(20):
        if audio.exists() and audio.stat().st_size > 0:
            break
        time.sleep(0.2)
    if not audio.exists() or audio.stat().st_size == 0:
        raise SystemExit(f"Recording stopped, but audio was not written: {audio}")

    result: dict[str, Any] = {
        "stopped": True,
        "scope": scope,
        "slug": state.get("slug"),
        "audio_path": str(audio),
        "duration": duration_hhmmss(audio),
        "started_at": state.get("started_at"),
        "stopped_at": dt.datetime.now().isoformat(timespec="seconds"),
        "sources": state.get("sources", []),
    }
    if not args.no_transcribe:
        result["transcript_path"] = str(run_watch(audio, scope))
    sp.unlink(missing_ok=True)
    print(json.dumps(result, indent=2))


def command_ingest(args: argparse.Namespace) -> None:
    scope = resolve_scope(args.scope)
    paths = dirs(scope)
    src = Path(args.audio).expanduser().resolve()
    slug = now_slug(args.title or src.stem)
    audio = paths["recordings"] / f"{slug}.opus"
    convert_to_opus(src, audio)
    result: dict[str, Any] = {
        "ingested": True,
        "scope": scope,
        "slug": slug,
        "source_audio": str(src),
        "audio_path": str(audio),
        "duration": duration_hhmmss(audio),
    }
    if not args.no_transcribe:
        result["transcript_path"] = str(run_watch(audio, scope))
    print(json.dumps(result, indent=2))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="record", description="Cockpit live meeting recording helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scopes", help="list available Cockpit scopes")
    s.set_defaults(func=command_scopes)

    s = sub.add_parser("status", help="show active recording state")
    s.set_defaults(func=command_status)

    s = sub.add_parser("start", help="start live recording from RUNNING pactl sources")
    s.add_argument("--scope", help="Cockpit scope; required unless COCKPIT_SCOPE is set")
    s.add_argument("--title", help="short title used in the audio slug")
    s.add_argument("--force", action="store_true", help="start even if a previous state file says active")
    s.set_defaults(func=command_start)

    s = sub.add_parser("stop", help="stop active recording and transcribe it")
    s.add_argument("--no-transcribe", action="store_true", help="stop only; do not call watch.py")
    s.set_defaults(func=command_stop)

    s = sub.add_parser("ingest", help="copy/convert existing audio to artifacts and transcribe it")
    s.add_argument("audio", help="existing audio/video file")
    s.add_argument("--scope", help="Cockpit scope; required unless COCKPIT_SCOPE is set")
    s.add_argument("--title", help="short title used in the audio slug")
    s.add_argument("--no-transcribe", action="store_true", help="ingest only; do not call watch.py")
    s.set_defaults(func=command_ingest)
    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
