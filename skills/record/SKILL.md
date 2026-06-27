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

Record live meeting audio, or ingest an existing audio file, into Cockpit-owned meeting artifacts and a searchable transcript source.

`record` is for live capture. `watch` remains the transcription/source-ingestion pipeline. The script handles the mechanical work; the agent writes the meeting note from the saved transcript.

## Storage

- Audio/state/notes live under `~/.cockpit/artifacts/meetings/<scope>/`.
- Transcript sources live under `~/.cockpit/memory/scopes/<scope>/sources/`, written by `watch.py`.
- Audio canonical format is `.opus`; export mp3 later only when needed.
- Meeting notes are concise operational artifacts, not full transcript duplicates.

Layout:

```text
~/.cockpit/artifacts/meetings/<scope>/
  recordings/<slug>.opus
  notes/<slug>.md
  state/current.json
~/.cockpit/memory/scopes/<scope>/sources/<date>-<slug>.md
```

## Procedure

### Live meeting

1. If the user did not provide a scope, ask with asktool/clarify. Do not silently default.
2. Start recording:
   ```bash
   uv run ~/.cockpit/skills/record/record.py start --scope <scope> [--title "short title"]
   ```
   - The script detects RUNNING Pulse/PipeWire sources using `pactl`.
   - If both mic and monitor are running, it mixes them.
   - If only one RUNNING source exists, it records that source.
   - If none are RUNNING, it stops and reports detected sources.
3. Tell the user: `Recording started. Say "meeting ended" when done.`
4. When the user says the meeting ended, stop and transcribe:
   ```bash
   uv run ~/.cockpit/skills/record/record.py stop
   ```
   The script prints JSON including `audio_path` and `transcript_path`.
5. If participants were not already provided, ask: `Who were the participants?`
6. Read the transcript source file. Write the meeting note yourself to:
   `~/.cockpit/artifacts/meetings/<scope>/notes/<slug>.md`
7. Report note path, audio path, transcript path, and one-line summary.

### Existing audio file

1. Ask for scope if omitted.
2. Ingest and transcribe:
   ```bash
   uv run ~/.cockpit/skills/record/record.py ingest /path/to/audio --scope <scope> [--title "short title"]
   ```
3. Ask for participants if missing.
4. Read the transcript and write the concise note.

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
transcript: "<absolute transcript source path>"
duration: "HH:MM:SS"
---

## Summary

## Action Items

## Key Decisions

## Open Questions / Follow-ups

## Source Links
- Audio: <absolute audio path>
- Transcript: <absolute transcript source path>
```

## Script commands

```bash
uv run ~/.cockpit/skills/record/record.py start --scope <scope> [--title <title>] [--force]
uv run ~/.cockpit/skills/record/record.py stop [--no-transcribe]
uv run ~/.cockpit/skills/record/record.py ingest <audio> --scope <scope> [--title <title>] [--no-transcribe]
uv run ~/.cockpit/skills/record/record.py status
uv run ~/.cockpit/skills/record/record.py scopes
```

## Rules

1. Use `record.py`; do not hand-roll ffmpeg/curl commands in chat.
2. Do not silently choose a scope. If `--scope` is missing and `COCKPIT_SCOPE` is unset, ask via asktool/clarify.
3. Store transcripts through `watch.py` in the scope's `sources/` layer.
4. Store audio/state/notes under `~/.cockpit/artifacts/meetings/<scope>/`.
5. Keep the full transcript in one home only: the transcript source file. Meeting notes link to it.
6. Ask for participants before writing the note if they were not provided.
7. Proceed with any RUNNING audio source. Mix multiple sources; stop only if no source is RUNNING.
8. Never use durable `meeting-tmp` filenames. Use timestamped slugs.
9. If a recording is active, refuse to start another unless the user explicitly chooses `--force`.
10. Do not read, print, or embed secrets. `watch.py` reads `GROQ_API_KEY` from `~/.cockpit/.env`.
11. Do not write canonical memory nodes. Raw transcript is a source; the reconciler decides what becomes durable knowledge.
12. Report real paths and real command output only. If transcription fails, preserve the audio and say so.
