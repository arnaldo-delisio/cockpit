---
topic: ingestion and curation — how sources enter the brain and how it stays current
decisions: [MEM-14, MEM-16, MEM-17, MEM-18]
status: locked
date: 2026-06-21
---

# Ingestion + Curation — Decision Analysis

## TL;DR

Everything captured gets saved first, judged second. A raw `sources/` layer holds verbatim inputs per scope; a nightly "dream" reads them and decides depth — full node, stub, or leave-raw — using comprehension, not a metric. Memory is freely mutable and git is the only undo mechanism needed; tombstones and scheduled garbage collection were explicitly rejected. Three ingestion modes cover the full surface: on-demand RAG, proactive dreaming, and active elicitation ("grill me"). Volatile data is pointed to, not absorbed.

---

## Context / the problem

A self-growing knowledge graph has two failure modes: it never fills up (low capture) or it rots (no curation). The first is solved by removing friction from capture. The second is harder — you need a mechanism that stays current without human micromanagement, that doesn't accumulate ceremony, and that doesn't thrash when signal is ambiguous.

The design problem: how do you let anything in without letting garbage in? How do you keep the graph honest as the world changes? How do you age out stale nodes without destroying revisability?

The naive answers — gate on engagement metrics, run scheduled GC passes, mark dead nodes with tombstones — all turned out to be wrong. The session on 2026-06-21 worked through several reversals before landing the design below.

---

## The capture layer (`sources/`)

### What it is

Each scope gets a `sources/` directory beside its vault. Everything that enters the system lands here first: verbatim, frontmattered, search-indexed. This is the Karpathy "read-only sources" pattern — a holding area that is always queryable but not yet part of the canonical knowledge graph.

Files are frontmattered (title, date, scope, substrate) so the search index can retrieve them without reading the full content. Nothing is ever invisible: even unprocessed inputs show up in search.

### Capture = intent, no engagement gate

**The key rule: saving to `sources/` requires no threshold to cross.** If the user or a hook saves something, it goes in. The `/watch` command (which previously had its own "save this" spec) collapses into this: it autosaves here, no explicit confirmation required.

Content-aware tagging happens at save time: public material goes to `scopes/global/sources/` with `substrate:shared`; confidential material goes to that scope's `vault/sources/`. The substrate tag is immutable — provenance is set at capture and cannot drift.

**Why no engagement gate?** Engagement metrics (view count, citation count, re-read rate) measure past usage, not future value. A source that has never been retrieved might be the most important context for a rare-but-critical question. Gating on engagement would produce a biased corpus that over-represents frequently-accessed topics and starves edge cases. Rejected.

---

## The dream / depth judgment

### How it works

A nightly cron agent — the "dream" — reads every new source since the last run, plus scope-appropriate logs, plus the shared graph. For each new source it makes a depth call:

- **Full cross-linked node** — the source is dense enough to earn a permanent graph node with edges to related concepts.
- **One-line stub** — worth indexing minimally; not enough substance for a full node yet.
- **Leave-in-raw** — keep in `sources/`, don't promote. Re-evaluate next run.

The filter is comprehension, not a metric. The dream reads the material and decides whether it understands something worth encoding. A wrong call self-corrects: if something left in raw later becomes relevant, a search will find it and the next run can promote it.

### Trust and flow

Dream output is tagged `source=dreaming` at **lower trust rank** than directly authored nodes. Novel suggestions go to a **pending-review queue**, not straight to canonical. This preserves human oversight on net-new knowledge without blocking the overnight run.

The dream also cross-links (finding relationships across the graph), surfaces conflict flags, and emits a per-run audit diff: added / modified / deleted / held + reason codes, human-readable digest on demand.

A hard token budget and new-node ceiling apply per run — the dream cannot unboundedly expand the graph in a single night.

### Model routing for the dream (OM-5)

Judgment work — triage, distill, cross-link, conflict detection — runs on **Sonnet minimum, Opus for hard calls**. Haiku does plumbing only: git operations, dedup-by-hash, mark-consumed. This is not a cost optimization as a primary goal; it's a correctness requirement. Haiku does not understand well enough to make depth judgments (validated by direct experience; Jack's own system uses Opus 4.8 to index). The dream runs nightly on new-only material, so the Opus budget is affordable.

---

## Freely mutable + git as undo (the tombstone reversal)

### What was decided

Memory is freely mutable. Merge, rewrite, supersede, delete — all are normal curation operations, no special ceremony. **Git is the undo mechanism.** Every change is committed; full history is always recoverable; rollback requires a single git command.

There is no scheduled space-GC. Storage is cheap; the cost of a false deletion (losing something that matters) is high; therefore, don't schedule deletions. GC happens when the reconciler judges it appropriate, with a **hard character-cap backstop** as a mechanical safety valve: if a node exceeds its character ceiling, summarization is forced regardless of whether the reconciler has run. Session-anchor flags mark throwaway one-offs for early cleanup.

Two tools exist for removing live nodes:
- **Supersede** — keep the node, mark it not-current, stays searchable. The old version survives in the graph at lower rank.
- **Delete** — drop from the live graph. Git retains history.

### Before (what DESIGN.md §10 originally said)

The earlier design in `DESIGN.md §10` specified **tombstone markers** on deleted nodes — a status-tier ceremony where nodes moved through states (active → deprecated → tombstoned) before disappearing. This implied a GC scheduler that would periodically sweep tombstoned nodes.

### After (what was rejected and why)

The tombstone ceremony was rejected during the 2026-06-21 design session. The reasoning:

1. **Git already provides reversibility.** A tombstone's only job is to say "this used to exist; here's when it was retired." Git's commit history does this without any in-graph metadata.
2. **Status tiers add read-noise.** Every search query has to filter out tombstoned nodes. The graph becomes cluttered with artifacts of past curation, not living knowledge.
3. **Scheduled GC is premature commitment.** A GC schedule locks in a deletion aggressiveness policy before you know what the right policy is. The decision of how aggressively to prune is deferred deliberately (see open threads below).
4. **Storage is not the constraint.** The original motivation for tombstones was eventual space reclamation. At the scale of a personal knowledge graph, this is not a real constraint. Correctness is.

**MEM-14 supersedes `DESIGN.md §10`'s tombstone language.** The DESIGN.md file retains the tombstone text as a record of what was considered; MEM-14 is the operative decision.

---

## The three ingestion modes (MEM-17)

### 1. On-demand RAG

Pull at query time. No pre-processing required. The `sources/` layer is always search-indexed, so anything captured is immediately queryable even before the dream has processed it. This is the baseline — it requires no infrastructure beyond the capture layer and the search index.

### 2. Proactive dreaming

The nightly cron agent described above. Runs on new material only (bounded by last-run timestamp). Produces nodes, stubs, cross-links, conflict flags, pending-review suggestions. The human reviews the pending queue; accepted items become canonical. The dream doesn't block on human approval — it keeps running — but it doesn't auto-promote uncertain nodes either.

This mode is what keeps the graph current without requiring the human to explicitly curate every ingested source.

### 3. Active elicitation ("grill me")

Pulls tacit knowledge out of the human into the identity/knowledge layer via **one-question-at-a-time interviewing**. The system recommends an answer per question (drawing on existing graph context); the human confirms, corrects, or elaborates. Results flow into nodes and open-flags; ambiguous answers escalate to human review rather than being auto-resolved.

This mode addresses a gap the other two cannot: knowledge that exists in the human's head but has never been written down anywhere for the system to capture.

---

## Evergreen vs ephemeral (MEM-18)

Not all information should be ingested into the graph. The split:

- **Evergreen / stable distilled knowledge** → graph nodes. Examples: frameworks, principles, skills, preferences, relationship context, decisions.
- **Volatile / live data** → **pointed to, not ingested**. Examples: current project state, meeting notes, real-time status boards.

Volatile data ingested into the graph would make the graph stale as soon as the world moves. Instead, the graph holds a pointer to the live source. The dream does not promote volatile sources to full nodes; they stay in `sources/` or are referenced by a stub with a link.

Log files sit at the boundary: they are chronological sources that the reconciler distills nightly into graph nodes (MEM-16). Raw log entries are volatile; the distilled lessons are evergreen.

---

## Rejected / reversed

| What | Why rejected |
|---|---|
| Engagement-meter gating (view count, citation rate as promote/prune signal) | Measures past access, not future value; biases toward frequently-used topics, starves edge cases |
| Tombstone ceremony (active → deprecated → tombstoned status tiers) | Git already provides reversibility and history; status tiers add read-noise without adding safety |
| Scheduled space-GC | Premature commitment to a deletion aggressiveness policy; storage is not the constraint; correctness is |
| "Save this" explicit gate on `/watch` | Capture = intent; removing the gate is the whole point of the sources layer |

---

## Nuances, caveats, open threads

### Deletion aggressiveness deferred (OPEN-2)

The decision to offer two tools (supersede vs delete) deliberately does not specify when to use which. How aggressively to delete vs supersede is a **runtime policy**, not an architecture decision. It cannot be correctly set before the system is built and run — the right answer depends on how the graph actually grows, what the false-positive cost of deletion turns out to be, and user preference. This is explicitly deferred and blocks nothing.

_Note: the 2026-06-21 session log records that the user was confused on this point; the resolution was that it genuinely cannot be decided yet — not that it was forgotten._

### Feedback-mining ingestion mode — parked

A fourth ingestion mode was discussed but not built: **feedback mining** — mining session transcripts for affect signals and structural patterns (what worked, what confused, what the human pushed back on) and converting these into behavioral lessons for the system, human-gated. This would close the loop between how the system behaves and how the human actually responds.

Parked because: it is off the critical path; the core capture→dream→graph pipeline should be built and validated first; and a candidate tool (Headroom's `learn` command) exists but has open security issues that need re-checking before use (cross-origin data disclosure vulnerability #1227 per the evaluation in TOOL-2).

### Keyword taxonomy co-evolution

The 2026-06-21 log entry references "keyword taxonomy co-evolution" as a related thread that was captured but not fully resolved in that session. This appears adjacent to the content-aware tagging at capture time. Status uncertain — not enough in the committed docs to characterize further.

---

## Sources

| Source | What it contributed |
|---|---|
| `DECISIONS.md` — MEM-14 | Canonical decision text: sources layer, capture=intent, dream, freely mutable, rejections |
| `DECISIONS.md` — MEM-16 | Logging automatic via hooks; log files = source layer feeding the graph |
| `DECISIONS.md` — MEM-17 | Three ingestion modes: on-demand RAG, dreaming, grill-me |
| `DECISIONS.md` — MEM-18 | Evergreen vs ephemeral; volatile data pointed-to not ingested |
| `DECISIONS.md` — TOOL-2 | Headroom rejection; feedback-mining (`learn`) parked |
| `DECISIONS.md` — OM-5 | Model routing policy: Opus/Sonnet judgment, Haiku plumbing |
| `memory/DESIGN.md` §8 | Full ingestion section: capture layer, three modes, dream mechanics, model routing detail |
| `memory/DESIGN.md` §10 | Self-improvement + GC: character-cap backstop, supersede vs delete, OPEN-2 |
| `log/2026-06.md` — 2026-06-21 entry | Narrative of the design session: reversals, tombstone rejection reasoning, deletion aggressiveness deferral, user quotes validating Haiku routing, parked feedback mining |
| `STATE.md` — INGESTION + CURATION MODEL — DECIDED | Top-level lock confirmation and cross-references |
