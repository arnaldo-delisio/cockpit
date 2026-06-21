---
topic: Documentation architecture — how the cockpit records decisions, specs, and roadmap
decisions: [DOC-1]
status: locked
date: 2026-06-21
---

# Documentation Architecture: One Fact, One Home

## TL;DR

Four docs, each with one job and no overlap: **STATE.md** = roadmap/status, **DECISIONS.md** = locked decisions + why (terse ledger), **decisions/<topic>.md** = the deep analysis behind each meaty decision (the content goldmine), **DESIGN.md** (+ future siblings) = integrated spec of how a built system works, **log/** = chronological narrative. The global `~/CLAUDE.md` stays a thin single pointer to STATE; it does **not** carry the map's content.

## Context / The problem

STATE.md had drifted into doing three jobs at once — roadmap, decision-record, and research scratchpad — and hit 242 dense lines. Worse, the same facts had started to live in *two* places: STATE held memory decisions, and DESIGN.md held the same decisions, and the two had **diverged** (DESIGN.md still described NotebookLM weeks after we'd dropped it). That divergence is the real failure mode — not "too many docs," but "no fact has a single home."

A second need surfaced mid-consolidation: the decision *reasoning* (options weighed, pros/cons) is a **content-creation goldmine**, not just inventory. A terse ledger optimized for quick lookup actively destroys that value if it's the only home.

## The model

**One fact, one home** (the same single-source-of-truth doctrine we apply to memory, applied to our own docs):

| Doc | Owns | Shape |
|---|---|---|
| `STATE.md` | roadmap, build sequence, status, done, pending | terse, churns freely |
| `DECISIONS.md` | locked decisions: choice + why + rejected alternatives; open decisions | terse ledger, scannable, ID'd |
| `decisions/<topic>.md` | the full analysis behind a meaty decision: options, pros/cons, reasoning, sources | rich, narrative, one file = one content unit |
| `memory/DESIGN.md` (+ siblings) | integrated spec of how a system works | rich, current-state |
| `log/YYYY-MM.md` | what happened when | chronological, append-only |

Each references the others; none restate. A decision lands in DECISIONS.md first; STATE gets a one-line status pointer only if the roadmap moves; the deep reasoning goes in `decisions/<topic>.md`; the resulting system spec (if built) lives in DESIGN.md.

## Options considered

**Decision entry format — concise ledger vs full ADR.** Chose **concise** for DECISIONS.md (matches our terse style, cheapest to keep current). Full ADR-per-decision (Status/Context/Decision/Consequences/Alternatives) was rejected as too much ceremony for the ledger — *but* the analysis it would have captured wasn't thrown away: it moved to the `decisions/<topic>.md` layer instead.

**Where the deep analysis lives — inline vs split.** Chose **split**: terse DECISIONS.md index + per-topic analysis files.
- *Split (chosen):* each analysis file is self-contained and mineable into one content piece; the ledger stays scannable. Cost: more files, a little more filing per new decision.
- *One rich DECISIONS.md + TOC (rejected):* simpler (one file), but grows to 800+ lines and buries each topic in a wall of others — poor for grab-and-go content mining.
The deciding factor was the explicit goal that this be a content goldmine; split is the shape that's actually mineable.

**Whether to add a new doc at all (rejected alternative).** "Just trim STATE and push decisions into DESIGN.md" was considered and rejected: DESIGN.md is memory-specific, but operating-model + tooling-eval decisions are cross-cutting and have no design doc to live in. A dedicated DECISIONS.md is their home.

## The CLAUDE.md sub-decision

The global `~/CLAUDE.md` loads in **every** session in every project (Claude Code merges cwd→`/`, OM-6). So the document *map* and the "record decisions here" behavioral rule must NOT bloat it — that would be noise in unrelated project sessions. Resolution: `~/CLAUDE.md` stays a one-line pointer to STATE; the **map lives in STATE.md's header** (always read at cockpit cold-start); the **behavioral rule lives in the cockpit-working-rhythm memory** (cockpit-scoped). This honors "churn lives one level down, not in the file that loads everywhere" (BUILD-2).

## Nuances / open threads

- Not every decision earns an analysis file — only the meaty ones with weighed alternatives. Trivial decisions stay one-liners in the ledger.
- The analysis layer was back-filled from `git HEAD:STATE.md` (the pre-trim 242-line ledger), the log, and the Headroom research — nothing was lost in the trim because the rich source was committed.
- Risk to watch: the split model only works with discipline. If a decision changes, update DECISIONS.md (the home) and its analysis file; don't let STATE/DESIGN restate and re-diverge.

## Sources

- This build session, 2026-06-21 — the doc-consolidation discussion and decision.
- Precedent: the STATE↔DESIGN divergence that motivated it (DESIGN.md was stale on the retrieval engine).
