---
topic: Memory architecture — core design
decisions: [MEM-1, MEM-2, MEM-8, MEM-9, MEM-10, MEM-11]
status: locked
amended_by: MEM-23
date: 2026-06-21
---

# Memory Architecture — Core Design

> **Amended 2026-06-22 (MEM-23):** the walling-specific passages below — "vault is not a type", the `substrate`/`sensitivity` schema fields, the staging substrate tag, the split-substrate §6 mechanism — are **retired**; isolation moved to the VM boundary. The core design (graph-not-tree, TYPE×SCOPE, owned-markdown+git, append-only staging + single reconciler) **stands**. SCOPE is now organization, not a confidentiality wall.

## TL;DR

Memory is a unified cross-linked wikilinked markdown graph (not a folder tree), indexed on two orthogonal axes — TYPE (identity / knowledge / log) × SCOPE (global / per-venture / per-client / personal). The store of record is markdown we own, versioned in git, local-first. Writes flow through an append-only staging inbox; a single reconciler is the sole writer of canonical nodes. A detailed operational contract governs conflict resolution, crash recovery, and instability detection.

---

## Context — the problem

Three forces drove this design:

**Drift.** Prior memory systems (Claude-file identities, a Hermes memory layer, context-mode FTS) were built independently. They partially overlapped, had no unified write discipline, and no shared self-improvement loop. Facts stagnated or contradicted across systems.

**Cross-client leak risk.** Concurrently serving multiple clients inside a multi-agent fleet creates a structural leak surface. Any system that relies on prompt discipline to prevent confidential facts from crossing client boundaries is unsafe — the same agent that "knows" client A's strategy will hallucinate it into a query about client B.

**Many concurrent writers.** A fleet of Hermes agents plus Claude Code all observe things worth remembering and may run simultaneously. Concurrent direct writes to shared files corrupt and contradict. There was no mechanism to reconcile observations into durable, cross-linked, curated knowledge.

These problems had to be solved at the substrate level, not the prompt level.

---

## Key choices

### 1. Graph, not tree (MEM-1)

**Decision:** knowledge is a unified, cross-linked, self-improving graph retrieved by search + wikilinks — not by folder path.

**Why a folder tree fails here:** knowledge is not codebase-shaped. A folder hierarchy enforces a single parent per node and traps cross-domain links inside directory silos. A concept relevant to both a venture and a client — e.g., a pricing model or a process pattern — cannot live in two places in a tree without duplication. Duplication means drift. In a graph, a node can carry wikilinks to any other node regardless of scope or type; retrieval follows edges, not directory structure.

The graph is navigable via `[[ ]]` wikilinks (Obsidian-compatible). The flat physical layout (`~/.cockpit/memory/knowledge/nodes/`) reflects this: every node is a peer in one pool; scope and type are frontmatter fields, not path segments. A master-index sits over the pool.

**Self-improvement** is built into the write model: the single reconciler (§4 below) fact-checks, cross-links, and rewrites nodes on every compaction pass. The graph improves as observations accumulate.

---

### 2. Two axes: TYPE × SCOPE — and why conflation was the original modeling error (MEM-2)

**Decision:** index memory on TYPE (identity / knowledge / log) × SCOPE (global · per-venture · per-client · personal; projects nest under a venture or client).

**The original error** was treating memory as a single-axis list of named slots (e.g., "persona", "project context", "tool guidelines", "client notes"). This conflates two orthogonal dimensions: *what kind of thing is this* with *whose context does it belong to*. The result is a flat bag that cannot express "this is identity-type knowledge about the boringscale venture" vs "this is factual knowledge relevant to all contexts."

**The two axes:**

- **TYPE** answers *what kind of thing*:
  - `identity` — who is served, voice, mission. Small, loaded at invocation.
  - `knowledge` — distilled facts and relationships. Large, self-growing, RAG-retrieved.
  - `log` — chronological record of what happened. Append-only, never rewritten.

- **SCOPE** answers *whose context*: `global · per-venture · per-client · personal`.

Every grid cell exists and is meaningful:

|          | global            | per-venture      | per-client       | personal       |
|----------|-------------------|------------------|------------------|----------------|
| identity | operator (soul.md)| venture voice    | client identity  | personal self  |
| knowledge| general know-how  | venture know-how | client know-how  | personal       |
| log      | cockpit diary     | venture diary    | client diary     | personal diary |

**"Vault" is not a type.** It is the confidential *cells* of a scope (primarily the per-client column). Treating vault as a type collapses the distinction between sensitivity and content-kind, which is exactly the conflation the two-axis model corrects.

**`soul.md`** = the operator meta-identity (Arn / Hermes) at global scope. Per-context identity lives inside each scope — so the locked operating-model decision "identity is per-context, never global" (OM-3) holds: the global file is the *operator's*, not any context's.

**The shared knowledge graph** = the union of all non-confidential knowledge cells, cross-linked across scopes. This is the cross-pollination mechanism: a pattern learned in one venture can be retrieved in another without duplicating facts.

*Walling (MEM-3–7) and retrieval (MEM-15) are covered by sibling decision files; referenced here only to orient the two-axis model in context.*

---

### 3. Store of record = owned distilled wikilinked markdown + git (MEM-10)

**Decision:** the brain is markdown files we own + git for history, rollback, and audit. Local-first, no cloud DB (explicitly: no Turso or equivalent) as store of record. The retrieval engine is a swappable cache on top.

**Pros:**
- **Ownership and portability.** No vendor lock-in on the data layer. The files are readable, editable, and movable without an API.
- **Git reversibility.** Every rewrite, merge, or deletion is recoverable. Rollback is `git revert`, not a support ticket.
- **Engine is swappable.** The retrieval engine (AnythingLLM, MEM-15) ingests the owned markdown and provides embeddings + semantic search. If a better engine appears, swap it; the data stays.
- **Distillation is forced.** Resources must be compressed to durable facts before entering the brain (principle: "distill, don't dump"). This is easier to enforce with markdown files authored by a reconciler than with a DB that accepts raw inserts.

**Cons / acknowledged costs:**
- No native query language. Complex cross-node queries require either wikilink traversal or the retrieval engine — there is no SQL.
- Migration is manual. Schema changes require per-node lazy migration (tracked by `schema_version` field); no DB ALTER TABLE.
- Graph integrity is not enforced by a constraint system — the reconciler and frontmatter validation carry that responsibility.

**Note:** the retrieval engine (AnythingLLM) is explicitly *not* the store of record. It is a cache. If it is wiped, no knowledge is lost — the reconciler re-ingests from markdown.

*Ingestion mechanics and path topology are covered by sibling decisions MEM-13, MEM-14, MEM-16–18.*

---

### 4. Write-safety = append-only staging inbox + single-writer reconciler (MEM-8)

**Decision:** no agent writes canonical nodes directly. All agents append observations to a session-anchored staging inbox. A single reconciler is the sole writer of canonical nodes.

**The problem this solves:** concurrent direct writes from multiple agents produce contradictions, partial updates, and merge conflicts in git. Shared-file locking at the agent level would serialize the fleet, be fragile, and still leave no mechanism for fact-checking or cross-linking.

**The solution — two tiers:**

**Tier 1 — Staging inbox (agents write here only):**  
Each agent appends observations to its own session-anchored lane in the staging area. Appends never collide because each agent owns its lane. Format: Haiku summarizes each turn into dated bullets, tagged with a session anchor (provenance) and an immutable `substrate` tag (`shared` | `vault:<scope>`). Append-only; no agent deletes from staging.

**Tier 2 — Single reconciler (sole canonical writer):**  
One reconciler (the compaction / overnight "dreaming" agent) reads staging, fact-checks, cross-links, rewrites nodes, and runs GC. It is the only process that touches canonical nodes. This unifies write-safety and self-improvement into a single component.

Git sits underneath: all canonical writes are git commits. Git plumbing (add/commit/push) is Haiku tier by policy (MEM-12).

**Pros:**
- No write collisions between agents.
- Fact-checking and cross-linking happen once, consistently, not per-agent.
- A single audit point for everything that enters the canonical graph.
- Crash recovery is well-defined (see reconciler contract below).

**Cons / acknowledged costs:**
- Latency: an observation written to staging does not appear in the canonical graph until the reconciler runs. For query-time retrieval, staging is a secondary search target.
- The reconciler is a single point of operational failure — if it is broken, new observations accumulate in staging but the graph does not improve. Mitigated by: staging is append-only and never lost; the reconciler is stateless enough to re-run.

---

### 5. Reconciler operational contract (MEM-9)

The reconciler contract was locked in the post-completeness-review hardening pass (adversarial Sonnet panel, 2026-06-19 evening). It specifies:

**Conflict precedence:** source-trust → recency → human-escalation queue. Nodes with higher-trust provenance (e.g., a log entry from a real session vs. a dreaming inference) win conflicts. When precedence is tied, recency wins. When ambiguous, the conflict is queued for human review rather than auto-resolved.

**Two-phase commit:** the reconciler writes the canonical node + performs a git commit, *then* marks the staging entry as consumed using the git hash as the consumed marker. If the reconciler crashes between write and mark, the staging entry remains unconsumed and will be reprocessed on the next run. This guarantees no staging entry is silently dropped.

**Lockfile fencing:** the reconciler acquires a lockfile before reading staging. A second instance (e.g., a manual trigger racing a scheduled dreaming run) sees the lockfile and exits. This prevents double-processing and contradictory concurrent rewrites.

**Instability guard:** before committing a rewrite of an existing node, the reconciler checks three signals. If any exceeds its threshold — citation count drops significantly, centrality rank shifts substantially, or cluster membership flips — the rewrite is held for human review rather than auto-committed. This prevents dreaming-induced degradation of high-centrality nodes.

**`fact` vs `inference`:** a node claiming `fact` type requires a citation (log-entry git hash or URL). Without one, it is auto-downgraded to `inference`. This enforces provenance discipline at write time.

**`soul.md` routing:** mutations to `soul.md` (the operator meta-identity) route through the same staging → reconciler pipeline. No direct writes are permitted. A bad direct write to `soul.md` would corrupt the identity loaded into every future session.

**Subagent write boundary:** subagents write *only* to staging. "Haiku plumbing" means Haiku executes git operations *on behalf of the reconciler* — not that Haiku agents have arbitrary graph-write access.

---

### 6. Node schema (MEM-11)

Each node's frontmatter carries:

`type · fact|inference · centrality · cluster · sensitivity · substrate · scope · schema_version`

- `type` — aligns to the TYPE axis (identity / knowledge / log).
- `fact|inference` — provenance/confidence tier; drives citation enforcement.
- `centrality` — "god-node" ranking; retrieval prioritizes high-centrality nodes.
- `cluster` — community membership label; shrinks the retrieval search space to the relevant neighborhood before full semantic search runs.
- `sensitivity` — walling signal consumed by the retrieval engine and the reconciler's substrate filter.
- `substrate` — immutable provenance tag (`shared` | `vault:<scope>`). Stamped at the write-API boundary, not editable by the reconciler.
- `schema_version` — supports lazy per-node migration as the schema evolves; no centralized ALTER TABLE.

---

## Single-writer ≠ master orchestration agent

This distinction matters and is easy to misread. OM-1 locked: no master conductor agent; the fleet coordinates via shared memory + Kanban board + the human (peers, stigmergic). MEM-8 introduces a single reconciler as the sole *memory writer*.

These do not conflict. The reconciler is infrastructure — a specialized process with a narrow mandate (compact staging into canonical nodes). It does not dispatch tasks to other agents, does not hold orchestration authority, and does not observe the Kanban board. Agents coordinate laterally; the reconciler runs independently on its own schedule. The single-writer property is a concurrency-safety invariant on the storage layer, not an orchestration topology.

---

## Rejected alternatives

**Folder tree for knowledge.** Rejected because cross-domain links require duplication in a tree, and duplication causes drift. A node cannot have two parents without copying. (MEM-1)

**Single-axis memory slots (e.g., agentmemory's 8-slot model).** Rejected because it conflates TYPE and SCOPE. Most of its slots are not identity: `tool_guidelines` → skills `## Rules`; `project_context` → retrieval-pointed volatile data; `pending_items` → Kanban/log; `session_patterns` → reconciler dreaming output. At most, sub-fields `persona · user_preferences · guidance` are relevant *inside* an identity node. (MEM-2, DESIGN.md §13)

**Cloud DB (Turso) as store of record.** Rejected. Ownership, portability, and git reversibility outweigh query convenience. The retrieval engine is bought, not built — a DB would be a third dependency in the critical path with no clear ownership boundary. (MEM-10)

**"Vault" as a memory type.** Rejected. Vault = confidential cells of a scope. Treating it as a type collapses the sensitivity dimension into the content-kind dimension, breaking the two-axis model and making it impossible to express "confidential identity" vs "confidential knowledge" as distinct things. (MEM-2, Blocker 2 hardening)

**NotebookLM as store of record.** Rejected. NotebookLM = Google infrastructure. Client data is walled — it never crosses to a third party. NotebookLM is now dropped entirely (TOOL-1); AnythingLLM runs fully local. Even under the earlier design, NotebookLM was a retrieval cache on top of owned markdown, never the source of truth.

**Direct writes from agents.** Rejected. Concurrent direct writes produce contradictions and git conflicts with no natural resolution point. The staging + single-writer model was chosen specifically to avoid per-agent locking schemes, which would serialize the fleet and still provide no fact-checking. (MEM-8)

---

## Nuances, caveats, open threads

**Staging latency is real.** An observation written during a session does not appear in the canonical graph until the reconciler runs (typically overnight / scheduled). If a subsequent session needs that observation immediately, it must search staging as a secondary source. The retrieval layer (MEM-15) handles this by including staging in its search scope. The exact TTL / trigger mechanism for reconciler runs is a build-time spec (currently open).

**Instability guard thresholds are not yet specified.** The reconciler contract names three signals (citation-drop, centrality-delta, cluster-flip) but does not specify numeric thresholds. These are deferred to the build phase (DESIGN.md §13 backlog).

**Dreaming trust rank is lower.** Nodes generated by the reconciler's overnight "dreaming" pass (graph inference, pattern synthesis) carry lower trust than nodes derived from log entries with real citations. The exact ranking mechanism is deferred.

**`schema_version` migration functions** are specified as a requirement (keyed `from→to`, in-repo, tested, lazy-on-read) but not yet written. This is non-blocking for the design; it must exist before the schema changes for the first time.

**Staging growth cap mechanics are open.** The contract says: block and warn when staging exceeds a cap — never silently drop. The exact cap and the block mechanism are deferred.

**GC deletion aggressiveness** (how eagerly the reconciler deletes vs supersedes) is a runtime policy deferred to build (OPEN-2 in DECISIONS.md).

---

## Sources

- `~/.cockpit/DECISIONS.md` — MEM-1, MEM-2, MEM-8, MEM-9, MEM-10, MEM-11 (primary decision trail)
- `~/.cockpit/memory-engine/DESIGN.md` — §2 core principles, §3 two axes, §4 storage + node schema, §5 write model + reconciler contract (integrated spec)
- `~/.cockpit/STATE.md` (HEAD) — "Memory architecture — designed" section + "Post-completeness-review hardening" subsection (Blocker 2 + reconciler contract origin)
- `~/.cockpit/log/2026-06.md` — "2026-06-19 — MEMORY deep dive → design closed + hardened" entry (chronological narrative of the session where these decisions were made)
