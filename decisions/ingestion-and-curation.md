---
topic: ingestion and curation — how sources enter the brain and how it stays current
decisions: [MEM-14, MEM-16, MEM-17, MEM-18, MEM-21, MEM-22]
status: locked
amended_by: MEM-23
date: 2026-06-21 (capture-is-dumb clarification + MEM-21/22 added 2026-06-22)
---

# Ingestion + Curation — Decision Analysis

> **Amended 2026-06-22 (MEM-23):** the `substrate` tag and vault routing below ("`sources/` beside its vault", "client→`vault/sources/`", "substrate tag immutable") are **retired** — capture stamps `scope` only (organization, not security); isolation moved to the VM boundary. The capture-is-dumb model, the three ingestion modes, the salience signals (MEM-22), and the no-fixed-taxonomy tagging (MEM-21) **stand**.

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

**Provenance/scope-aware** tagging happens at save time — **mechanical, from the input's origin + the session's scope, never by semantically judging the content** (consistent with capture-is-dumb, MEM-16, and mechanical-substrate, MEM-6): global-origin/public → `scopes/global/sources/` with `substrate:shared`; client-origin/confidential-scope → that scope's `vault/sources/`. The substrate tag is immutable — provenance is set at capture and cannot drift.

**Why no engagement gate?** Engagement metrics (view count, citation count, re-read rate) measure past usage, not future value. A source that has never been retrieved might be the most important context for a rare-but-critical question. Gating on engagement would produce a biased corpus that over-represents frequently-accessed topics and starves edge cases. Rejected.

---

## The dream / depth judgment

### How it works

The reconciler's nightly heavy distillation / synthesis pass — the "dream" — reads every new source since the last run, plus scope-appropriate logs, plus the shared graph. For each new source it makes a depth call:

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

The reconciler's nightly heavy distillation / synthesis pass ("dreaming") described above. Runs on new material only (bounded by last-run timestamp). Produces nodes, stubs, cross-links, conflict flags, pending-review suggestions. The human reviews the pending queue; accepted items become canonical. The dream doesn't block on human approval — it keeps running — but it doesn't auto-promote uncertain nodes either.

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

### Two "keyword" decisions, both resolved 2026-06-22

The 2026-06-21 log's "keyword taxonomy" thread turned out to be **two different questions**, both now decided. They're easy to conflate (both say "keyword") but point opposite directions: one is about *findability* (how nodes are labeled), the other about *attention* (what the reconciler should notice).

#### Tagging model — MEM-21 (about findability)

**Decision: free-form tags, reconciler-normalized into an emergent canonical vocabulary; no hand-authored fixed taxonomy.**

The instinct to "define the keywords up front" is over-engineering under our retrieval design:
- Semantic retrieval (AnythingLLM, MEM-15) finds by *meaning* — it doesn't need exact-match keywords.
- `cluster` membership (MEM-11) is *emergent* via community detection — not a pre-defined topic list.
- Wikilinks carry the relationships.

So a controlled vocabulary buys little and is brittle — every new domain breaks a fixed list. The one *real* need it gestures at is **tag coherence**: if every session invents its own label for the same idea, the graph fragments (sparse links, weak clusters). But that's solved by the reconciler — as single writer (MEM-8) doing self-improvement (§10), it **normalizes synonyms into a canonical vocabulary that grows with the graph**, rather than a human authoring a list. YAGNI on the taxonomy; coherence handled by the machinery we already have. Revisit only if retrieval measurably underperforms, or a downstream content-pipeline needs a curated vocab for its own reasons.

#### Salience signals — MEM-22 (about attention)

**Decision: capture emits cheap mechanical markers flagging high-value moments, so the reconciler prioritizes them — it still makes the keep/frame call; the markers just focus it.**

This is what makes "dumb capture + smart reconciler" robust: a smart reconciler *could* re-read every raw transcript with equal attention, but it might miss a one-line correction buried mid-session (the "always pin Sonnet on subagents" case). Salience signals are cheap anchors that say *look here*. Crucially, **detecting them is pattern-matching, not judgment** — so they don't reintroduce judgment-at-capture (MEM-16); they're like log levels (ERROR/WARN are cheap to emit, valuable to the smart consumer).

Four categories, **grounded in what Claude Code actually exposes** (verified against the hooks + transcript mechanism, 2026-06-22):

| Signal | Detection mechanism | Reliability |
|---|---|---|
| **Error / failure** | `tool_result.is_error: true` in the transcript; the `PostToolUseFailure` hook (`error_message`/`error_type`) | **Structural** — reliable (1,275 `is_error` instances found in local history) |
| **Keep** ("remember/note/important") | regex over verbatim user text (`UserPromptSubmit.prompt`; transcript `user.message.content`) | Mechanical |
| **Correction** ("no/wrong/actually/don't", re-instruction) | same — regex over user text | Mechanical (highest-value: behavioral lessons live here) |
| **Decision / approval** ("decided/approved/green") | same — regex over user text | Mechanical |

**Capture/detection points:** `Stop` (fires per-turn, reliable, carries `transcript_path`) + `PreCompact` (before context is lost) + `SessionEnd` (true boundary — but **bug #6428: doesn't fire on `/clear`**, so it's a backup, never the sole trigger).

**Limits (honest):** Claude Code does *not* structurally flag test failures (they're just text in tool output) or ESC interrupts (no confirmed record) — those stay best-effort, not guaranteed. And **affect-based** signals (frustration, tone) are *not* part of this mechanical layer — they belong to the richer **feedback-mining mode** (parked, above). MEM-22 is the cheap-and-reliable subset; feedback-mining is the smarter loop built later on top.

**Two tiers + explicit sentinels (decided 2026-06-22).** The signals split by confidence:
- **Tier 1 — explicit sentinels** the user types deliberately: **`#good`** (worth keeping / reinforce this) and **`#bad`** (wrong / behavioral lesson). These are the *highest-confidence* signal — a human verdict — and the cheapest possible to detect (exact string, no semantics). The choice is deliberately **collision-free**: natural words like "no", "wrong", "great" were rejected because the user uses them constantly in benign ways (high false-positive); `#good`/`#bad` appear *only* as signals. (The user floated "fuck"/"great" — same collision problem, so we moved to the hashtag form.)
- **Tier 2 — inferred:** the structural (`is_error`/`PostToolUseFailure`) + natural-language-regex signals in the table above. Best-effort, automatic, for when nothing was marked.

**The opt-in gap — now resolved.** Sentinels are opt-in, and the user *will* forget to mark things worth keeping. So **sentinel-absence must never be read as low-value**. Resolution: **`#good`/`#bad` are priority overrides, not gates** — they are reviewed first, never auto-promote on their own, and remain subject to reconciler judgment. The inferred tier remains active whether or not a sentinel was used. The reconciler's nightly heavy pass must also surface a small set of **unmarked-but-likely-salient** candidates as a periodic **"did I miss anything?"** sweep. That closes the forget-safety hole without making memory depend on perfect human marking.

**Cost connection.** The salience set (errors + `#good`/`#bad` + corrections + decisions) is also the **cost lever** for the dream: a cheap mechanical pass gathers only the flagged spans into a digest, and the expensive model judges the digest, never the raw firehose (DESIGN §8). So the signals serve quality *and* keep nightly-cron token cost bounded to flagged material.

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
| `DECISIONS.md` — MEM-21 | Tagging model: free-form, reconciler-normalized, no fixed taxonomy |
| `DECISIONS.md` — MEM-22 | Salience signals: mechanical capture-time markers → reconciler attention |
| Claude Code hooks + transcript research (2026-06-22, claude-code-guide agent) | Grounded the salience-signal mechanism: `is_error`/`PostToolUseFailure` for errors, `UserPromptSubmit.prompt`/transcript for user-text regex, `Stop`/`PreCompact`/`SessionEnd` triggers + bug #6428 |
