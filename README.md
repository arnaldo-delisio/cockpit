# cockpit

A personal operating system for two AI brains — Claude Code (builder) and Hermes (operator) — coordinated through a shared memory graph and a skills layer. No master agent.

---

## Architecture

Two brains, one memory substrate, one shared board.

**Claude Code** is the builder — writes code, builds systems, makes architectural decisions. One instance, singular.

**Hermes** is the operator — a class of capability agents (content, research, job-applications, ops) running against live scopes.

They coordinate via the shared graph and a human-visible board. Neither orchestrates the other.

---

## What's in this repo

The system — engine code, specs, decision ledger, skills. Your data (identity, distilled knowledge, logs) lives in a separate private git repo that `bootstrap.mjs` seeds on a fresh clone.

| Public (this repo) | Private (your data) |
|---|---|
| `memory-engine/` — capture, reconcile, retrieval, projection, recall | `memory/scopes/` — identity, logs, staging, sources |
| `memory-engine/DESIGN.md` — canonical architecture spec | `memory/knowledge/` — node pool, INDEX |
| `DECISIONS.md` + `decisions/` — decision ledger + full-reasoning deep dives | |
| `skills/` — cross-brain shared skills | |
| `shells/` — builder and operator shell skeletons | |
| `memory-engine/bootstrap.mjs`, `bootstrap.sh` — clone-clean setup | |

---

## Memory engine

A full read/write loop: both brains capture → nightly reconciler distills → behavioral rules project into always-loaded shells → relevant nodes recall into live sessions automatically.

**Capture** — Claude Code's `Stop`/`PreCompact`/`SessionEnd` hooks and Hermes's `on_session_end` hook append near-raw turn data to a session-anchored staging inbox. Append-only, each brain owns its lane. Scope-gated: unmapped sessions skip silently.

**Reconcile** — A single reconciler (`reconcile.mjs`) is the sole writer of canonical nodes. Two tempos:
- *On-demand*: light bookkeeping pass after capture
- *Nightly*: full distillation pass via systemd user timer (`dream.sh`, 04:00 local; `Persistent=true` for laptops). Per-scope fingerprint skips idle scopes at zero model cost.

Pipeline: distill staging into candidate nodes → consolidate against the existing pool (fold paraphrases, merge restatements, surface contradictions) → instability guard → two-phase commit to the private memory repo.

The reconciler is brain-neutral by construction: it runs from a dedicated isolated home (`~/.cache/cockpit-reconciler`) with its own git root and a neutral identity shell — no CLAUDE.md in ancestry, no memory hooks, no cwd context leak. Model calls default to `hermes -z` (Codex OAuth, in-plan); a `claude -p` adapter is a one-file swap via `JUDGE_ADAPTER=claude`.

**Retrieval** — Minimal in-process Node.js stack: `all-MiniLM-L6-v2` ONNX embeddings (local, zero-network) + brute-force cosine + ripgrep + RRF fusion. No server, no daemon, no third-party retrieval path. Required in-process by the reconciler; swappable cache over owned markdown.

**Projection** — The reconciler promotes high-centrality behavioral nodes into scope-routed always-loaded shell files (`shells/CLAUDE.md` for the builder, `shells/SOUL.md` for the operator). Three-layer fence: hand-authored skeleton (never touched by the reconciler), durable rules (auto-graduated after 3 consecutive reconciles), emerging rules (volatile, sticky). Capped at 12 rules per scope per audience.

**Recall** — Ambient, read-only recall injects relevant nodes into live sessions automatically. Two-tier trigger: cheap per-turn gate (no model load) fires a cosine pull only when it trips (scope resolves + ≥3 significant terms + ≥1 ripgrep candidate). Precision floor: cosine ≥ 0.35. Budget: ≤4 nodes, titles and one-liners. Deduplicated against the always-loaded fence and a per-session cursor. Claude Code: `UserPromptSubmit → additionalContext`. Hermes: `pre_llm_call → context`.

**Active elicitation** — The `grill-me` skill interviews the operator one question at a time to surface tacit knowledge. Output: staging entries + open flags (unanswered questions) routed to the human-escalation queue.

---

## DECISIONS.md

`DECISIONS.md` is the anti-re-litigation ledger — every architectural choice with its rationale, rejected alternatives, and a status (`Locked` / `Superseded` / `Open`). Entries are superseded in place, never deleted, so the reasoning trail is preserved.

Meaty decisions have a full-reasoning companion in `decisions/<topic>.md` — options weighed, trade-offs spelled out, sources cited. Topics: operating model, model routing and cost, memory architecture, VM isolation strategy, retrieval engine, CLAUDE.md projection, ingestion and curation, open-sourcing strategy, and more.

---

## Skills

`skills/` contains cross-brain shared skills — both Claude Code and Hermes load from the same source of truth. Each skill is a directory with a `SKILL.md` (instructions for both brains) and optional supporting scripts.

**Live:**
- `watch/` — transcribe local media, YouTube, or any yt-dlp URL; autosaves to the scope's `sources/` layer
- `grill-me/` — one-question-at-a-time knowledge elicitation; writes to staging, never directly to the graph

Hermes loads skills via `external_dirs` in `~/.hermes/config.yaml`. Claude Code loads them via a `SessionStart` hook that symlinks `~/.cockpit/skills/*` into `~/.claude/skills/`.

---

## Getting started

**Prerequisites**

- Linux (systemd user timer) or macOS 10.15+ (launchd user agent) — for the nightly dreaming pass
- Claude Code subscription (builder brain)
- Hermes subscription (operator brain; the reconciler defaults to `hermes -z` for model calls — if you're currently using OpenClaw, Hermes is the better fit here: its shell lifecycle hooks are what make capture and recall work)
- Node.js 20+
- Python + `uv` (for the `watch` skill; optional)

No API key needed — both model adapters route through subscription-based CLIs.

**1. Clone**

```sh
git clone https://github.com/arnaldo-delisio/cockpit ~/.cockpit
cd ~/.cockpit/memory-engine
npm install
```

**2. Declare your scopes**

Scopes map to the areas of your life/work you want the memory engine to track. Create `~/.cockpit/memory/scopes.json` (the reconciler reads this file; `bootstrap.mjs` defaults to `['global', 'cockpit']` if absent):

```json
["global", "cockpit", "content", "job-search"]
```

Add any scope name that corresponds to a project, venture, or area. You can add more later — `bootstrap.mjs` is idempotent.

**3. Seed the data tree**

```sh
node bootstrap.mjs
```

Creates the gitignored `memory/` directory tree: `knowledge/nodes/`, `knowledge/INDEX.md`, and per-scope `identity/`, `log/`, `staging/`, `sources/` directories. Also seeds a `demo` scope with pre-built staging and a node so you can smoke-test the full pipeline without real data.

**4. Initialize the private memory repo**

The reconciler commits to `memory/` as its own standalone git repo. Initialize it:

```sh
git -C ~/.cockpit/memory init
```

This repo stays local by default. Add a remote and push when you want an off-machine backup.

**5. Wire the out-of-repo system**

```sh
bash bootstrap.sh
```

This installs:
- `~/CLAUDE.md` — thin `@`-import loader for `shells/CLAUDE.md` (the versioned builder shell)
- `~/SOUL.md` — signpost file
- `~/.hermes/SOUL.md` → `shells/SOUL.md` symlink (how Hermes loads the operator shell)
- Capture and recall hooks in `~/.claude/settings.json` (`Stop`/`PreCompact`/`SessionEnd` → `capture.mjs`; `UserPromptSubmit` → `recall-hook.mjs`)
- `cockpit-reconcile.{service,timer}` systemd user units (nightly dreaming at 04:00 local, persistent for laptops)

Use `bash bootstrap.sh --install-only` to write the units without enabling them yet.

**6. Wire Hermes manually**

Two things `bootstrap.sh` does not handle yet — add them to `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - ~/.cockpit/skills          # loads cross-brain shared skills

hooks:
  on_session_end:
    - node /home/<you>/.cockpit/memory-engine/hermes-capture.mjs   # capture hook
  pre_llm_call:
    - node /home/<you>/.cockpit/memory-engine/recall-hermes.mjs    # recall hook
```

Use absolute paths — `~/` does not expand reliably in hook commands.

**7. Add projects**

All projects live under `~/projects/<name>/`. Each project needs a `CLAUDE.md` that tells the memory engine which scope it belongs to:

```
~/projects/my-project/CLAUDE.md
```

```markdown
<!-- Memory scope → ~/.cockpit/memory/scopes/my-project/ -->
@.cockpit/memory/scopes/my-project/CLAUDE.md
```

Add `my-project` to `memory/scopes.json` and re-run `node bootstrap.mjs` to materialize its scope directories.

**8. Smoke test**

The `demo` scope is pre-seeded with staging and a node. Verify the full pipeline:

```sh
# Run the reconciler over the demo scope (distill → consolidate → project)
node reconcile.mjs --scope demo

# Verify recall works
node recall.mjs --prompt "should I dry-run scripts before running them?" --scope demo
```

A successful run commits one or two nodes to `memory/` and prints an audit diff. Recall should return the pre-seeded node about dry-run safety.

---

## License

MIT — see [LICENSE](LICENSE).
