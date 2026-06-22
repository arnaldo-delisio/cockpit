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
| `decisions/ingestion-and-curation.md` | MEM-14,16,17,18,21,22 |
| `decisions/retrieval-engine.md` | MEM-15 · TOOL-1 |
| `decisions/headroom-eval.md` | TOOL-2 |
| `decisions/doc-architecture.md` | DOC-1 |
| `decisions/claude-md-projection.md` | MEM-20 |

---

## Operating model

### OM-1 · Builder + operator fleet, no master agent  [Locked 2026-06-18]
**Decision:** Claude Code = singular builder/engineer; Hermes = a *class* of operator/capability-agents (content, job-apps, ops…). They coordinate via shared memory + a shared board + the human — **no master conductor agent** (peers, stigmergic).
**Why:** avoids a single point of orchestration failure; matches the two-substrate reality (build vs operate).

### OM-2 · Two thin global shells  [Locked 2026-06-18]
**Decision:** `~/CLAUDE.md` (builder) + `~/SOUL.md` (Hermes operator) at `~`. Infra only, not "personal."
**Why:** `~/CLAUDE.md` merges cwd→`/` and loads in every session — it must be owned and thin, not avoided.
**Clarified [2026-06-22]:** canonical content lives **in-repo** at `~/.cockpit/shells/{CLAUDE,SOUL}.md`; `~/{CLAUDE,SOUL}.md` are **relative symlinks** into it (version-controlled + clone-clean per MEM-23; a future `bootstrap.sh` recreates the symlinks). Kept in `shells/` — not `~/.cockpit/CLAUDE.md`, which auto-loads in cockpit-rooted sessions and is reserved for the cockpit-scope MEM-20 projection; symlinking there would double-load. Chose symlink over an `@`-import loader (BUILD-2 bans `@`-imports; Hermes's SOUL.md loader may not support them; symlink is filesystem-level + uniform for both shells).

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
**Decision:** index memory on TYPE (identity / knowledge / log) × SCOPE (global · per-venture · per-client · personal; projects nest in a scope). **SCOPE is organization, not a security boundary** (MEM-23): it says *who a node is about*, not who may read it.
**Why:** conflating the axes was the original modeling error. **Depth:** DESIGN.md §3.

### MEM-3 · Knowledge flows, client data is walled  [SUPERSEDED by MEM-23, 2026-06-22]
**Superseded by MEM-23 (VM = trust boundary):** the cross-pollination half stands (knowledge flows freely within the non-confidential main VM); the intra-graph *walling* half is dropped — a confidential client gets its own VM, not an in-graph wall.
**Decision (historical):** general know-how cross-pollinates freely across the graph; confidential client data is walled. "No-leak" applies to *confidential data*, not to learned knowledge.

### MEM-4 · Walling = split substrate  [SUPERSEDED by MEM-23, 2026-06-22]
**Superseded by MEM-23:** no split substrate / per-client vaults inside the graph — isolation moved to the VM boundary. The rejected-options reasoning below stays as the trail.
**Decision (historical):** shared knowledge graph + per-client local vaults.
**Rejected:** (a) separate sub-graphs per client (traps knowledge); (b) single graph + sensitivity-tag gating (one wrong gate = leak).

### MEM-5 · Walling read-side = keys not prompts  [SUPERSEDED by MEM-23, 2026-06-22]
**Superseded by MEM-23:** no intra-graph read-key isolation — the VM is the read boundary. (Ordinary OS file permissions still apply, but they are not the confidentiality mechanism.)
**Decision (historical):** access enforced by OS file permissions + scoped credentials, never prompt discipline. An agent bound to client-A lacks path/key access to client-B; subagents inherit reduced scope.

### MEM-6 · Walling write-side = substrate-provenance tag  [SUPERSEDED by MEM-23, 2026-06-22]
**Superseded by MEM-23:** the `substrate` tag, write-boundary stamping, the hard-reject/cross-substrate rules, and the fail-closed `vault:unknown` default are all dropped — the VM, not a tag, is the wall. The §6a.2 spec that realized this is deleted.
**Decision (historical):** an immutable `substrate` tag (`shared` | `vault:<scope>`) is stamped on every log/staging/node entry at the **write-API boundary**. Reconciler hard-rejects vault-tagged material from the shared graph; cross-substrate promotion forbidden.
**Why (historical):** keys-not-prompts secured only *reads*; this closes the 5 write-path leak paths.

### MEM-7 · Permission source-of-truth invariant  [SUPERSEDED by MEM-23, 2026-06-22]
**Superseded by MEM-23:** no permission-mirror invariant — there is no intra-graph permission layer to mirror; a confidential client's data lives only in its own VM.
**Decision (historical):** ONE ground-truth permission source (shared drive / OAuth); the local scope cache is a **read-only mirror** of it. Lose source access to a client → its memories stop pulling automatically.

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
**Decision:** each node carries `type · fact|inference · centrality · cluster · scope · schema_version`. Retrieval favors high-centrality; community detection shrinks search space.
**Build-spec [2026-06-22]:** concrete YAML+prose file template + capture-vs-reconciler field-ownership split. **Amended by MEM-23:** `substrate` + `sensitivity` fields dropped (intra-graph walling retired — the VM is the boundary); `scope` stays as organization. **Depth:** DESIGN.md §4 + §6a.1.

### MEM-12 · Git plumbing = Haiku; judgment escalates  [Locked 2026-06-19]
**Decision:** add/commit/push/snapshot = Haiku tier; real conflict / history repair / rollback decisions escalate to Sonnet/Opus (rare by design — single-writer + append-only ⇒ ~no conflicts). Git-doing Haiku inherits scope binding.

### MEM-13 · Path topology  [Locked 2026-06-20]
**Decision:** (a) knowledge graph = ONE flat pool `~/.cockpit/memory/knowledge/nodes/`, scope = node frontmatter (a master-index sits *over* the pool); (b) memory substrate = **centralized** `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,sources}/`; (c) each project's co-located auto-loaded `CLAUDE.md` carries a one-line pointer to its scope; (d) project nav docs co-located with the repo.
**Why:** memory is hook-written / reconciler-read, never navigated, so co-location buys nothing here; one home ⇒ simpler single-writer.
**Build-spec [2026-06-22, amended by MEM-23]:** idempotent bootstrap (seed live scopes `global, cockpit, content, job-search`; rest materialized at re-onboarding, OPEN-7); reconciler-generated `INDEX.md` master index; append-only mode until ≥1 centroid/cluster. No `vault/` dirs (intra-graph walling retired — VM is the boundary). **Depth:** DESIGN.md §6a.3.

### MEM-14 · Ingestion + curation model  [Locked 2026-06-21]
**Decision:** `sources/` = raw capture layer per scope (verbatim, frontmattered, search-indexed). **Capture = intent, no engagement gate** — everything autosaves, **scope-aware** tagging (mechanical — from the input's origin + the session's scope, never by judging content meaning; organization not security, MEM-23). The nightly **dream judges depth** by reading (full node / stub / leave-raw), self-correcting via re-search. Memory is **freely mutable; git is the undo** — no tombstone/status-tier ceremony, no scheduled space-GC.
**Rejected:** engagement-meter gating; GC tombstone ceremony (git already gives reversibility). **Supersedes** DESIGN.md §10's tombstone language.

### MEM-15 · Retrieval engine = AnythingLLM (local), one shared graph  [Locked 2026-06-21, amended by MEM-23 2026-06-22]
**Decision:** ONE local engine (AnythingLLM) does semantic retrieval over the owned markdown — **one shared graph**, no per-vault workspaces (intra-graph walling retired, MEM-23). context-mode = **session hygiene only**, never a store of record. **New graph starts clean — no legacy memory migrated** (all auto-learned memory was made under the old setup → untrusted; only deliberate hand-authored notes carry forward by hand).
**Why:** native zero-network ONNX embedder fits the laptop; full REST API (reconciler pushes nodes); 100% local kills the retrieval leak-surface entirely.
**Rejected:** NotebookLM (→ TOOL-1); Open Notebook = runner-up, **kept only as the named fallback** if AnythingLLM fails the real-machine smoke test at build (a verification step, not an open choice — engine is swappable, spine is engine-independent owned markdown). **Build flags:** smoke-test AnythingLLM on the real machine first — and weigh the simpler **direct-ONNX + sqlite-vec + ripgrep + RRF** option there, now that no multi-workspace isolation is needed (the check-pass found AnythingLLM workspaces are namespaces in one shared DB, not a security boundary — moot under MEM-23); context-mode upgraded 1.0.107→1.0.163 (done). **Supersedes** DESIGN.md §7/§11.

### MEM-16 · Logging automatic via hooks; no `/log` skill  [Locked 2026-06-19]
**Decision:** `session_end` + `pre-compaction` hooks → cheap Haiku summary → append to the scope's log file. The reconciler is the sole writer and runs in two tempos: lightweight ingestion bookkeeping continuously at capture boundaries, and the heavy distillation / synthesis pass nightly. Log files = the chronological SOURCE layer feeding the graph. Scope-aware + shared (Hermes + Claude one timeline).
**Clarified [2026-06-22]:** capture is **dumb + comprehensive** — it records **near-raw, judgment-free**, with the scope stamp derived **mechanically** from session context. **Raw is the source of truth;** any Haiku summary is a **lossy convenience index**, never the only copy. **All judgment** (is this a durable rule? framing, dedupe, centrality, CLAUDE.md promotion) lives in the **reconciler** (Sonnet/Opus, MEM-9) — never Haiku at capture (MEM-12). Rationale: a cheap summary that drops a buried correction loses it forever; the smart pass happens later, so capture must keep raw signal.
**Depth:** DESIGN.md §9.

### MEM-17 · Three ingestion modes  [Locked 2026-06-19 / +06-19pm]
**Decision:** (1) on-demand RAG, (2) proactive "dreaming" (overnight synthesis → pending-review queue, lower trust), (3) active elicitation "grill-me" (one-question interview → nodes + open-flags → human-escalation).
**Depth:** DESIGN.md §8.

### MEM-18 · Evergreen vs ephemeral  [Locked 2026-06-19]
**Decision:** stable distilled knowledge → graph; volatile/live data (project state, meeting notes) → **pointed-to, not ingested**.

### MEM-19 · Hybrid-retrieval merge = RRF (k=60)  [Locked 2026-06-19]
**Decision:** where we own the merge (engine results × wikilink-traversal), fuse the already-ranked lists with reciprocal rank fusion, k=60. We build no vector index ourselves.
**Source:** agentmemory grading (→ TOOL-4). **Depth:** DESIGN.md §13.

### MEM-20 · CLAUDE.md = reconciler-projected always-load layer over memory  [Locked 2026-06-22]
**Decision:** the reconciler (MEM-8, sole memory writer) also writes the **managed regions** of CLAUDE.md files — promoting high-`centrality` *behavioral* nodes (`type ∈ {identity, feedback}`) from the graph into the always-loaded CLAUDE.md layer, **routed by scope** (global node → `~/CLAUDE.md`; cockpit node → `~/.cockpit` CLAUDE.md; project/client node → that project's CLAUDE.md). Memory stays the home (DOC-1); the CLAUDE.md block is a **generated, fenced projection** (`<!-- managed:reconciler -->`), never hand-edited; the hand-authored skeleton (BUILD-2) stays in a separate block. Promotion is gated (`when_to_use` + adversarial structure/accuracy lens) + capped (the BUILD-4 10–15 `## Rules` pattern). Facts/knowledge stay retrieval-gated — they don't promote.
**Why:** behavioral rules only bite when always-loaded; retrieval-gating makes them weak. Memory = substrate (everything, retrieval-gated); CLAUDE.md = always-load projection of the few in-scope behavior-critical rules. **One distiller (the reconciler), not two — this IS the self-evolving-CLAUDE.md mechanism**, so `headroom learn` is retired (closes TOOL-2's park; no external miner / leak surface).
**Relates:** extends MEM-8; reuses BUILD-4 (reconciler-only promotion); respects BUILD-2/OM-6 (scope routing keeps the global root thin) + DOC-1 + MEM-10 (CLAUDE.md = another cache over owned markdown). **Build-spec [2026-06-22]:** concrete fence contract (`<!-- managed:reconciler:begin/end -->`, full-interior idempotent replace, per-rule `[[source-node]]` backlink, over-cap drop logged); only behavioral nodes (`type ∈ {identity, feedback}`) project. **Depth:** decisions/claude-md-projection.md + DESIGN.md §6a.4.

### MEM-21 · Tagging model = emergent + reconciler-normalized (no fixed taxonomy)  [Locked 2026-06-22]
**Decision:** node/source tags + entity labels (concepts/people/products) are **free-form at capture**; the reconciler **normalizes synonyms into an emergent canonical vocabulary** and maintains it over time (alongside cluster detection). **No hand-authored fixed keyword taxonomy** — and no pre-build effort authoring keywords.
**Why:** semantic retrieval (MEM-15) finds by meaning, clusters are emergent (MEM-11), wikilinks carry relationships — a fixed taxonomy buys little and is brittle (new domains break it). The real need is *tag coherence*, solved by reconciler normalization (single-writer + self-improvement, MEM-8/9), not a human list. YAGNI. **Revisit only if** retrieval underperforms or a content-pipeline needs a curated vocab. **Depth:** decisions/ingestion-and-curation.md.

### MEM-22 · Salience signals at capture (mechanical markers → reconciler attention)  [Locked 2026-06-22]
**Decision:** capture emits cheap **mechanical** salience markers flagging high-value moments so the reconciler can prioritize — it still makes the keep/frame/centrality call; the markers just focus it (like log levels). Four categories: **keep** ("remember/note/important"), **correction** ("no/wrong/actually/don't", re-instruction), **error/failure**, **decision/approval** ("decided/approved/green"). Grounded in what Claude Code actually exposes: **error = structural** (`tool_result.is_error: true` / the `PostToolUseFailure` hook with `error_message`/`error_type`); **keep/correction/decision = regex over verbatim user text** (`UserPromptSubmit.prompt` real-time, or transcript `user.message.content` at capture). **Hooks:** detect on `Stop` (per-turn, reliable) + `PreCompact` (before context loss) + `SessionEnd` (boundary — but bug #6428: doesn't fire on `/clear`, so never rely on it alone). **Affect-based** signals (frustration/tone) = deferred to the richer feedback-mining mode (parked).
**Why:** even a smart reconciler benefits from cheap anchors so it doesn't miss a buried correction. Emitting them is **pattern-matching, not judgment** → does NOT violate capture-is-dumb (MEM-16). Caveat: test failures + ESC interrupts are NOT structurally flagged by Claude Code (text-only / absent) → those stay best-effort, not guaranteed.
**Two tiers + sentinels [Locked 2026-06-22, safety-net behavior locked 2026-06-22]:** **Tier 1 — explicit sentinels** the user types: **`#good`** (worth keeping / reinforce) and **`#bad`** (wrong / behavioral lesson). Collision-free (never typed except as a signal — unlike natural words "no"/"great" which false-fire), deterministic, zero-cost, **highest confidence** (the human verdict). They are **priority overrides, not gates**: always reviewed first, never auto-promoted on their own, and still judged by the reconciler. **Tier 2 — inferred** (the structural `is_error` + natural-language regex above): best-effort, automatic candidates for review when nothing was marked — and still active even when something was. **Sentinel absence is neutral, never low-value.** The reconciler's own judgment remains a mandatory safety net: its nightly heavy pass must still surface unmarked-but-likely-salient candidates (a "did I miss anything?" sweep), so forgotten sentinels do not create blind spots. **Cost link:** the salience set (errors + sentinels + corrections + decisions) is what the dream's cheap pass gathers into a digest so the expensive model never reads the raw firehose, while the reconciler still keeps a lane for unmarked discovery. **Why:** explicit markers are the highest-confidence signal, but humans forget them; making them the gate would silently lose durable lessons. Priority-not-gating preserves the value of sentinels without making memory brittle. **Depth:** decisions/ingestion-and-curation.md.

### MEM-23 · Isolation boundary = the VM, not the graph  [Locked 2026-06-22]
**Decision:** the trust boundary is the **VM** — one trust domain per VM, not an intra-process wall inside the knowledge graph. **Drop all intra-substrate walling:** the `substrate` tag, per-scope `vault/` dirs, read-side keys-not-prompts, write-side provenance stamping + fail-closed `vault:unknown`, the permission source-of-truth / read-only-mirror invariant (MEM-7), retrieval-engine per-scope workspace isolation, and the node-schema `sensitivity` field (now YAGNI). Build for the **non-confidential case only**: one main VM, one fully-shared knowledge graph. **SCOPE survives purely as organization** (which venture/client a node is *about*) — never a security boundary. When a real confidential client arrives, a **separate VM running a clone of the same cockpit** handles it; that gets organized *then*, not designed now.
**Security model = confidential data never leaves its VM** (no shared graph/index/git remote/copy-paste back into the main cockpit). The VM boundary protects nothing if confidential data is allowed to flow back — so the data-flow discipline *is* the control, not the tag.
**Invariant kept: the cockpit stays clone-clean** — no hardcoded absolute paths, no secrets in the tree, deps version-pinned, no single-brain/single-VM assumptions — so the future VM clone is isolation-by-construction, not a retrofit.
**Why:** the split-substrate machinery was load-bearing complexity for a confidential client who does not yet exist (YAGNI). VM-level isolation is simpler, structural, and zero-leak by construction (separate machine = separate everything); an in-process tag is fragile (one missing filter = cross-tenant leak). Validated externally as the recognized "silo" tenant-isolation model (AWS SaaS Lens; OWASP multi-tenant risks).
**Supersedes:** MEM-3, MEM-4, MEM-5, MEM-6, MEM-7.
**Amends:** MEM-2 (SCOPE = organization, not a wall), MEM-11 (drops `substrate` + `sensitivity` fields), MEM-13 (drops `vault/` dirs + vault rule), MEM-15 (one shared graph, no per-vault workspaces).
**Relates:** OPEN-7 (confidential-client org happens at the future VM). **Depth:** `decisions/walling.md` (superseded-in-place — retains the threat model + rejected-options trail).

---

## Retrieval & tooling evaluations

### TOOL-1 · NotebookLM — dropped  [Locked 2026-06-21]
**Decision:** not used, anywhere.
**Why:** no official API (UI-scraping clients; Google's 2026 redesign broke `add_source`); 2–4wk re-auth treadmill; quality unbenchmarked; consumer/Plus not training-safe (leak path). Only edge (Audio Overviews) didn't justify a fragile Google dependency. **Superseded** by MEM-15.

### TOOL-2 · Headroom — rejected as core infra; `learn` parked  [Locked 2026-06-21]
**Decision:** do NOT adopt Headroom's proxy/compression or its memory-as-store-of-record. **Park `headroom learn`** (offline transcript miner) as a candidate for the self-evolving-CLAUDE.md / feedback-mining slot.
**Why reject core:** open cross-origin data-disclosure vuln (#1227) vs our hard client-data guardrail (now VM-level, MEM-23); opt-out telemetry by default (#1223); pre-1.0 chaos (2 releases/day, open data-loss #1006, AST corruption #1233); bus-factor-1; inflated star count. Would override MEM-10 (markdown-graph spine) + the context-mode-stays decision.
**Why park `learn`:** runs offline/off-critical-path, dry-run by default, writes standard CLAUDE.md/MEMORY.md, no telemetry in that path. Re-check #1227/#1223 + run it scoped (it reads all projects' transcripts by default). **Validates** MEM-15 (independently picked the same `all-MiniLM-L6-v2` ONNX embedder). **Depth:** log 2026-06-21.
**Update [2026-06-22]:** `learn` park **closed** — the self-evolving-CLAUDE.md need it was held for is now served natively by our own reconciler (MEM-20), so no external miner is adopted (avoids its leak surface entirely). Headroom stays rejected as core infra.

### TOOL-3 · Hermes aux models = gpt-5.4-mini (DeepSeek out)  [Locked 2026-06-21]
**Decision:** all 8 Hermes `auxiliary.*` slots → `gpt-5.4-mini` on `provider: openai-codex` (in-plan via ChatGPT/Codex OAuth).
**Why:** DeepSeek bills through OpenRouter (not free); mini's 400K matches the gpt-5.5 primary window (handles compression). **Caveat:** aux shares the primary's Codex rate-limit window — offload highest-volume slots to local Gemma if it throttles. Backup: `~/.hermes/config.yaml.bak.pre-aux-swap`.

### TOOL-4 · agentmemory — discarded as system, design validated  [Locked 2026-06-19pm]
**Decision:** don't adopt agentmemory; adopt only 2 ideas: RRF k=60 (→ MEM-19) + selective identity node-naming.
**Why:** our design is more rigorous on ownership/walling/single-writer/schema. Its flat 8-slot model is the single-axis approach MEM-2 rejected.

### TOOL-5 · Tools layer — dropped as a standalone step  [Locked 2026-06-20]
**Decision:** no standalone tools-topology dive; tool requirements fold into Skills per flow.
**Parked candidates:** Token Optimizer, RTK (overlaps context-mode), claude-context-optimizer.

### TOOL-6 · Native Claude / Hermes memory evaluated as capture feeder — rejected  [Locked 2026-06-22]
**Decision:** do NOT use Claude Code's native auto-memory or Hermes's memory subsystem as the memory **capture feeder** (nor as store of record). Build our own session-boundary capture hooks (MEM-16) feeding staging.
**Why — as store of record:** native = flat single-axis model rejected by MEM-2; Hermes = SQLite DB rejected by MEM-10. **As a feeder:** native **couples write+recall** (can't capture without its own recall injection → a second recall system fighting ours), its disable-bug **#63903 taxes ~11–16k tokens/session**, and its frontmatter is undocumented/internal (drift risk); both are **model-decided + lossy**, not the deterministic session-boundary capture our design needs. The build it would save is a small hook script — false economy against losing control.
**Salvage (fair):** use native's `autoMemoryDirectory`/disable controls at the day-0 cutover; **bridge Hermes as a staging *writer*** (its existing write-gate/approval already fits the stage→reconcile model), not a store we read. **Confirms** MEM-16 rather than overturning it. **Depth:** log 2026-06-22 (two research agents: CC memory feature + Hermes `memory_tool.py`).

---

## Build & process

### BUILD-1 · Build sequence (bottom-up)  [Locked 2026-06-19pm]
**Decision:** `CLAUDE.md spine → Skills → Memory → Workflows → (loop back, finish CLAUDE.md) → SOUL.md / handoff`. Model Routing + Memory are **cross-cutting threads**, not steps. **Clarification [2026-06-22]:** memory pre-crystallization work (salvage, cutover planning, blocking-spec lock, retrieval smoke-test prep) is preparation **inside the Memory step**, not a superseding reorder of BUILD-1.
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
