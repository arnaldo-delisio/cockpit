# Cockpit Memory Layer — Canonical Design

**Status:** design closed + hardened (2026-06-19; refreshed 2026-06-21 for the AnythingLLM / ingestion-model decisions). Build not started.
**Source of decisions:** `~/.cockpit/DECISIONS.md` (MEM-*, TOOL-*, BUILD-*). This doc is the integrated spec of *how the memory layer works*; DECISIONS holds the choice-by-choice trail + rejected alternatives; `log/` holds the chronology.
**Scope of this doc:** the memory layer only. Tools, skills, `~/CLAUDE.md` orchestration, and the Hermes↔Claude handoff are separate deep dives.

---

## 1. Purpose

One memory substrate that a **fleet of agents** — Hermes capability-agents (content, job-apps, …), the Claude Code builder, and their Sonnet/Haiku subagents — all read and write, **without drift and without cross-client leak.** Knowledge cross-pollinates across contexts; confidential client data is walled.

---

## 2. Core principles (locked)

- **Graph, not tree.** Knowledge is a unified, cross-linked, self-improving graph (Karpathy "LLM OS"). Retrieved by search, not by folder path.
- **Own the substrate.** Store of record = distilled, wikilinked **markdown we own** + git. No third party holds the brain.
- **Buy retrieval, run it local.** A swappable local engine (AnythingLLM, MEM-15) sits *on top of* the owned markdown — embeddings + retrieval 100% local, no third party in the retrieval path.
- **Walls are mechanical, not trusted.** Enforced by access-control + provenance tags, never by prompt instruction.
- **One writer for truth.** Many agents observe; a single reconciler writes canonical nodes.
- **Distill, don't dump.** Resources are compressed to durable facts before they enter the brain.

---

## 3. The two axes

Memory is indexed on **two orthogonal axes**. Conflating them was the original modeling error.

**TYPE** (what kind of thing):
- **identity** — who is served, voice, mission. Small, loaded at invocation.
- **knowledge** — distilled facts + relationships. Large, self-growing, RAG-retrieved.
- **log** — chronological record of what happened. Append-only, never rewritten.

**SCOPE** (who it is about): `global · per-venture · per-client · personal`. Projects nest under a venture or client.

Every cell of the grid exists:

|            | global            | per-venture        | per-client            | personal        |
|------------|-------------------|--------------------|-----------------------|-----------------|
| identity   | operator (soul.md)| venture voice      | (client identity)     | personal self   |
| knowledge  | general know-how  | venture know-how   | client know-how       | personal        |
| log        | cockpit diary     | venture diary      | client diary          | personal diary  |

- **"Vault" is not a type** — it is the **confidential cells** of a scope (mostly the per-client column).
- **Shared knowledge graph** = the union of all **non-confidential** knowledge cells, cross-linked across scopes. This is what cross-pollinates.
- **`soul.md`** = the **operator meta-identity** (Arn / Hermes) at global scope. **Per-context identity lives inside each scope** — so "identity is per-context, never global" holds: the global file is the *operator's*, not any context's.

---

## 4. Storage & ownership

- **Store of record:** distilled wikilinked markdown files + **git** underneath (history, rollback, audit). Local-first, embedded — no cloud DB (no Turso) for the store of record.
- **Layout (MEM-13):** knowledge graph = one flat pool `~/.cockpit/memory/knowledge/nodes/` (scope = node frontmatter, master-index over the pool); memory substrate = centralized `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,vault,sources}/`. `sources/` = raw capture layer (§8); `vault/` = local-only + gitignored. Each project's co-located `CLAUDE.md` carries a one-line pointer to its scope.
- **Graph structure** = wikilinks (`[[ ]]`, Obsidian-navigable) between markdown nodes.

### Node schema
`type · fact|inference · centrality · cluster · sensitivity · substrate · scope · schema_version`

- `fact|inference` — provenance/confidence. A `fact` node **requires a citation** (log-entry hash or URL) or is auto-downgraded to `inference`.
- `centrality` — "god-node" ranking; drives retrieval priority.
- `cluster` — community membership; shrinks retrieval search space.
- `sensitivity` — walling signal.
- `substrate` — **immutable** provenance tag (`shared` | `vault:<scope>`); see §6.
- `schema_version` — for lazy migration as the schema evolves.

---

## 5. Write model — staging + single reconciler

Concurrent writes to shared files corrupt and contradict. Solution: **nobody writes canonical nodes except one reconciler.**

1. **Agents append** observations to a **session-anchored staging inbox** — append-only, each agent owns its lane, so appends never collide. Format: Haiku summarizes each turn → bullets → date-partitioned files tagged with a session anchor (provenance) + `substrate` tag.
2. **One reconciler** (the compaction / overnight-"dreaming" agent) is the **sole writer** of canonical nodes: reads staging → fact-check → cross-link → rewrite → GC.
3. **Git underneath** for history/rollback. Git **plumbing** (add/commit/push) = **Haiku tier**; git **judgment** (rare by design) escalates.

This **unifies write-safety and self-improvement into one component** (the reconciler). A single-writer-for-memory is infrastructure, not an orchestration master — the "no master agent" rule (agents coordinate via a shared Kanban board) still holds.

### Reconciler operational contract
- **Conflict precedence:** source-trust → recency → human-escalation queue.
- **Two-phase commit:** write canonical + git commit, **then** mark staging consumed (git hash = consumed marker). Crash recovery = re-run from last unconsumed entry.
- **Fencing:** acquire a lockfile before reading staging; a second instance exits. (Prevents dreaming + manual run racing.)
- **Instability guard:** before committing a rewrite, if citation-drop OR centrality-delta OR cluster-flip exceeds threshold → hold for human review instead of auto-commit.
- **soul.md** mutations route through the **same** staging→reconciler pipeline (no direct writes — a bad direct write would corrupt every future session).
- **Subagents write ONLY to staging.** "Haiku plumbing" = git ops on behalf of the reconciler, **not** arbitrary graph-write access.

---

## 6. Walling — read + write

Confidential client data must never reach the shared graph or any third party. (The retrieval engine is local — MEM-15 — so there is no third-party retrieval surface; the walls below still hold the shared/vault boundary *within* the local substrate.) Two enforcement halves:

**Read side — "keys not prompts":** access enforced by OS file permissions + scoped credentials, never by prompt discipline. An agent bound to client-A **lacks path/key access** to client-B. Scope ("the keys") is **derived from one permission source-of-truth** (shared drive / OAuth); the local cache is a **read-only mirror**. Lose source access → memories stop pulling automatically. Subagents inherit the parent's reduced scope.

**Write side — substrate-provenance:** an **immutable `substrate` tag** (`shared` | `vault:<scope>`) is stamped on every log entry, staging entry, and node **at the write-API boundary** (not by agent judgment). Then:
- Reconciler **hard-rejects** vault-tagged material from the shared graph — vault material reconciles only into its own vault.
- **Retrieval-engine indexing** ingests `substrate=shared` nodes into the shared workspace and `substrate=vault:<scope>` nodes into that scope's isolated workspace **only** — never commingled.
- **Dreaming + graph traversal** are OS-perm-scoped to their substrate.
- **Cross-substrate promotion forbidden** — shared→vault is read-only lookup at most; vault→shared never.

This closes the five leak paths the review found: commingled logs, dreaming-pattern leakage, traversal crossing, subagent in-context vault content, and retrieval-engine cross-substrate contamination (vault nodes leaking into the shared workspace).

---

## 7. Retrieval

**Hybrid, complementary by level** (5-level taxonomy: exact → topic → semantic → relationship-chain → graph-inference):
- **Semantic (≈L3):** the **local retrieval engine** (AnythingLLM, MEM-15) over the owned markdown — native zero-network ONNX embedder (`all-MiniLM-L6-v2`), embeddings + retrieval 100% local. **Both layers use the same engine, in isolated workspaces:** the shared knowledge graph and each `vault:<scope>` get their own workspace (no commingling — §6). A swappable cache → low lock-in (breaks = lose convenience, not knowledge; the spine is engine-independent owned markdown).
- **Relationship / inference (≈L4–5):** **wikilink graph traversal** over the owned markdown (respecting substrate boundaries).
- **Tiering for token discipline:** hot cache → master index → deep wiki (~40K baseline). Evergreen knowledge → graph; volatile/live data (project state, client meeting notes) → **pointed-to, not ingested**.
- **Session hygiene (separate concern):** context-mode handles in-session context-window protection — it is **not** a memory store of record (MEM-15). Never index canonical notes into context-mode.

**Engine choice (MEM-15):** AnythingLLM, one local engine for both shared + vault — decided. Chosen over NotebookLM (dropped — TOOL-1) and Open Notebook (runner-up). Build **smoke-tests AnythingLLM on the real machine** (RAM-tight) before integration, with **Open Notebook as the named fallback** if it fails — a verification step, not an open choice. Does not block the memory build: the store of record is owned markdown and the engine is swappable on top.

**Freshness:** owned markdown is truth, the retrieval engine is cache. Re-sync triggered post-reconciler-commit; per-document `last_synced`; queries in a stale window are flagged. (TTLs in backlog.)

---

## 8. Ingestion — capture + three modes

**Capture layer (`sources/`, MEM-14).** Each scope has a `sources/` dir (beside `vault/`): verbatim inputs — transcripts, repo snapshots, docs, pastes — frontmattered (`type · title · source · captured · session_anchor · scope · substrate · status · distilled_into · concepts/people/products`), fully search-indexed so nothing is ever invisible. **Capture = intent, no engagement gate** — everything autosaves (`/watch` autosaves here), content-aware tagged: public → `scopes/global/sources/` `substrate:shared`; confidential → that scope's `vault/sources/`. The **dream judges depth** by reading (full cross-linked node / one-line stub / leave-in-raw) — reading comprehension is the filter, no engagement metric; a wrong call self-corrects (find raw by search later → next run promotes). Memory is **freely mutable; git is the undo** — no tombstone ceremony, no scheduled space-GC (MEM-14, supersedes §10's tombstone language).

1. **On-demand RAG** — pull at query time.
2. **Proactive "dreaming"** — overnight cron agent reads every NEW source (since last run) + (substrate-scoped) logs + shared graph, triages, distills to earned depth, cross-links, surfaces suggestions unprompted. Output tagged `source=dreaming` at **lower trust rank**; novel suggestions go to a **pending-review queue**, not straight to canonical. Hard token + new-node budget per run. Routing: judgment (triage/distill/cross-link/conflict) = Sonnet min, Opus for hard calls; Haiku = plumbing only (git, dedup-by-hash, mark-consumed).
3. **Active elicitation ("grill me")** — pull tacit knowledge *out of the human* into the identity/knowledge layer by **relentless one-question-at-a-time interviewing** (recommend an answer per question; if the codebase can answer, look there instead of asking). Checkpoint each answer to structured markdown as you go. Output = discovery nodes + key decisions + Q&A log + **open-flags** (what the human couldn't answer). Open-flags feed the reconciler's **human-escalation queue** (§5). This is the input path for knowledge that no log or resource contains. Packaged as a skill (skills dive). Pattern source: Matt Pocock's `grill-me`.

---

## 9. Logging

- **Automatic via hooks — there is no `/log` skill.** `session_end` + `pre-compaction` hooks → a cheap Haiku agent summarizes the session → appends to the scope's log file. (`pre-compaction` ensures in-session observations aren't eaten by context compaction.)
- **Log files = the chronological SOURCE layer** under the graph (append-only diary; never rewritten). The reconciler **ingests** them and distills durable facts up into the graph.
- **Scope-aware + shared:** one timeline per context that **both Hermes and Claude** append to (replaces the old hardcoded `{CWD}/log/`).
- **Ad-hoc "note this"** = an agent writing to the scope log file directly — no dedicated skill.
- Session heartbeat lets the reconciler tell a live session from a dead one (missed-flush handling).

---

## 10. Self-improvement & GC

- Reconciler rewrites-on-ingest (fact-check → cross-link → rewrite) — the graph improves over time.
- **GC** = reconciler judgment **+ hard character-caps backstop** (mechanical, forces summarization even if the reconciler hasn't run). Session-anchor flags throwaway one-offs.
- **Deletes use git as the undo, not tombstones (MEM-14).** Memory is freely mutable (merge / rewrite / supersede / delete as normal curation); git already gives reversibility + full history + audit, so no separate tombstone/status-tier ceremony and no scheduled space-GC. Two safe per-node tools: *supersede* (keep, mark not-current, stays searchable) vs *delete* (drop from live graph, git keeps history). Deletion aggressiveness = runtime policy, deferred (OPEN-2).
- **Observability:** reconciler emits a per-run audit diff (added/modified/deleted/held + reason codes); human-readable digest on demand.

---

## 11. Reconciling the 3 prior systems

No rivalry — roles assigned (MEM-15):
- **Claude Code file memory + Hermes memory** → collapse into the **identity layer** (soul.md + per-scope identity).
- **Retrieval for BOTH shared + vault** → the one local engine (AnythingLLM), isolated workspaces per substrate.
- **context-mode** → **session hygiene only** (in-session context-window protection), never a store of record. Its keyword KB / auto-memory is not canonical.
- **NotebookLM** → dropped entirely (TOOL-1).

**Clean start — no legacy migration (MEM-15).** The new graph starts empty. All auto-learned memory (context-mode's auto-prefs, incidental native `MEMORY.md` entries) was made under the old/wrong setup → untrusted, discarded, not folded. Only deliberately hand-authored, currently-correct notes carry forward, by hand. The first build pass is the **salvage audit (BUILD-3)** across all memory substrates + `CLAUDE.md` files; the boringscale memory file folds into it.

---

## 12. Multi-agent fleet

- **Builder + operator fleet:** Claude Code (singular builder) + Hermes (a *class* of capability-agents). Both + their Sonnet/Haiku subagents read+write the one substrate.
- **Coordination = shared Kanban board + the human** (stigmergic). No master conductor agent. (Board needs write-locking — backlog.)
- **Model routing:** Opus orchestrates; Sonnet executes (research/bulk/edits); Haiku does mechanical/git-plumbing. Each skill carries its own model binding.

---

## 13. Build backlog (non-blocking specs to finalize during build)

- Retrieval-engine + permission-mirror **TTLs** (re-sync triggers post-reconciler-commit; revoke → invalidate mirror).
- `schema_version` **migration functions** (keyed `from→to`, in-repo, tested, lazy on read).
- Reconciler **audit-diff + tombstones** (observability).
- Dreaming **token/node budget + pending-review queue**.
- Session **heartbeat** for dead-session detection.
- Staging **growth cap** (block + warn, never silent drop).
- Shared **Kanban board write-locking**.
- **Cold-start** bootstrap sequence (seed soul.md, ≥1 centroid node per cluster, append-only bootstrap mode until threshold).
- Exact scope **directory paths** + vault layout.
- **Hybrid-retrieval merge function** (MEM-19, from agentmemory grading): §7 leaves *how* the ranked lists combine unspecified. Where WE own the merge (engine semantic results × wikilink-traversal results), fuse the already-ranked lists with **RRF — reciprocal rank fusion, k=60** (standard rank-list fusion). Does NOT violate "buy retrieval": the engine still owns embeddings/vector retrieval internally; we only re-rank *across* the lists it returns. Sole requirement on us: each node carries clean distilled prose (the engine ingests it) — we build no vector index ourselves.
- **Identity-node naming — already settled by §3** (node = TYPE × SCOPE grid cell); do NOT adopt agentmemory's flat 8-slot list wholesale — it's the single-axis model §3 rejected, and most slots aren't identity anyway (`tool_guidelines`→skills `## Rules`; `project_context`→§7 volatile/pointed-to; `pending_items`→Kanban/log; `session_patterns`→§8 dreaming output). At most cherry-pick `persona · user_preferences · guidance` as sub-fields *inside* an identity node. Reference only, low priority.

---

## 14. Explicitly deferred (other deep dives)

- **`~/CLAUDE.md` orchestration** — the auto-loaded layer; how CLAUDE.md ↔ STATE ↔ graph ↔ soul.md cross-reference without bloat. Its own deep dive.
- **Tools layer** — MCP/tool topology per brain.
- **Skills layer** — `~/.cockpit/skills/` structure; self-improving skill `## Rules` block; `/watch` visual-ingestion evaluation.
- **Hermes↔Claude handoff interface.**
- **Token-optimization** — treated as a cross-cutting thread applied in every layer, not a standalone dive.
