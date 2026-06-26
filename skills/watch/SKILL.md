---
name: watch
description: Capture a transcript from a local media file, a YouTube link, or any yt-dlp-supported URL, and autosave it to the scope's sources/ layer. Use when the user wants to transcribe, summarize, or pull the content out of a video/audio/podcast.
version: 1.0.0
model: sonnet
triggers: [watch, transcribe, transcript of, summarize this video, pull the transcript]
tags: [ingestion, transcription, media, sources]
allowed-tools: Bash Read
metadata:
  hermes:
    tags: [ingestion, transcription, media]
    platforms: [linux, macos]
prerequisites:
  commands: [uv, ffmpeg]
---

## Purpose
Turn a video/audio source into an owned, frontmattered transcript in the memory `sources/` layer — the cheapest way first (free captions), Groq Whisper only when needed.

## Procedure
1. Run the worker (it routes the source itself):
   ```
   uv run ~/.cockpit/skills/watch/watch.py "<INPUT>" [--scope <scope>] [--visual] [--no-save]
   ```
   - `<INPUT>` = a local file path, a YouTube link, or any yt-dlp-supported URL.
   - `--scope` defaults to `cockpit`; set it to the active scope (e.g. `content`, `job-search`).
   - `--visual` also extracts scene-change keyframes (off by default — only when visuals matter).
   - `--no-save` prints the transcript instead of writing a source file (quick look).
2. The script prints `saved: <path>`. Read that file if the user wants the transcript inline or a summary.
3. For a summary/answer, summarize from the saved transcript — don't re-fetch.
4. If the transcript contains workflow/doctrine relevant to Cockpit/agent operation, do a grounding pass before presenting a lesson as new: distinguish (a) already-built cockpit mechanism, (b) partial/open gap, and (c) genuinely new idea. Prefer concise `saved path → takeaways → cockpit relevance/gap` output.

## Routing (handled by the script, cheapest first)
- **Local media file** → ffmpeg → Groq Whisper (`GROQ_API_KEY`).
- **YouTube / URL** → yt-dlp captions (free) → Supadata fallback (`SUPADATA_API_KEY`) → yt-dlp audio → Groq Whisper.
- Keys are read from `~/.cockpit/.env` (gitignored). Missing `GROQ_API_KEY` only disables the audio tier; captions still work.

## References
- `references/agentic-engineering-google-video.md` — condensed notes from a Google/AI-SDLC video and the Cockpit mapping pattern: harness lessons should be checked against existing mechanisms/open gaps before being called new.
- `references/nate-claude-code-business-partner-video.md` — condensed notes from a Nate/Claude Code workflow video and the Cockpit mapping pattern: translate business/productivity advice into outcome-before-output, verified-done, context-handoff, and subagent/goal-loop guidance.

## Rules
1. Never paste a full raw transcript into chat unasked — save it, then point to the path or summarize.
2. Default to no `--visual`; frames cost bandwidth + disk and most asks are text-only.
3. Pick `--scope` from the session's actual context; don't dump everything into `cockpit`.
4. The transcript file is raw capture (MEM-14) — leave `concepts/people/products` empty for the reconciler; don't hand-fill.
5. On a Groq/Cloudflare 403, it's the User-Agent, not the key — the script already sets one; don't strip it.
6. Don't add per-site special-casing (Loom/Zoom) or local Whisper — out of scope by decision.
