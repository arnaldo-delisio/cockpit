# Cockpit DECISIONS — Decision Ledger

Durable record of **what we chose and why** — the anti-re-litigation doc. If a choice
is settled, it lives here (not in STATE, not buried in the log).

**One fact, one home.** A decision (choice + why + rejected alternatives) lives here only.
`STATE.md` = roadmap/status (links here). `memory/DESIGN.md` (+ future siblings) = integrated
spec of how a system works. `log/` = chronological narrative. Each references this; none restate it.

**Format:** concise. `ID · title [Status date]` → Decision / Why / Rejected (if any) / Depth link.
**Status:** Locked · Superseded by <ID> · Open (in the Open Decisions section).
**Editing:** supersede in place (keep the trail), don't delete. New decision → append + add a one-line
status pointer in STATE if it changes the roadmap.

**Deep analysis (the goldmine).** Meaty decisions have a full-reasoning companion in `decisions/<topic>.md` —
options weighed, pros/cons, sources; written to double as content-creation raw material. New meaty decision →
add an analysis file + a row here. Map:

| Analysis file | Covers |
|---|---|
| `decisions/operating-model.md` | OM-1,2,3,4,6 |
| `decisions/model-routing-and-cost.md` | OM-5 · MR-1 · TOOL-3 |
| `decisions/memory-architecture.md` | MEM-1,2,8,9,10,11 |
| `decisions/walling.md` | MEM-3,4,5,6,7 |
| `decisions/path-topology.md` | MEM-13 |
| `decisions/ingestion-and-curation.md` | MEM-14,16,17,18 |
| `decisions/retrieval-engine.md` | MEM-15 · TOOL-1 |
| `decisions/headroom-eval.md` | TOOL-2 |
| `decisions/doc-architecture.md` | DOC-1 |

---

## Operating model

### OM-1 · Builder + operator fleet, no master agent  [Locked 2026-06-18]
**Decision:** Claude Code = singular builder/engineer; Hermes = a *class* of operator/capability-agents (content, job-apps, ops…). They coordinate via shared memory + a shared board + the human — **no master conductor agent** (peers, stigmergic).
**Why:** avoids a single point of orchestration failure; matches the two-substrate reality (build vs operate).

### OM-2 · Two thin global shells  [Locked 2026-06-18]
**Decision:** `~/CLAUDE.md` (builder) + `~/SOUL.md` (Hermes operator) at `~`. Infra only, not "personal."
**Why:** `~/CLAUDE.md` merges cwd→`/` and loads in every session — it must be owned and thin, not avoided.

### OM-3 · Identity is per-context, never global  [Locked 2026-06-18]
**Decision:** every real identity (boringscale, personal, each client) is a scoped project; the global files are the *operator's* meta-identity, not any context's.
**Depth:** memory/DESIGN.md §3.

### OM-4 · Skills, not docs-about-skills  [Locked 2026-06-18]
**Decision:** doctrine lives inside each `SKILL.md`; no parallel architecture doc per capability.

### OM-5 · Model-routing policy (heuristic)  [Locked 2026-06-19]
**Decision:** Opus = orchestrator/control-plane (judgment, planning, synthesis — inline). Sonnet = execution (research, bulk, fan-out, routine edits). Haiku = mechanical (git plumbing, transforms). Skill-level model binding is the mechanism.
**Why:** keeps Opus context clean; buys parallelism/cost. **Heuristic not dogma** — trivial edits + Opus-level reasoning stay inline (spawn overhead). Mechanism (the router) = its own dive → see OPEN-6.

### OM-6 · Own the global CLAUDE.md, don't avoid it  [Locked 2026-06-18]
**Decision:** the global `~/CLAUDE.md` is owned + kept deliberately thin, treated as a design input rather than fought.
**Why:** Claude Code merges every `CLAUDE.md` from cwd→`/` — you cannot hide from it, and the merge isn't configurable. The only stable answer is to own the file and keep it additive-not-contaminating (skeleton mechanics → BUILD-2). **Depth:** decisions/operating-model.md.

### OM-7 · Project / context placement  [Locked 2026-06-20]
**Decision:** all contexts live under one projects root — `~/projects/<context>` — including the personal agent (`~/projects/personal`). boringscale stays flat (`~/projects/boringscale`).
**Why:** one projects root = uniform scoping + auto-load; a separate `~/personal` bought nothing. The clients/ventures sub-split is deferred to re-onboarding time (→ OPEN-7).

---

## Memory architecture

### MEM-1 · Graph, not tree  [Locked 2026-06-19]
**Decision:** knowledge is a unified cross-linked self-improving graph, retrieved by search + wikilinks, not by folder path.
**Why:** knowledge isn't codebase-shaped; a folder tree traps cross-domain links. **Depth:** DESIGN.md §2.

### MEM-2 · Two axes: TYPE × SCOPE  [Locked 2026-06-19, hardened 06-19pm]
**Decision:** index memory on TYPE (identity / knowledge / log) × SCOPE (global · per-venture · per-client · personal; projects nest in a scope). "Vault" is **not** a type — it's the confidential *cells* of a scope.
**Why:** conflating the axes was the original modeling error. **Depth:** DESIGN.md §3.

### MEM-3 · Knowledge flows, client data is walled  [Locked 2026-06-19]
**Decision:** general know-how cross-pollinates freely across the graph; confidential client data is walled. "No-leak" applies to *confidential data*, not to learned knowledge.

### MEM-4 · Walling = split substrate  [Locked 2026-06-19]
**Decision:** shared knowledge graph + per-client local vaults.
**Rejected:** (a) separate sub-graphs per client (traps knowledge); (b) single graph + sensitivity-tag gating (one wrong gate = leak).

### MEM-5 · Walling read-side = keys not prompts  [Locked 2026-06-19]
**Decision:** access enforced by OS file permissions + scoped credentials, never prompt discipline. An agent bound to client-A lacks path/key access to client-B; subagents inherit reduced scope.
**Depth:** DESIGN.md §6.

### MEM-6 · Walling write-side = substrate-provenance tag  [Locked 2026-06-19pm]
**Decision:** an immutable `substrate` tag (`shared` | `vault:<scope>`) is stamped on every log/staging/node entry at the **write-API boundary**. Reconciler hard-rejects vault-tagged material from the shared graph; cross-substrate promotion forbidden.
**Why:** keys-not-prompts secured only *reads*; this closes the 5 write-path leak paths. **Depth:** DESIGN.md §6.

### MEM-7 · Permission source-of-truth invariant  [Locked 2026-06-19pm]
**Decision:** ONE ground-truth permission source (shared drive / OAuth); the local scope cache is a **read-only mirror** of it. Lose source access to a client → its memories stop pulling automatically.

### MEM-8 · Write-safety = append-only staging + single-writer reconciler  [Locked 2026-06-19]
**Decision:** agents never write canonical nodes — they append to a session-anchored staging inbox (own lane, no collisions). ONE reconciler is sole writer: reads staging → fact-check → cross-link → rewrite → GC. Git underneath.
**Why:** unifies write-safety + self-improvement into one component; single-writer-for-memory is infra, not an orchestration master. **Depth:** DESIGN.md §5.

### MEM-9 · Reconciler operational contract  [Locked 2026-06-19pm]
**Decision:** conflict precedence = source-trust → recency → human-escalation; two-phase commit (write+commit, then mark staging consumed); lockfile fencing; instability guard (hold rewrite for human review on citation-drop / centrality-delta / cluster-flip); `fact` needs a citation else auto-downgrade to `inference`; soul.md mutations route through staging→reconciler.
**Depth:** DESIGN.md §5.

### MEM-10 · Store of record = owned distilled wikilinked markdown + git  [Locked 2026-06-19]
**Decision:** the brain is markdown we own + git (history/rollback/audit), local-first. No cloud DB (no Turso) as store of record. The retrieval engine is a swappable cache *on top*.
**Why:** ownership + portability + git reversibility; engine stays swappable. **Depth:** DESIGN.md §4.

### MEM-11 · Node schema  [Locked 2026-06-19pm]
**Decision:** each node carries `type · fact|inference · centrality · cluster · sensitivity · substrate · scope · schema_version`. Retrieval favors high-centrality; community detection shrinks search space.
**Depth:** DESIGN.md §4.

### MEM-12 · Git plumbing = Haiku; judgment escalates  [Locked 2026-06-19]
**Decision:** add/commit/push/snapshot = Haiku tier; real conflict / history repair / rollback decisions escalate to Sonnet/Opus (rare by design — single-writer + append-only ⇒ ~no conflicts). Git-doing Haiku inherits scope binding.

### MEM-13 · Path topology  [Locked 2026-06-20]
**Decision:** (a) knowledge graph = ONE flat pool `~/.cockpit/memory/knowledge/nodes/`, scope = node frontmatter (a master-index sits *over* the pool); (b) memory substrate = **centralized** `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,vault,sources}/`; (c) each project's co-located auto-loaded `CLAUDE.md` carries a one-line pointer to its scope; (d) project nav docs co-located with the repo.
**Why:** memory is hook-written / reconciler-read, never navigated, so co-location buys nothing here; one home ⇒ simpler single-writer + one gitignored vault tree we own. **Vault rule [Locked]:** local-only + gitignored, never in a tree with a push remote.

### MEM-14 · Ingestion + curation model  [Locked 2026-06-21]
**Decision:** `sources/` = raw capture layer per scope (verbatim, frontmattered, search-indexed). **Capture = intent, no engagement gate** — everything autosaves, content-aware scope/substrate tagging. The nightly **dream judges depth** by reading (full node / stub / leave-raw), self-correcting via re-search. Memory is **freely mutable; git is the undo** — no tombstone/status-tier ceremony, no scheduled space-GC.
**Rejected:** engagement-meter gating; GC tombstone ceremony (git already gives reversibility). **Supersedes** DESIGN.md §10's tombstone language.

### MEM-15 · Retrieval engine = AnythingLLM (local), for both layers  [Locked 2026-06-21]
**Decision:** ONE local engine (AnythingLLM) does semantic retrieval over the owned markdown for **both** shared graph + vaults. context-mode = **session hygiene only**, never a store of record. **New graph starts clean — no legacy memory migrated** (all auto-learned memory was made under the old setup → untrusted; only deliberate hand-authored notes carry forward by hand).
**Why:** native zero-network ONNX embedder fits the laptop; full REST API (reconciler pushes nodes); 100% local kills the retrieval leak-surface entirely.
**Rejected:** NotebookLM (→ TOOL-1); Open Notebook = runner-up, **kept only as the named fallback** if AnythingLLM fails the real-machine smoke test at build (a verification step, not an open choice — engine is swappable, spine is engine-independent owned markdown). **Build flags:** smoke-test AnythingLLM on the real machine first; disable/scope-bound context-mode auto-memory before any client onboarding; upgrade context-mode 1.0.107→1.0.162. **Supersedes** DESIGN.md §7/§11.

### MEM-16 · Logging automatic via hooks; no `/log` skill  [Locked 2026-06-19]
**Decision:** `session_end` + `pre-compaction` hooks → cheap Haiku summary → append to the scope's log file → reconciler distills nightly. Log files = the chronological SOURCE layer feeding the graph. Scope-aware + shared (Hermes + Claude one timeline).
**Depth:** DESIGN.md §9.

### MEM-17 · Three ingestion modes  [Locked 2026-06-19 / +06-19pm]
**Decision:** (1) on-demand RAG, (2) proactive "dreaming" (overnight synthesis → pending-review queue, lower trust), (3) active elicitation "grill-me" (one-question interview → nodes + open-flags → human-escalation).
**Depth:** DESIGN.md §8.

### MEM-18 · Evergreen vs ephemeral  [Locked 2026-06-19]
**Decision:** stable distilled knowledge → graph; volatile/live data (project state, meeting notes) → **pointed-to, not ingested**.

### MEM-19 · Hybrid-retrieval merge = RRF (k=60)  [Locked 2026-06-19]
**Decision:** where we own the merge (engine results × wikilink-traversal × vault search), fuse the already-ranked lists with reciprocal rank fusion, k=60. We build no vector index ourselves.
**Source:** agentmemory grading (→ TOOL-4). **Depth:** DESIGN.md §13.

---

## Retrieval & tooling evaluations

### TOOL-1 · NotebookLM — dropped  [Locked 2026-06-21]
**Decision:** not used, anywhere.
**Why:** no official API (UI-scraping clients; Google's 2026 redesign broke `add_source`); 2–4wk re-auth treadmill; quality unbenchmarked; consumer/Plus not training-safe (leak path). Only edge (Audio Overviews) didn't justify a fragile Google dependency. **Superseded** by MEM-15.

### TOOL-2 · Headroom — rejected as core infra; `learn` parked  [Locked 2026-06-21]
**Decision:** do NOT adopt Headroom's proxy/compression or its memory-as-store-of-record. **Park `headroom learn`** (offline transcript miner) as a candidate for the self-evolving-CLAUDE.md / feedback-mining slot.
**Why reject core:** open cross-origin data-disclosure vuln (#1227) vs our hard client-data walling guardrail; opt-out telemetry by default (#1223); pre-1.0 chaos (2 releases/day, open data-loss #1006, AST corruption #1233); bus-factor-1; inflated star count. Would override MEM-10 (markdown-graph spine) + the context-mode-stays decision.
**Why park `learn`:** runs offline/off-critical-path, dry-run by default, writes standard CLAUDE.md/MEMORY.md, no telemetry in that path. Re-check #1227/#1223 + run it scoped (it reads all projects' transcripts by default). **Validates** MEM-15 (independently picked the same `all-MiniLM-L6-v2` ONNX embedder). **Depth:** log 2026-06-21.

### TOOL-3 · Hermes aux models = gpt-5.4-mini (DeepSeek out)  [Locked 2026-06-21]
**Decision:** all 8 Hermes `auxiliary.*` slots → `gpt-5.4-mini` on `provider: openai-codex` (in-plan via ChatGPT/Codex OAuth).
**Why:** DeepSeek bills through OpenRouter (not free); mini's 400K matches the gpt-5.5 primary window (handles compression). **Caveat:** aux shares the primary's Codex rate-limit window — offload highest-volume slots to local Gemma if it throttles. Backup: `~/.hermes/config.yaml.bak.pre-aux-swap`.

### TOOL-4 · agentmemory — discarded as system, design validated  [Locked 2026-06-19pm]
**Decision:** don't adopt agentmemory; adopt only 2 ideas: RRF k=60 (→ MEM-19) + selective identity node-naming.
**Why:** our design is more rigorous on ownership/walling/single-writer/schema. Its flat 8-slot model is the single-axis approach MEM-2 rejected.

### TOOL-5 · Tools layer — dropped as a standalone step  [Locked 2026-06-20]
**Decision:** no standalone tools-topology dive; tool requirements fold into Skills per flow.
**Parked candidates:** Token Optimizer, RTK (overlaps context-mode), claude-context-optimizer.

---

## Build & process

### BUILD-1 · Build sequence (bottom-up)  [Locked 2026-06-19pm]
**Decision:** `CLAUDE.md spine → Skills → Memory → Workflows → (loop back, finish CLAUDE.md) → SOUL.md / handoff`. Model Routing + Memory are **cross-cutting threads**, not steps.
**Why:** substrate before orchestration; don't write pointers to layers that don't exist yet.

### BUILD-2 · CLAUDE.md skeleton  [Locked 2026-06-19pm]
**Decision:** global `~/CLAUDE.md` = thin skeleton (~47 lines). **Zero `@`-imports** (eager-load would defeat thinness); deep-dive files stay backticked/lazy. **Orientation = one stable pointer** to STATE. Verify-before-freeze / no-unilateral-canonical-write kept **cockpit-scoped** (working-rhythm memory), out of the global root.
**Why:** the global root loads in every project session — cockpit-specific rules there are noise. Full CLAUDE.md orchestration dive runs after the layers it points to exist.

### BUILD-3 · Memory salvage audit = first build step  [Locked 2026-06-21]
**Decision:** first pass of the memory build = sweep all memory substrates (context-mode auto-memory, every native `MEMORY.md`, Hermes memory) + all `CLAUDE.md` files (live merge chain + archived). Keep deliberate keepers (re-author clean); default discard; bias to archive over delete.
**Why:** executes MEM-15's clean-start rule. Subsumes the boringscale memory-migration item.

### BUILD-4 · Skills architecture  [Locked 2026-06-20]
**Decision:** three-tier (`~/.cockpit/skills/` cross-brain shared · `~/.hermes/skills/` Hermes-only native · `~/projects/<p>/.claude/skills/` project-specific). Dual-brain bridge = Hermes `external_dirs` + Claude Code SessionStart symlink hook, wired when the first shared skill lands. Skill format = SKILL.md + YAML + Purpose + Procedure + `## Rules` (10–15 cap, reconciler-only promotion).

### DOC-1 · Documentation model = one fact, one home  [Locked 2026-06-21]
**Decision:** four docs, no overlap — `STATE.md` (roadmap/status) · `DECISIONS.md` (terse decision ledger + open decisions) · `decisions/<topic>.md` (deep analysis / content goldmine) · `memory/DESIGN.md` + siblings (integrated spec) · `log/` (chronology). A decision lands in DECISIONS first; STATE gets a one-line pointer only if the roadmap moves. Global `~/CLAUDE.md` stays a thin pointer to STATE (map lives in STATE header; behavioral rule in working-rhythm memory).
**Why:** STATE had merged roadmap + decisions + research and the same facts diverged across STATE/DESIGN (DESIGN stayed stale on the retrieval engine). One-fact-one-home (our memory doctrine applied to our docs) kills the divergence; the split index+analysis keeps the ledger scannable while preserving reasoning as mineable content.
**Rejected:** full-ADR ledger entries (too much ceremony); one rich DECISIONS.md (grows to 800+ lines, buries content); folding decisions into DESIGN.md (no home for cross-cutting operating-model/tooling decisions). **Depth:** decisions/doc-architecture.md.

---

## Model routing

### MR-1 · Cost-tier doctrine + hardware gate  [Locked 2026-06-19]
**Decision:** primary workhorses → flat subscription (cheapest at volume); high-volume/mechanical/offline/private → local models; OpenRouter = breadth/fallback only, not a cost play.
**Hardware gate (this laptop):** 13GB RAM (~3.6 free) + RTX 3050 4GB VRAM → local = small quantized Gemma (1B–4B) for mechanical work only, a Haiku-class niche, not a workhorse.

---

## Open decisions (not yet decided)

Live forks. When one closes, convert it to a locked entry above and link from STATE.

- **OPEN-1 · Reach layer scope** — general (cross-brain) vs content-project-specific. Explore when the Reach layer is built. [surfaced 2026-06-20]
- **OPEN-2 · Deletion aggressiveness** — runtime policy, not architecture. Two git-backed tools (supersede vs delete); tune when real accumulation is visible. [2026-06-21]
- **OPEN-3 · Workflow queue / shared board substrate** — GitHub Issues vs a local Kanban board for fleet coordination + workflow handoff. Decide at the Workflows / coordination dive. [2026-06-19]
- **OPEN-4 · Hermes↔Claude handoff interface** — the delegation/result contract is undesigned. [open since 2026-06-18]
- **OPEN-5 · Verify-loop home** — do goal-driven verify-loops live in CLAUDE.md or the Workflows layer? Orchestration-boundary call for the CLAUDE.md dive. [2026-06-19]
- **OPEN-6 · Model Routing mechanism** — policy is live (MR-1, OM-5); the *router* (Claude-side CCR/Codex non-Anthropic models; signals; enforcement) is unbuilt. Its own deep dive. [2026-06-19]
- **OPEN-7 · clients/ventures folder split** — boringscale stays flat for now; rebuild the split only when re-onboarding archived contexts. [2026-06-20]
