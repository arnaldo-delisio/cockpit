---
name: record
description: Record live meeting audio or ingest an existing audio file, transcribe it through the shared watch pipeline, and prepare a structured meeting note with summary, action items, decisions, transcript pointer, and audio pointer. Use when the user says record, record meeting, meeting ended, transcribe meeting, or meeting audio.
version: 1.0.0
model: sonnet
triggers: [record, record meeting, meeting ended, transcribe meeting, meeting audio]
tags: [meetings, audio, transcription, notes, ingestion]
allowed-tools: Bash Read Write
metadata:
  hermes:
    tags: [meetings, audio, transcription, notes]
    platforms: [linux]
    related_skills: [watch]
prerequisites:
  commands: [uv, ffmpeg, ffprobe, pactl]
---

## Purpose

Record live meeting audio, optionally record the full desktop screen, or ingest an existing audio file into Cockpit-owned meeting artifacts and a searchable transcript source.

`record` is for live capture. `watch` remains the transcription/source-ingestion pipeline. The script handles the mechanical work; the agent writes the meeting note from the saved transcript.

## Storage

- Audio/state/notes live under `~/.cockpit/artifacts/meetings/<scope>/`.
- Optional screen recordings live alongside audio as separate `.mp4` artifacts.
- Transcript sources live under `~/.cockpit/memory/scopes/<scope>/sources/`, written by `watch.py`.
- Audio canonical format is `.opus`; export mp3 later only when needed.
- Meeting notes are concise operational artifacts, not full transcript duplicates.

Layout:

```text
~/.cockpit/artifacts/meetings/<scope>/
  recordings/<slug>.opus
  recordings/<slug>.mp4   # optional screen recording
  notes/<slug>.md
  state/current.json
~/.cockpit/memory/scopes/<scope>/sources/<date>-<slug>.md
```

## Procedure

### Live meeting

1. If the user did not provide a scope, ask with asktool/clarify. Do not silently default.
2. Ask the meeting language before recording/transcribing. Prefer an ISO-639-1 code (`it`, `en`, `es`, …). Use `auto` only if the user truly does not know; Groq's docs say an explicit `language` improves accuracy and latency.
3. Start recording:
   ```bash
   uv run ~/.cockpit/skills/record/record.py start --scope <scope> --language <code|auto> [--title "short title"]
   ```
   - The script detects RUNNING Pulse/PipeWire sources using `pactl`.
   - If both mic and monitor are running, it mixes them.
   - If only one RUNNING source exists, it records that source.
   - If none are RUNNING, it stops and reports detected sources.
4. Tell the user: `Recording started. Say "meeting ended" when done.`
5. Ask whether to record the screen too. Screen is off by default. If yes, start the full-desktop screen recording for the active audio session:
   ```bash
   uv run ~/.cockpit/skills/record/record.py screen-start
   ```
   - Screen recording uses `wf-recorder` and writes a separate `.mp4` next to the `.opus` audio.
   - If `wf-recorder` is missing or fails, preserve the audio recording and report the screen blocker.
   - Direct CLI shortcut when screen is already known: add `--screen` to `start`.
6. When the user says the meeting ended, stop and transcribe:
   ```bash
   uv run ~/.cockpit/skills/record/record.py stop
   ```
   The script prints JSON including `audio_path`, optional `screen_path`, and `transcript_path`.
7. If participants were not already provided, ask: `Who were the participants?`
8. Read the transcript source file. Write the meeting note yourself to:
   `~/.cockpit/artifacts/meetings/<scope>/notes/<slug>.md`
9. Report note path, audio path, optional screen path, transcript path, and one-line summary.

### Existing audio file

1. Ask for scope if omitted.
2. Ask the audio language before transcribing. Prefer an ISO-639-1 code (`it`, `en`, `es`, …); use `auto` only when unknown.
3. Ingest and transcribe:
   ```bash
   uv run ~/.cockpit/skills/record/record.py ingest /path/to/audio --scope <scope> --language <code|auto> [--title "short title"]
   ```
4. Ask for participants if missing.
5. Read the transcript and write the concise note.

## Note format

Use this structure. Do not paste the full transcript into the note.

```markdown
---
date: YYYY-MM-DD
title: "<title>"
scope: "<scope>"
participants: [name1, name2]
tags: [meeting]
audio: "<absolute audio path>"
screen: "<absolute screen path, if recorded>"
transcript: "<absolute transcript source path>"
duration: "HH:MM:SS"
---

## Summary

## Action Items

## Key Decisions

## Open Questions / Follow-ups

## Source Links
- Audio: <absolute audio path>
- Screen: <absolute screen path, if recorded>
- Transcript: <absolute transcript source path>
```

## Script commands

```bash
uv run ~/.cockpit/skills/record/record.py start --scope <scope> --language <code|auto> [--title <title>] [--screen] [--force]
uv run ~/.cockpit/skills/record/record.py screen-start
uv run ~/.cockpit/skills/record/record.py stop [--language <code|auto>] [--no-transcribe]
uv run ~/.cockpit/skills/record/record.py ingest <audio> --scope <scope> --language <code|auto> [--title <title>] [--no-transcribe]
uv run ~/.cockpit/skills/record/record.py status
uv run ~/.cockpit/skills/record/record.py scopes
```

## References

- `references/confidential-project-audio-ingest.md` — workaround and verification pattern for confidential projects that are intentionally absent from Cockpit scopes, plus transcript-tail cleanup.

## Rules

1. Use `record.py`; do not hand-roll ffmpeg/curl commands in chat.
2. Do not silently choose a scope. If `--scope` is missing and `COCKPIT_SCOPE` is unset, ask via asktool/clarify.
3. Store transcripts through `watch.py` in the scope's `sources/` layer.
4. Store audio/video/state/notes under `~/.cockpit/artifacts/meetings/<scope>/`.
5. Keep the full transcript in one home only: the transcript source file. Meeting notes link to it.
6. Ask for language before transcription; pass it to `record.py`/`watch.py`. Use ISO-639-1 (`it`, `en`, `es`, …) unless the user explicitly chooses `auto`.
7. Ask for participants before writing the note if they were not provided.
8. After audio starts, ask whether to record the screen too; screen is optional and off by default.
9. Keep audio and screen separate: `.opus` is canonical for transcription; `.mp4` is optional visual context/evidence.
10. Do not run `watch --visual` automatically on screen recordings. Extract frames later only when the user asks for visual analysis.
11. Proceed with any RUNNING audio source. Mix multiple sources; stop only if no source is RUNNING.
12. Never use durable `meeting-tmp` filenames. Use timestamped slugs.
13. If a recording is active, refuse to start another unless the user explicitly chooses `--force`.
14. Do not read, print, or embed secrets. `watch.py` reads `GROQ_API_KEY` from `~/.cockpit/.env`.
15. Do not write canonical memory nodes. Raw transcript is a source; the reconciler decides what becomes durable knowledge.
16. Report real paths and real command output only. If transcription fails, preserve the audio and say so.
17. If the requested scope is confidential / intentionally absent from `~/.cockpit/memory/scopes.json`, do **not** silently ingest into a shared fallback scope. Ask or use an explicitly project-local, gitignored artifacts area. If `record.py` must be used for transcription and only registered scopes are available, treat the shared-scope output as temporary: immediately copy audio/transcript/note into the confidential project's gitignored storage, then delete the temporary Cockpit scope copies and report both the workaround and final real paths.
