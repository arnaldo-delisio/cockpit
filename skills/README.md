# ~/.cockpit/skills/

Cross-brain shared skills — the subset both Claude Code (builder) and Hermes (operator) load from a single source of truth.

Hermes-only operational skills stay in `~/.hermes/skills/`. Project-specific skills stay in `~/projects/<project>/.claude/skills/`.

---

## Skill hierarchy

| Tier | Location | Scope | Brains |
|------|----------|-------|--------|
| Cross-brain shared | `~/.cockpit/skills/` | Global | Both |
| Hermes native | `~/.hermes/skills/` | Global | Hermes only |
| Project-specific | `~/projects/<p>/.claude/skills/` | Project | Claude Code only |

Hermes has no per-project skill scoping — project context switches via SOUL.md sections.

---

## How each brain loads these skills

**Hermes:** add to `~/.hermes/config.yaml`:
```yaml
skills:
  external_dirs:
    - ~/.cockpit/skills
```

**Claude Code:** SessionStart hook symlinks `~/.cockpit/skills/*` → `~/.claude/skills/` on each session start. Hook defined in `~/.claude/settings.json`.

Build gate: run `hermes update` before wiring either side.

---

## Skill file structure

```
~/.cockpit/skills/<name>/
  SKILL.md        ← instructions (what both brains read)
  <script>.py     ← supporting script if needed
```

## SKILL.md format

```markdown
---
name: slug
version: 1.0.0
model: sonnet|haiku|opus|deepseek-v4-flash|…
triggers: [phrase1, phrase2]
tags: [tag1, tag2]
---

## Purpose
One line.

## Procedure
Step-by-step. Each brain executes what applies to it.

## Rules
1. Numbered behavioral imperatives.
2. Hard cap: 10–15 entries. No timestamps.
3. Reconciler-only promotion until reconciler is built.
```

`## Rules` accumulates per-run lessons via the reconciler (staging-first). Static/human-curated until reconciler exists. Bloat hits Claude Code harder (full file loads as prompt) — enforce the cap.

---

## Skills in this directory

| Skill | Status | Replaces |
|-------|--------|---------|
| `watch/` | **live** (2026-06-22) — both brains verified | `~/.claude/skills/youtube-extract/` (retire) |
| `grill-me/` | spec locked, build pending | — |

Full specs in `~/.cockpit/STATE.md` → Skills section.
