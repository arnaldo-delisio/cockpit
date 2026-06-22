---
topic: Memory retrieval engine selection
decisions: [MEM-15, MEM-24, TOOL-1]
related: [MEM-10, MEM-19]
status: engine pick superseded by MEM-24 (real-machine smoke-test 2026-06-22); spine + frame stand
amended_by: MEM-23
date: 2026-06-21
---

# Retrieval Engine: minimal in-process stack chosen (was AnythingLLM); NotebookLM dropped

> **Superseded 2026-06-22 (MEM-24) — engine pick only.** The real-machine smoke-test picked a **minimal in-process Node stack** over AnythingLLM (see *Resolution* below). The decision *frame* is unchanged — local engine, owned-markdown spine, swappable cache — only the which-engine answer flipped. The AnythingLLM analysis below is retained as the trail.
>
> **Amended 2026-06-22 (MEM-23):** the "isolated workspaces per substrate / per-client vault" walling rationale below is **retired** — there is one shared graph, one workspace. (A check-pass also found AnythingLLM workspaces are namespaces in a shared DB, not a real security boundary — moot under VM isolation.) Removing multi-workspace isolation removed AnythingLLM's main structural draw, which is what tipped the smoke-test to the lighter stack.

## TL;DR

**The retrieval engine is a minimal in-process stack (MEM-24):** `@huggingface/transformers` (`all-MiniLM-L6-v2` ONNX, local) + `Float32Array`+JSON cache + **brute-force cosine** (no vector DB) + ripgrep + RRF — `require`d in-process by the reconciler, no Docker/daemon/GUI. It beat AnythingLLM on a real-machine smoke-test once MEM-23 removed the multi-workspace need. NotebookLM stays dropped (TOOL-1). The store of record is owned markdown; the engine is a swappable cache on top — losing it means losing convenience, not knowledge.

## Resolution — smoke-test → minimal in-process stack (MEM-24, 2026-06-22)

MEM-15 named AnythingLLM but flagged a real-machine smoke-test as the gate, and explicitly invited weighing a simpler direct-ONNX stack once MEM-23 removed the multi-workspace need. A research agent + a real smoke-test on the actual laptop closed it.

**Machine facts that reframed it:** no Docker/Podman installed (AnythingLLM = Docker *or* Electron desktop app only); ~6 GB free RAM (heavy persistent app/daemon is costly); corpus is tiny (20 files / 256 KB / 36k words today, hundreds→few-thousand small nodes over years); GPU irrelevant (ONNX embedder is CPU). With workspaces gone (MEM-23), AnythingLLM was a heavyweight app whose remaining features (GUI, chat, workspaces) we don't use.

**The chosen stack (MEM-24):**
- **Embedding:** `@huggingface/transformers` v4.x running `Xenova/all-MiniLM-L6-v2` (ONNX), `allowRemoteModels=false` after first ~23 MB download → zero-network. **Not** `@xenova/transformers` (deprecated, 2yr stale).
- **Storage:** flat `Float32Array` + JSON metadata sidecar; re-embed only on content-hash change. No vector DB.
- **Search:** brute-force cosine (vectors normalized → dot product). **No ANN index** — unjustified below ~50k vectors.
- **Keyword (L1–L2):** ripgrep. **Fusion:** MEM-19 RRF (k=60), ~20 lines.
- **Wiring:** the reconciler (Node) `require`s it in-process. No server, daemon, GUI, or Docker.

**Smoke-test results (real machine, Node v26, 2026-06-22):**
- Installs + runs on Node v26; **native ORT backend confirmed** (not slow WASM fallback) — the one UNVERIFIED risk, killed.
- **Retrieval quality: 4/4 real-corpus queries returned the exactly-correct node** (incl. subtle ones — MEM-22 sentinels, the VM trust boundary, the CLAUDE.md projection fence).
- **Latency:** ~9–11 ms warm (query embed + scan). **RAM:** 93 MB baseline → 234 MB after model load → 747 MB worst-case full corpus re-embed in batches of 8 (steady-state ~234 MB; reconciler embeds only changed nodes). *(An 8 GB RSS spike appeared only when embedding all 280 chunks in a single padded batch — an artifact no incremental path hits.)*

**Scaling envelope:** ~1.5 KB/node vector + ~0.2 µs/node scan. Brute-force stays interactive (<30 ms total query) to **~50k–100k nodes** — roughly 20–100× the plausible 5-year ceiling. RAM only binds at ~2–3M nodes. If ever exceeded, an ANN index (sqlite-vec / LanceDB) drops in *as a cache* — the owned-markdown spine never moves.

**Rejected at the smoke-test:** AnythingLLM (heavyweight app; Docker/Electron; no embeddable Node-library path → must run a sidecar daemon); Open Notebook (SurrealDB process + active CVEs); sqlite-vec & LanceDB & hnswlib (ANN unneeded at our scale; sqlite-vec also pre-1.0, Node v26 binding unverified); txtai / Chroma (Python server); LlamaIndex.TS (deprecated; framework, not a retrieval primitive). NotebookLM stays out (TOOL-1) — MEM-23 dissolves only its *confidentiality* objection, not the no-API / not-owned / wrong-output-shape ones.

---

## Context / The Problem

The memory architecture (MEM-10) established that the brain is owned, distilled, wikilinked markdown under git — local-first, no cloud database as store of record. That settled *what* the knowledge lives in. What remained open was *how to retrieve it semantically*: the markdown corpus is too large to load into every session context, so semantic search across it requires a dedicated engine.

The retrieval layer covers a 5-level taxonomy of query types: exact match (L1), topic/keyword (L2), semantic/vector (L3), relationship-chain (L4), and graph-inference (L5). The engine decision addresses the semantic tier (≈L3); relationship-chain and graph-inference are handled separately by wikilink traversal over the owned markdown. Three candidates were evaluated for L3: AnythingLLM, NotebookLM, and Open Notebook.

A second framing constraint shaped the decision: the memory architecture walls client vaults from the shared knowledge graph (§6 of DESIGN.md). Any retrieval engine must be capable of maintaining isolated workspaces per substrate — the shared graph and each `vault:<scope>` must never be commingled at the index level, enforced at the write-API boundary, not by prompt discipline.

## Options Considered

### AnythingLLM

AnythingLLM is a local, self-hosted RAG platform (MIT license, most actively maintained at time of decision). It runs as a Docker container exposing a full REST API, which means the reconciler can push nodes programmatically without manual UI interaction.

The critical technical property is its native ONNX embedder: it ships `all-MiniLM-L6-v2` via ONNX Runtime (~86 MB), requiring no Ollama, no separate model server, no PyTorch. On the hardware in question — 13 GB RAM, ~3.6 GB free, RTX 3050 4 GB VRAM — this matters: there is no RAM headroom for a second heavyweight process. The ONNX path keeps embeddings 100% local with a tiny memory footprint.

Because everything runs locally, the Google leak surface for retrieval disappears entirely. Client vault content that is semantically searched never touches a network path.

Workspace isolation maps cleanly to the substrate model: the shared knowledge graph gets one AnythingLLM workspace; each `vault:<scope>` gets its own. The engine enforces the substrate boundary at the index level.

**Pros:** zero-network ONNX embedder (fits RAM-tight laptop), full REST API (reconciler-automatable), MIT, active, 100% local (kills cloud leak surface), workspace isolation maps to substrate model.

**Cons:** self-hosted Docker operational overhead; needs a real-machine smoke test before integration can be confirmed (RAM-tight environment is the key unknown); UI-first design means REST API is the integration surface rather than a native library.

### NotebookLM

NotebookLM is Google's hosted AI notebook product. It was considered because it has an Audio Overviews feature (generates podcast-style summaries) and was already partially in scope for other purposes.

Three passes of research (sourced from the log, 2026-06-21 cont 2) produced a consistent verdict: NotebookLM is strictly dominated for this use case.

**No official API.** Integration requires UI-scraping clients. Google's 2026 UI redesign broke `add_source` in active third-party clients at the time of evaluation — the integration surface was actively broken.

**Re-auth treadmill.** The Google OAuth session expires every 2–4 weeks, requiring manual re-authentication. This makes any automated retrieval pipeline fragile by design.

**Not training-safe.** Consumer and Plus tiers of NotebookLM are not confirmed training-safe for client data. Using it for vault retrieval would create a leak path to Google.

**Quality unbenchmarked.** There is no basis in the project docs to claim NotebookLM's retrieval quality is competitive with a local vector store — it was never benchmarked against the actual use case.

**Only edge was Audio Overviews.** This is a useful feature but not a retrieval feature — it doesn't address the semantic search problem at all. It didn't justify accepting a fragile, cloud-dependent, potentially-leaky dependency.

Decision: dropped entirely (TOOL-1). Not used anywhere.

### Open Notebook

Open Notebook is an open-source alternative to NotebookLM. It was evaluated as a runner-up and came closer than NotebookLM.

What held it back: it carries SurrealDB as a dependency (operational overhead, database upkeep) and had active CVEs in its dependency tree at the time of evaluation. The combination of a heavier operational profile and unresolved security issues made it lose to AnythingLLM's cleaner stack.

**Status in decision:** named fallback only. If AnythingLLM fails the real-machine smoke test (i.e., it can't run within the available RAM), Open Notebook is the designated substitute. This is a verification step held at build time, not an open architectural choice — the frame (local engine, owned-markdown spine, swappable cache) holds either way.

### context-mode (Role Clarification)

context-mode is an in-session context-window protection tool. It was never a candidate retrieval engine but needed an explicit ruling to prevent scope creep.

The ruling (MEM-15): context-mode is **session hygiene only**. Its keyword KB and auto-memory are not a store of record. Canonical notes are never indexed into context-mode. The one-brain rule is: AnythingLLM + reconciler + owned markdown.

This distinction was sharpened by a live incident: during the session that closed this decision, a `ctx_purge` was considered and aborted. The purge would have been all-or-nothing and would have wiped 450 sessions of persistent memory plus active session hygiene — an irreversible loss. The incident confirmed that context-mode's state is operationally fragile and must not be treated as canonical.

## Decision and Why

**AnythingLLM** is the single retrieval engine for both the shared knowledge graph and all vaults. (MEM-15, locked 2026-06-21.)

The load-bearing reasons, in order:

1. **RAM constraint.** The laptop runs ~3.6 GB free RAM. The ONNX embedder path (~86 MB, no Ollama, no PyTorch) is the only viable local embedding approach at this memory budget. Any alternative requiring a separate model server would exhaust available RAM.

2. **Zero network for retrieval.** 100% local execution eliminates the Google leak surface for retrieval entirely. Client vault content — which must not cross to third parties — can be semantically searched without any network path. This is a hard security property, not a preference.

3. **REST API enables automation.** The reconciler (the component that pushes markdown nodes into the engine) needs a programmable integration surface. AnythingLLM's REST API provides this; manual UI workflows would break the pipeline.

4. **One engine for both layers.** Running a single engine in isolated workspaces (one per substrate) is simpler than running two engines with a cross-engine query layer. Complexity is deferred to workspace management, which is tractable.

5. **Engine is swappable.** The store of record is owned markdown (MEM-10). The retrieval engine is a cache built on top of it. If AnythingLLM is replaced, the knowledge is not lost — the markdown survives and can be re-indexed into any successor. This keeps lock-in low and makes the choice less consequential than it would be if the engine were the store.

## Rejected Alternatives

### NotebookLM (TOOL-1)

Dropped entirely. The failure modes stack: no official API (actively broken by Google's 2026 redesign at decision time), 2–4 week re-auth cycle, not confirmed training-safe for client data, retrieval quality unbenchmarked. The one differentiating feature (Audio Overviews) is not a retrieval feature. A dependency this fragile and cloud-bound cannot serve as retrieval infrastructure for a system with client confidentiality requirements.

### Open Notebook

Runner-up. Closer to AnythingLLM than NotebookLM, but lost on operational weight (SurrealDB dependency) and active CVEs. Retained as the named fallback for the smoke-test scenario only.

### Running Two Engines

Not explicitly evaluated as a named option in the source material; the design chose one engine for both layers precisely to avoid this. The walling requirement is met by isolated workspaces within one engine, not by separate engines per substrate.

## Nuances, Caveats, Open Threads

**Smoke test gates integration.** AnythingLLM has not yet been verified to run within the available RAM on the real machine. The smoke test is the first step of the build pass that integrates retrieval. If it fails, Open Notebook is the fallback — the decision frame stays the same. This does not block earlier build steps because the store of record (owned markdown) is engine-independent.

**Clean start — no legacy migration.** The new graph starts empty. All auto-learned memory from prior setups (context-mode auto-prefs, native `MEMORY.md` auto-entries) was made under the old/wrong configuration and is untrusted. Only deliberately hand-authored, currently-correct notes carry forward, by hand. The salvage audit (BUILD-3) covers all memory substrates and `CLAUDE.md` files.

**context-mode walling flag.** context-mode's auto-memory is a cross-project store. Before any client is onboarded, context-mode's auto-memory must be disabled or scope-bounded to prevent cross-project bleed. This is currently dormant but is a build-time requirement, not optional cleanup. Also flagged: upgrade context-mode from 1.0.107 to 1.0.162 as part of the build.

**Freshness model.** Owned markdown is truth; the engine is a cache. Re-sync is triggered after each reconciler commit; per-document `last_synced` tracking; queries against a stale window should be flagged. TTL policy is in backlog.

**Tiering for token discipline.** At query time, retrieval follows a hot-cache → master-index → deep wiki progression (~40K token baseline). Evergreen knowledge lives in the graph and is retrieved by vector search; volatile/live data (project state, client meeting notes) is pointed-to, not ingested into the engine.

## Sources

- `STATE.md` (HEAD at 2026-06-21) — "RETRIEVAL ENGINE — DECIDED" bullet, "Reconcile memory systems — UPDATED 2026-06-21", "Hot-cache / master-index tiering" in §7
- `log/2026-06.md` — entry "2026-06-21 (cont 2) — Retrieval engine decided: AnythingLLM in, NotebookLM out"
- `DECISIONS.md` — MEM-15 (retrieval engine), TOOL-1 (NotebookLM dropped), MEM-10 (store of record)
- `memory/DESIGN.md` — §7 (Retrieval), §6 (Walling), §11 (Reconciling the 3 prior systems)
