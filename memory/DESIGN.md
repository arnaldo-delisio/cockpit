# Cockpit Memory Layer — Canonical Design

**Status:** design closed + hardened (2026-06-19). Build not started.
**Source of decisions:** `~/.cockpit/STATE.md` → "Memory architecture". This doc is the clean, organized spec; STATE holds the chronological decision trail.
**Scope of this doc:** the memory layer only. Tools, skills, `~/CLAUDE.md` orchestration, and the Hermes↔Claude handoff are separate deep dives.

---

## 1. Purpose

One memory substrate that a **fleet of agents** — Hermes capability-agents (content, job-apps, …), the Claude Code builder, and their Sonnet/Haiku subagents — all read and write, **without drift and without cross-client leak.** Knowledge cross-pollinates across contexts; confidential client data is walled.

---

## 2. Core principles (locked)

- **Graph, not tree.** Knowledge is a unified, cross-linked, self-improving graph (Karpathy "LLM OS"). Retrieved by search, not by folder path.
- **Own the substrate.** Store of record = distilled, wikilinked **markdown we own** + git. No third party holds the brain.
- **Buy retrieval, don't build it.** Managed RAG (NotebookLM) sits *on top of* the owned markdown as a swappable cache.
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
- **Layout:** scope-partitioned directories under `~/.cockpit/memory/` (global, ventures, personal) and per-client vaults (local-only). Exact paths TBD in build.
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

Confidential client data must never reach the shared graph or any third party (NotebookLM = Google = leak). Two enforcement halves:

**Read side — "keys not prompts":** access enforced by OS file permissions + scoped credentials, never by prompt discipline. An agent bound to client-A **lacks path/key access** to client-B. Scope ("the keys") is **derived from one permission source-of-truth** (shared drive / OAuth); the local cache is a **read-only mirror**. Lose source access → memories stop pulling automatically. Subagents inherit the parent's reduced scope.

**Write side — substrate-provenance:** an **immutable `substrate` tag** (`shared` | `vault:<scope>`) is stamped on every log entry, staging entry, and node **at the write-API boundary** (not by agent judgment). Then:
- Reconciler **hard-rejects** vault-tagged material from the shared graph — vault material reconciles only into its own vault.
- **NotebookLM sync** pushes `substrate=shared` nodes **only**.
- **Dreaming + graph traversal** are OS-perm-scoped to their substrate.
- **Cross-substrate promotion forbidden** — shared→vault is read-only lookup at most; vault→shared never.

This closes the five leak paths the review found: commingled logs, dreaming-pattern leakage, traversal crossing, subagent in-context vault content, and NotebookLM contamination.

---

## 7. Retrieval

**Hybrid, complementary by level** (5-level taxonomy: exact → topic → semantic → relationship-chain → graph-inference):
- **Semantic (≈L3):** **NotebookLM** managed-RAG over the owned shared markdown. Google does embeddings/chunking/retrieval/grounded-citations. A swappable cache → low lock-in (breaks = lose convenience, not knowledge).
- **Relationship / inference (≈L4–5):** **wikilink graph traversal** over the owned markdown (respecting substrate boundaries).
- **Vaults:** retrieved by **context-mode local FTS** (NotebookLM is disqualified — Google).
- **Tiering for token discipline:** hot cache → master index → deep wiki (~40K baseline). Evergreen knowledge → graph; volatile/live data (project state, client meeting notes) → **pointed-to, not ingested**.

**Retrieval-engine decision (deferred to build, 2026-06-19):** NotebookLM is the swappable *default* now, but a self-hosted alternative — **Open Notebook (`lfnovo/open-notebook`)**: local Docker app, vector search, REST API, 18+ providers (cloud or local embeddings) — is a strong candidate. Two options, NOT "both" (running two engines over the same data = double sync/index/maintenance + drift; rejected):
- **(a) Split by substrate** — NotebookLM for shared (zero-maintenance, fine since shared = non-confidential) + a local engine for vaults.
- **(b) Unified local — Open Notebook for both.** One engine, zero third parties, the **Google-leak constraint disappears entirely**, one pipeline. Cost = self-host/maintenance. **Leaning (b)** — fits own-the-substrate / no-leak values. Note: Open Notebook is a *local app*, not a local LLM — it can use cloud embeddings, so it's viable on RAM-limited hardware. Decide at build on actual Open Notebook performance + maintenance appetite.

**Freshness:** owned markdown is truth, the retrieval engine is cache. Re-sync triggered post-reconciler-commit; per-document `last_synced`; queries in a stale window are flagged. (TTLs in backlog.)

---

## 8. Ingestion — three modes

1. **On-demand RAG** — pull at query time.
2. **Proactive "dreaming"** — overnight cron agent reads (substrate-scoped) logs + shared graph, synthesizes, surfaces suggestions unprompted. Output tagged `source=dreaming` at **lower trust rank**; novel suggestions go to a **pending-review queue**, not straight to canonical. Hard token + new-node budget per run.
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
- **Tombstones** for GC deletes (not git-only), so deletions are auditable.
- **Observability:** reconciler emits a per-run audit diff (added/modified/deleted/held + reason codes); human-readable digest on demand.

---

## 11. Reconciling the 3 prior systems

No rivalry — three roles:
- **Claude Code file memory + Hermes memory** → collapse into the **identity layer** (soul.md + per-scope identity).
- **context-mode MCP KB (local FTS)** → **local retrieval engine for the walled vaults**.
- **NotebookLM** → retrieval for the **shared** (non-confidential) knowledge layer.

(Migration of the one existing boringscale memory file happens in the build phase.)

---

## 12. Multi-agent fleet

- **Builder + operator fleet:** Claude Code (singular builder) + Hermes (a *class* of capability-agents). Both + their Sonnet/Haiku subagents read+write the one substrate.
- **Coordination = shared Kanban board + the human** (stigmergic). No master conductor agent. (Board needs write-locking — backlog.)
- **Model routing:** Opus orchestrates; Sonnet executes (research/bulk/edits); Haiku does mechanical/git-plumbing. Each skill carries its own model binding.

---

## 13. Build backlog (non-blocking specs to finalize during build)

- NotebookLM + permission-mirror **TTLs** (re-sync triggers; revoke → invalidate mirror).
- `schema_version` **migration functions** (keyed `from→to`, in-repo, tested, lazy on read).
- Reconciler **audit-diff + tombstones** (observability).
- Dreaming **token/node budget + pending-review queue**.
- Session **heartbeat** for dead-session detection.
- Staging **growth cap** (block + warn, never silent drop).
- Shared **Kanban board write-locking**.
- **Cold-start** bootstrap sequence (seed soul.md, ≥1 centroid node per cluster, append-only bootstrap mode until threshold).
- Exact scope **directory paths** + vault layout.
- **Hybrid-retrieval merge function** (from agentmemory grading, 2026-06-19): §7 leaves *how* the ranked lists combine unspecified. Where WE own the merge (NotebookLM results × wikilink-traversal results × vault FTS), fuse the three already-ranked result lists with **RRF — reciprocal rank fusion, k=60** (standard rank-list fusion). Does NOT violate "buy retrieval": NotebookLM still owns embeddings/vector retrieval internally; we only re-rank *across* the lists each engine returns. Sole requirement on us: each node carries clean distilled prose (NotebookLM ingests it, vault FTS indexes it) — we build no vector index ourselves.
- **Identity-node naming — already settled by §3** (node = TYPE × SCOPE grid cell); do NOT adopt agentmemory's flat 8-slot list wholesale — it's the single-axis model §3 rejected, and most slots aren't identity anyway (`tool_guidelines`→skills `## Rules`; `project_context`→§7 volatile/pointed-to; `pending_items`→Kanban/log; `session_patterns`→§8 dreaming output). At most cherry-pick `persona · user_preferences · guidance` as sub-fields *inside* an identity node. Reference only, low priority.

---

## 14. Explicitly deferred (other deep dives)

- **`~/CLAUDE.md` orchestration** — the auto-loaded layer; how CLAUDE.md ↔ STATE ↔ graph ↔ soul.md cross-reference without bloat. Its own deep dive.
- **Tools layer** — MCP/tool topology per brain.
- **Skills layer** — `~/.cockpit/skills/` structure; self-improving skill `## Rules` block; `/watch` visual-ingestion evaluation.
- **Hermes↔Claude handoff interface.**
- **Token-optimization** — treated as a cross-cutting thread applied in every layer, not a standalone dive.
