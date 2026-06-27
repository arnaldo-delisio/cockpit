# Cockpit Memory Layer — Canonical Design

**Status:** design closed + hardened (2026-06-19; refreshed 2026-06-21 for the AnythingLLM / ingestion-model decisions; 2026-06-22 for the CLAUDE.md-projection decision, MEM-20; 2026-06-22 blocking-spec lock — concrete build formats in §6a; 2026-06-22 walling layer retired — isolation moved to the VM boundary, MEM-23; 2026-06-22 retrieval engine = minimal in-process stack after real-machine smoke-test, MEM-24 supersedes MEM-15's AnythingLLM pick). **BUILT + LIVE** — all 5 phases 2026-06-24; nightly dreaming (MEM-29) 2026-06-24; ambient read-path recall (MEM-30) 2026-06-25; visionary association-linker v1 (MEM-31) 2026-06-26. The per-decision build trail lives in DECISIONS + `log/`.
**Source of decisions:** `~/.cockpit/DECISIONS.md` (MEM-*, TOOL-*, BUILD-*). This doc is the integrated spec of *how the memory layer works*; DECISIONS holds the choice-by-choice trail + rejected alternatives; `log/` holds the chronology.
**Scope of this doc:** the memory layer only. Tools, skills, `~/CLAUDE.md` orchestration, and the Hermes↔Claude handoff are separate deep dives.

---

## 1. Purpose

One memory substrate that a **fleet of agents** — Hermes capability-agents (content, job-apps, …), the Claude Code builder, and their Sonnet/Haiku subagents — all read and write, **without drift.** Knowledge cross-pollinates freely; confidential client data is isolated at the VM boundary, not inside the graph (MEM-23).

---

## 2. Core principles (locked)

- **Graph, not tree.** Knowledge is a unified, cross-linked, self-improving graph (Karpathy "LLM OS"). Retrieved by search, not by folder path.
- **Own the substrate.** Store of record = distilled, wikilinked **markdown we own** + git. No third party holds the brain.
- **Buy retrieval, run it local.** A swappable local engine sits *on top of* the owned markdown — embeddings + retrieval 100% local, no third party in the retrieval path. The engine is a **minimal in-process stack** (MEM-24): `all-MiniLM-L6-v2` ONNX embeddings + brute-force cosine + ripgrep + RRF, `require`d by the reconciler — no server/daemon.
- **Isolation is structural, not in-graph.** Confidentiality is enforced at the VM boundary (one trust domain per VM, MEM-23), never by in-graph tags or prompt instruction. The main graph is one non-confidential trust domain.
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

- **SCOPE is organization, not a wall** (MEM-23) — it marks *who a node is about*. Confidential clients are isolated by VM, not by an in-graph "vault" cell.
- **Shared knowledge graph** = the union of all knowledge cells in the VM, cross-linked across scopes. This is what cross-pollinates.
- **`soul.md`** = the **operator meta-identity** (Arn / Hermes) at global scope. **Per-context identity lives inside each scope** — so "identity is per-context, never global" holds: the global file is the *operator's*, not any context's.

---

## 4. Storage & ownership

- **Store of record:** distilled wikilinked markdown files + **git** underneath (history, rollback, audit). Local-first, embedded — no cloud DB (no Turso) for the store of record.
- **Format stance:** Cockpit's native format is intentionally close to the emerging Open Knowledge Format (OKF) pattern — markdown + YAML frontmatter + links + git-friendly directories — but not constrained by it. OKF validates the "format, not service" choice; Cockpit keeps its own richer node semantics (`scope`, `audience`, `claim`, `centrality`, projection lifecycle, reconciler-owned fields) and may later add an OKF-compatible export/import mapping rather than rewrite the internal schema.
- **Git boundary (OSS-1, Option D 2026-06-23):** the *system* lives in the **public cockpit repo** — `~/.cockpit/memory-engine/` (code: bootstrap, capture, reconciler) + `memory-engine/DESIGN.md` (this spec) + `skills/`. The *data* lives in `~/.cockpit/memory/` as its **own standalone private git repo** (identity, logs, staging, sources, `knowledge/`) — the cockpit repo gitignores `memory/` wholesale, so the public history is data-free, and the data repo is the reconciler's two-phase-commit target (§5). `memory-engine/bootstrap.mjs` recreates the data tree on a clone.
- **Layout (MEM-13):** knowledge graph = one flat pool `~/.cockpit/memory/knowledge/nodes/` (scope = node frontmatter, master-index over the pool); memory substrate = centralized `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,sources}/`. `sources/` = raw capture layer (§8). Each project's co-located `CLAUDE.md` carries a one-line pointer to its scope.
- **Graph structure** = wikilinks (`[[ ]]`, Obsidian-navigable) between markdown nodes.

### Node schema
`type · fact|inference · centrality · cluster · scope · schema_version`

- `fact|inference` — provenance/confidence. A `fact` node **requires a citation** (log-entry hash or URL) or is auto-downgraded to `inference`.
- `centrality` — "god-node" ranking; drives retrieval priority.
- `cluster` — community membership; shrinks retrieval search space.
- `scope` — organization (which venture/client a node is about); not a security boundary (MEM-23).
- `schema_version` — for lazy migration as the schema evolves.

**Concrete file format → §6a.1** (this list is the conceptual schema; §6a.1 is the implementable YAML+prose template + the field-ownership split).

**Tagging / vocabulary (MEM-21).** Tags + entity labels (concepts/people/products) are **free-form at capture**; the reconciler **normalizes synonyms into an emergent canonical vocabulary** (no hand-authored fixed taxonomy). Semantic retrieval (§7) + emergent `cluster`s + wikilinks make a controlled vocab unnecessary — the reconciler maintains *coherence* (the real need) as part of its self-improvement pass (§10). Revisit only if retrieval underperforms.

---

## 5. Write model — staging + single reconciler

Concurrent writes to shared files corrupt and contradict. Solution: **nobody writes canonical nodes except one reconciler.**

1. **Agents append** observations to a **session-anchored staging inbox** — append-only, each agent owns its lane, so appends never collide. Format: Haiku summarizes each turn → bullets → date-partitioned files tagged with a session anchor (provenance) + scope.
2. **One reconciler** is the **sole writer** of canonical nodes and runs in two tempos: lightweight ingestion bookkeeping continuously at capture boundaries, and the heavy distillation / synthesis pass nightly. It reads staging/logs/sources → fact-checks → cross-links → rewrites → GC.
3. **Git underneath** for history/rollback. Git **plumbing** (add/commit/push) = **Haiku tier**; git **judgment** (rare by design) escalates.

This **unifies write-safety and self-improvement into one component** (the reconciler). A single-writer-for-memory is infrastructure, not an orchestration master — the "no master agent" rule (agents coordinate via a shared Kanban board) still holds.

### Reconciler operational contract
- **Conflict precedence:** source-trust → recency → human-escalation queue.
- **Two-phase commit:** write canonical + git commit, **then** mark staging consumed (git hash = consumed marker). Crash recovery = re-run from last unconsumed entry.
- **Fencing:** acquire a lockfile before reading staging; a second instance exits. (Prevents dreaming + manual run racing.)
- **Instability guard (narrowed — MEM-28, supersedes MEM-9's human-review default):** a risky rewrite (citation-drop / centrality-delta / cluster-flip / supersede) is guarded ONLY on an **always-load-eligible** node (behavioral type, centrality ≥ projection floor); anything else applies (memory is git-versioned — git is the undo). For an always-load risky change the reconciler's **LLM adjudicates** apply-vs-escalate (default apply; infra failure fails safe → escalate), and only a genuine contradiction / evidence-loss / removal of a still-valid rule reaches `pending-review/`. The human is not the default reviewer; that queue is near-empty by design.
- **soul.md** mutations route through the **same** staging→reconciler pipeline (no direct writes — a bad direct write would corrupt every future session).
- **Subagents write ONLY to staging.** "Haiku plumbing" = git ops on behalf of the reconciler, **not** arbitrary graph-write access.

### Consolidation pipeline (MEM-27)

How the reconciler turns staging into canonical nodes — **LLM-semantic consolidation ("reflection")**, replacing the original per-proposal cosine→merge mint path (cosine can't separate same-rule from different-rule for terse behavioral nodes; no `SIM_MERGE` cutoff works — MEM-27). Embeddings stay for retrieval + cache warmth (§7); they no longer gate the mint path.

1. **Distill** (one `judge('hard')` per work-unit, MEM-18 altitude): near-raw staging digest → candidate nodes (title/prose/type/centrality/cluster/tags/entities + `source_turns`). INCLUDE evergreen knowledge / standing behavioral rules / identity; EXCLUDE build & session mechanics (phase status, handoff, "do X in a fresh chat" → log chronology, not graph). Many small, reliable calls; this is the **only** place prose is authored.
2. **Group** (`groupForConsolidation`, size-triggered): one judge call fits → one group = the whole scope (the case today, always). Scope overflows the input budget → split by the distiller's `cluster` label; a single label still overflowing = the **sub-cluster seam, DEFERRED** (needs real edge-data; would contradict MEM-24 — supersede it deliberately if/when filled). Whole-scope input is load-bearing: cross-label synonyms must meet in one call to fold.
3. **Consolidate** (one `judge('hard')` per group): handed the group's existing canonical nodes + the new candidates, returns the grouping decisions — `action: keep | update | new | supersede` (+ `backing:[candidate-idx]`, `supersedes:[ids]`, `centrality`, `cluster?`). Fold paraphrases into one node, merge new into existing where restated, keep genuine distinctions, flag contradictions as supersede; echo every existing id exactly once.
   - **Compact-decisions (MEM-27 amendment):** the consolidate reply is **decisions only — NO prose** (the full-prose set overflowed the model's single-reply ceiling on a large scope: ~30 nodes × prose in one array truncates mid-array → unparseable). The reconciler **assembles** each final node: a `new` folded node takes its highest-centrality backing candidate's prose/title/type (tie → lowest idx), tags/entities unioned across all backing; an `update` keeps the existing node's prose. Prose authored only by the distiller; the consolidator judges grouping only — bounding the reply to a few KB of ids/numbers. (Chunking the scope by cluster to shrink the call is **rejected** — it scatters label-synonym dups where they never fold. Incremental neighbor-compare is **deferred** to thousand-node scale, a drop-in like MEM-24's ANN swap.)
4. **Guard + commit:** every `update`/`supersede` passes the instability guard, **narrowed per MEM-28** — a risky change is held only when it hits an always-load-eligible node, and then the reconciler's LLM (not the human) adjudicates apply-vs-escalate; everything else applies (git is the undo). An existing node the consolidator never names is **kept unchanged** (conservative-keep). Provenance survives the merge: `citation` ← backing candidates' source-turns (`stg:<anchor>:<sha8>`, so fact-vs-inference holds), `audience` ← operator if any backing came from a Hermes work-unit (else builder), `centrality` ← the consolidator's cross-evidence number. Then two-phase commit (above) + INDEX regen + retrieval-cache sync + projection (below).

**`source: dreaming` anti-compounding (deferred — only bites once synthesis exists, MEM-31 v2).** v1 produces no dreaming *nodes* (link-only), so consolidation needs no special handling yet. If synthesis is built (v2): when consolidation is handed a node with `source: dreaming`, it must treat it as **lower-trust** — never fold a real captured node *into* a dreaming node, never let a dreaming node be the authoritative survivor of a merge. This must be **enforced in code**, not just by the prompt (adversarial catch #2): the consolidate prompt is handed each node's `source`, but a deterministic post-step rejects any update that would absorb a captured node into a dreaming one.

**Two tempos, one engine:** on-write (`node reconcile.mjs` — new staging consolidated against existing) and nightly (`--reflect` — consolidate a scope's existing nodes with NO new staging, self-healing accumulated drift/dups; matters more now that it rewrites existing nodes, so the guard gates it too). The visionary association-surfacing pass (§8 mode 2b / MEM-31, **v1 link-only**) runs as a distinct phase *after* this consolidation commits, before projection — **BUILT + LIVE (2026-06-26)**: `visionary.mjs` (`surfaceAssociations`) + `links.mjs` (the `knowledge/links.json` sidecar), folded into nightly `--reflect`. The nightly tempo is **LIVE** (MEM-29): a systemd USER timer (`cockpit-reconcile.{service,timer}`) runs `reconcile.mjs --reflect` at 04:00 local, installed clone-clean by `bootstrap.sh`/`dream.sh`; a per-scope skip-unchanged fingerprint (`state.reflect`) makes idle nights cost 0 judge calls. On-write stays manual. **Depth:** `decisions/ingestion-and-curation.md` (MEM-27) + MEM-29.

### Reconciler runtime (MEM-25)

The reconciler is a **standalone, brain-neutral Node process** — the single-writer of a substrate both brains share, owned by neither (a Hermes-owned reconciler would reintroduce a master, against OM-1). It `require`s the retrieval engine in-process (§7, MEM-24). Triggered by a timer (nightly heavy pass) + on-demand (continuous light pass). Its model calls go through a single swappable **`judge(prompt, tier)`** adapter that shells out to **`hermes -z "<prompt>" -t ''`** (only-completion-text stdout; `-t ''` disables tools) from a **dedicated reconciler `HERMES_HOME`** (`~/.cache/cockpit-reconciler`, its own git root, used as `HERMES_HOME` + `cwd`) that holds a neutral SOUL, no memory, and no `hooks:` block — this is what keeps `judge()` brain-neutral (the `--ignore-rules` flag is a **no-op in the oneshot path**, so isolation can't rely on it; MEM-25 brain-neutrality amendment 2026-06-24). Rides in-plan Codex OAuth (no per-token billing, MR-1). **Tiered, both in-plan Codex (extends TOOL-3):** `tier:'hard'` (distill→node, conflict resolution, centrality) → **`gpt-5.5`**; `tier:'bulk'` (triage, classify, summarize) → **`gpt-5.4-mini`**. If the shared Codex 5h/week window throttles, offload the most trivial bulk to **local Gemma** (MR-1 tier 2 — free/off-meter/private), never OpenRouter/Gemini. **Adapter router as built (2026-06-25):** `judge.mjs` dispatches by the `JUDGE_ADAPTER` env var — **default `judge-claude.mjs`** (Claude Code CLI, subscription: `hard→claude-opus-4-8` / `bulk→claude-sonnet-4-6`, brain-neutral via `--system-prompt` + a neutral cwd); `JUDGE_ADAPTER=hermes` selects `judge-hermes.mjs` (the Codex / `hermes -z` path described above), which the nightly `dream.sh` exports. So the Claude adapter is now the operational **default**, not a future swap. Model *family* is a measure-then-tune call, not a lock. (`hermes proxy`/Nous was rejected: it fronts only nous/xai, cannot reach Codex — see MEM-25 revision.)

### Projection to CLAUDE.md (MEM-20)

The reconciler is also the **sole writer of the "managed regions" of CLAUDE.md files** — the always-loaded layer is a *projection* of memory, not a separately hand-maintained doc. (Memory is *retrieval-gated*; CLAUDE.md is *always-loaded* via the cwd→`/` merge. Behavioral rules only bite when always-loaded, so the few that matter get promoted out of the retrieval-gated graph into the always-load layer.)

- **What promotes:** high-`centrality` behavioral nodes only — `type ∈ {identity, feedback}` (operating rules). Facts/`knowledge` stay retrieval-gated and never promote.
- **Gate + cap:** `when_to_use` + an adversarial structure/accuracy lens decides survivors; the BUILD-4 `## Rules` 10–15 cap keeps the always-load layer thin (BUILD-2).
- **Determinism + lifecycle (amendment 2026-06-23):** because the gate is a non-deterministic LLM call, the fence has two graduated layers — **Emerging** (the gate's volatile, *sticky* pick) and **Durable** (rules that survived the gate N=3 consecutive reconciles, then held by a counter + node-state and no longer re-judged; auto-demoted when the source node is superseded / falls below floor). The hand skeleton stays the human-only deterministic anchor; promotion is automatic (no human gate). Lifecycle state lives in `memory/.reconciler/projection-state.json`. **Full contract → §6a.4.**
- **Routing by (scope × audience) (mandatory):** a node promotes only into the canonical always-load file of *its own scope and audience*, reached via the loader trick. **Builder** routes (the default): global → `shells/CLAUDE.md` (the `~/CLAUDE.md` loader `@`-imports it, not the loader itself); cockpit → `~/.cockpit/CLAUDE.md` (load-point already in-repo); data scopes (project/venture/client) → `memory/scopes/<x>/CLAUDE.md` in the PRIVATE memory repo, with `~/projects/<x>/CLAUDE.md` a thin hand-written loader importing it. **Operator** routes (audience minted from the `brain:` stamp, MEM-20 audience-axis amendment): `operator+global` → `shells/SOUL.md` (the operator shell, symlinked from `~/.hermes/SOUL.md`); `operator+non-global` → **no route** (the node mints into the graph but does not always-load — GA2, scope-naive routing accepted for v1). System scopes project public (cockpit repo), data scopes private (memory repo); the reconciler commits only repos it owns — never a foreign project/client repo. Preserves BUILD-2/OM-6 (the global root that loads in every session stays free of scope-specific rules; operator rules never inherit the builder skeleton, which doesn't load into Hermes sessions).
- **One home (DOC-1):** the graph node is the home; the CLAUDE.md block is a **generated, fenced projection** (`<!-- managed:reconciler -->`), never hand-edited. The hand-authored skeleton (BUILD-2) lives in a separate block of the same file. Edit the rule → edit the node → next reconciler run refreshes the projection.

This is the **self-evolving-CLAUDE.md mechanism** — one distiller (the reconciler), not a second external miner, so `headroom learn` is retired (TOOL-2). **Concrete fence contract → §6a.4.** Depth: `decisions/claude-md-projection.md`.

---

## 6. Trust boundary = the VM (MEM-23)

Confidentiality is enforced at the **VM boundary**, not inside the graph. One trust domain per VM: the main VM holds only non-confidential work in one fully-shared graph (no `substrate` tag, no `vault/` dirs, no per-scope read-keys or engine-workspace isolation). A confidential client gets a **separate VM running a clone of the same cockpit**, organized when it arrives (OPEN-7) — not designed now.

**The security model is data-flow discipline:** confidential data never leaves its VM — no shared graph, no shared semantic index, no shared git remote, no copy-paste back into the main cockpit. The VM is only as good as that discipline. The only forward-looking cost paid now is keeping the cockpit **clone-clean** (no hardcoded paths, secrets out of the tree, deps pinned) so the future VM is isolation-by-construction.

*Why this replaced intra-graph walling: an in-process tag is fragile (one missing filter = cross-tenant leak); a VM is a structural boundary, zero-leak by construction. The split-substrate machinery was load-bearing complexity for a confidential client who doesn't yet exist (YAGNI). Full trail: `decisions/walling.md` (superseded).*

---

## 6a. Locked build formats (node · bootstrap · CLAUDE.md fence)

The concrete byte-level formats that realize **MEM-11 / MEM-13 / MEM-20** — the specs that had to be locked before paths can be laid (STATE pre-crystallization checklist item 3, 2026-06-22). Conceptual decisions stay in §4/§5/§6; this section is the implementable contract. *(The substrate-tag spec was deleted with the walling layer — MEM-23.)*

### 6a.1 Node template (realizes MEM-11)

One markdown file per node in the flat pool `knowledge/nodes/<id>.md`. **Filename = `id` = wikilink target** (`[[<id>]]`) — same kebab-slug convention as the existing `MEMORY.md` index. YAML frontmatter + distilled-prose body:

```markdown
---
id: <kebab-slug>            # = filename; the wikilink target
title: <human title>
type: knowledge | identity | feedback   # feedback = behavioral lesson the reconciler mints from MEM-22 markers
claim: fact | inference     # `fact` REQUIRES `citation` else reconciler downgrades to inference (MEM-9)
scope: global | cockpit | <venture> | <client> | personal   # organization, not a wall (MEM-23)
audience: builder | operator   # reconciler-owned; minted from capture brain-stamp (hermes→operator, else builder); only projection consumes it — routes operator+global → SOUL.md (MEM-20 audience-axis amendment)
centrality: 0.0-1.0         # reconciler-computed; drives retrieval priority + CLAUDE.md promotion
cluster: <emergent-label>   # reconciler-assigned community
tags: [free-form]           # emergent, reconciler-normalized (MEM-21)
entities:                   # free-form labels, reconciler-normalized
  concepts: [...]
  people: [...]
  products: [...]
citation: <stg:SESSION:SHA8 | url>  # required iff claim: fact (else reconciler downgrades to inference)
source: capture | dreaming  # reconciler-owned provenance; default capture (legacy/missing reads as capture). v1 mints NO `dreaming` nodes (link-only, MEM-31). `dreaming` is reserved for the DEFERRED net-new synthesis (v2): machine-legible lower-trust marker (anti-compounding, code-enforced), `type: knowledge` only, NEVER projection-eligible, always `claim: inference`. Add `source` to the node FIELD_ORDER (adversarial catch #10). (v1's only provenance use is the `source: ported` field on `links.json` EDGES, §6a.5 — not nodes.)
schema_version: 1
created: <ISO8601>
updated: <ISO8601>          # reconciler
last_synced: <ISO8601>      # retrieval-engine cache freshness (§7)
---

<distilled prose — clean enough for the engine to embed (§13 RRF requires clean node prose).>

Links: [[other-node]], [[another-node]]
```

**Ownership split.** Capture/staging stamps **mechanically**: `scope`, `created`, the raw provenance (`session_anchor` + `transcript:` path), and the `brain:` stamp (per-file; sessions are single-brain). The reconciler (sole writer, §5) owns everything else — `centrality`, `cluster`, `tags`/`entities` normalization, `claim`, `citation`, `audience` (minted from the `brain:` stamp; default `builder`), `source` (default `capture`; set `dreaming` only by the visionary pass, §8 mode 2 / MEM-31), `updated`, `last_synced`. Agents never hand-set centrality/cluster/audience/source.

**Citation token [2026-06-23, build].** A claim distilled from a captured staging turn cites it as **`stg:<session_anchor>:<sha8(turn-text)>`** — a stable, verifiable coordinate into the raw transcript (the staging header carries the `transcript:` path; the sha8 pins the exact turn). The reconciler mints it from the backing turn the distiller names; a node with **no** backing turn (pure synthesis) carries no citation and is `inference` (MEM-9 downgrade). A real log-entry-hash scheme can supersede this once `logs/` is populated — the `claim` semantics ("is this backed by a captured moment?") are unchanged.

**`feedback` nodes.** Behavioral lessons (corrections, confirmed approaches) are minted by the reconciler from MEM-22 salience markers (`#good`/`#bad` sentinels + inferred correction/decision spans) — not hand-typed at capture. They are the projection input for MEM-20 alongside `identity` nodes.

### 6a.3 Bootstrap (realizes MEM-13; graduates the §13 cold-start items)

One **idempotent** operation lays the tree (safe to re-run; creates only what's missing):

```
~/.cockpit/memory/
├── knowledge/
│   ├── nodes/          # flat pool — all scopes; scope lives in frontmatter
│   └── INDEX.md        # master index, reconciler-generated (§7 tier: hot cache → INDEX → deep wiki)
├── scopes/
│   ├── global/{identity,log,staging,sources}/        # shared knowledge scope
│   ├── cockpit/{identity,log,staging,sources}/
│   └── <scope>/{identity,log,staging,sources}/       # one per entry in memory/scopes.json
└── scopes.json                                       # gitignored — private scope list (OSS-1)
```

- **Seed set = the live scopes** listed in `memory/scopes.json` (gitignored; falls back to `['global', 'cockpit']` when absent — bootstrap prints a hint on how to add scopes). Dormant ventures/clients are materialized by the **same idempotent function** at re-onboarding (OPEN-7) — never blanket-seeded (clean-start, MEM-15). Private scope names never appear in the public repo.
- **No `vault/` dirs** — intra-graph walling is retired (MEM-23); the whole VM is one trust domain.
- **`INDEX.md`** = reconciler-generated master index: high-`centrality` god-nodes grouped by `cluster`, one-line summary + `[[wikilink]]` each. Regenerated each run; never hand-edited.
- **Append-only bootstrap mode** until ≥1 centroid node per cluster exists — the reconciler runs capture+append only (no GC, no heavy rewrite) so it doesn't thrash a near-empty graph. Seeds: `soul.md` (global identity) + a per-scope identity stub.
- **Demo scope** (`scopes/demo/`) — seeded by bootstrap alongside the live scopes; contains 2 fictional staging files + 1 pre-baked §6a.1 node. Never in `scopes.json` → excluded from the nightly dreaming pass. Cloner verification path: `node reconcile.mjs --scope demo` (exercises the full distill→consolidate→project pipeline without real data). Delete when no longer needed.

### 6a.4 CLAUDE.md projection fence (realizes MEM-20)

The reconciler's managed region inside any target `CLAUDE.md`. **Three layers, two of them inside the fence** (the determinism + lifecycle model, MEM-20 amendment 2026-06-23):

```
## <hand skeleton>            ← human-authored, OUTSIDE the fence; the reconciler never writes it
<!-- managed:reconciler:begin schema=2 inputs=<gateSig> -->
## Rules (projected from memory — do not edit; edit the source node)
### Durable (auto-graduated — survived N+ reconciles; held until superseded)
- <rule text> [[source-node]]
### Emerging (volatile — promotes to Durable after N consecutive reconciles)
- <rule text> [[source-node]]
<!-- managed:reconciler:end -->
```

- **Strict fence discipline.** The reconciler reads/replaces ONLY the bytes between `:begin` and `:end`; everything outside (the BUILD-2 hand-authored skeleton — the deterministic always-load anchor) is never touched. No fence present → append one at EOF after a blank line. Present → full-replace the interior (idempotent).
- **Why the lifecycle.** The gate is an LLM call → its membership flips on *borderline* nodes, and a pure `inputs=` damping would freeze whichever set it landed on. So inside the fence rules graduate: **Emerging** = the gate's volatile pick, made **sticky** (last run's set fed back: keep unless clearly wrong → hysteresis); a rule the gate keeps `GRADUATE_AFTER` (=3) consecutive reconciles **auto-graduates** to **Durable** and is thereafter held by a counter + node-state, not re-judged each run. Promotion = the gate's *repeated* judgment; a counter sets the timing — automatic, no human gate, no second LLM boundary.
- **Demotion** is deterministic, never an LLM guess: a Durable rule drops when its source node is superseded or falls below the centrality floor (it leaves the eligible-candidate set). Git is the undo.
- **Backlink per rule** (`[[source-node]]`) — the node is the home (DOC-1); the block is a regenerable cache. Durable rules join the gate's dedup context so a graduated rule is never re-proposed into Emerging.
- **State is the home of the lifecycle:** streaks · graduated set · last-emerging · gate-signature, per scope, in `memory/.reconciler/projection-state.json` (committed, sibling of `state.json`). The fence is a pure render of it, so the CLAUDE.md diff only moves when membership moves. Gate damping: the gate is re-run only when its inputs (gate-candidates + skeleton + last emerging) change; otherwise last run's set is reused and streaks still advance.
- **Cap** ≤ BUILD-4's 10–15 `## Rules` total (Durable + Emerging); Durable earns its place first, Emerging fills the remainder; over-cap → highest-`centrality` wins, the rest stay retrieval-gated; the audit diff (§10) records drops (no silent truncation).
- **Scope routing.** A node projects ONLY into its own scope's canonical always-load file: global→`shells/CLAUDE.md` (public; via the `~/CLAUDE.md` loader); cockpit→`~/.cockpit/CLAUDE.md` (public, load-point in-repo); data scopes→`memory/scopes/<x>/CLAUDE.md` (PRIVATE memory repo, loaded by a thin `~/projects/<x>/CLAUDE.md` loader). Foreign project/client repos stay pristine — the reconciler writes only the cockpit + memory repos it owns. [2026-06-23 build: loader-indirection + public/private split resolved.]
- **What projects.** Only behavioral nodes (`type ∈ {identity, feedback}`) project; facts/`knowledge` stay retrieval-gated and never promote.
- **Reserved escalation:** quorum / best-of-N the gate, if a future multi-scope load makes the Emerging boundary flip again. Not built now (YAGNI).

### 6a.5 Links sidecar (realizes MEM-31 cross-linking) — BUILT + LIVE 2026-06-26 (`links.mjs` / `visionary.mjs`)

The cross-link surface for the visionary pass (§8 mode 2b) — and in **v1 the pass's ONLY output**
(net-new synthesis nodes are deferred, MEM-31). Associations between nodes live in a
**reconciler-owned edge-list `knowledge/links.json`** — NOT in node bodies or frontmatter. The
choice is load-bearing and must be wired exactly as below.

**Why a sidecar, not frontmatter/body (the wiring rationale).** A link written into a real node
would bump that node's `updated`, which shifts the MEM-29/MEM-31 **non-dreaming fingerprint** and
re-fires the visionary pass every night (runaway minting). A sidecar leaves real nodes byte-stable
on a link-only change → **no fingerprint churn, no prose churn, no instability-guard interaction**,
and it is naturally bidirectional. (External precedent: mem0 `linked_memory_ids`, Generative
Agents `filling` — both store links as separate data, not in the memory's text.)

**Shape.** A JSON array of undirected association edges; endpoints are node ids:

```json
[
  { "a": "<node-id>", "b": "<node-id>", "source": "dreaming",
    "note": "<one-line rationale>", "created": "<ISO8601>" }
]
```

- `a`/`b` are existing `knowledge/nodes/<id>.md` ids (the wikilink targets). Undirected (associative);
  store the pair sorted so `(a,b)` is canonical and dedup is trivial.
- `source` marks edge origin: `dreaming` (visionary pass) | `ported` (migrated from a pre-existing
  in-body `[[ ]]` link, see migration below) | room for future `manual`/`distiller` links.
- `note` is the synthesis rationale the `judge` emitted (why these two relate) — human-auditable.

**Wiring (single-writer, MEM-8/9 — only the reconciler touches it):**
- **Candidate selection (adversarial catch #7):** because the graph has ~no existing links to
  traverse, association candidates are **semantically-proximate node pairs** (`searchScored()`
  neighborhoods), NOT graph neighbors. Bias toward under-linked high-centrality nodes + nodes
  recently changed; include a starvation breaker so a stable graph still gets explored once. (Exact
  anchor count / scoring = a build-prompt tunable.)
- **Append:** the visionary pass adds an edge only if (a) both endpoints exist and are not
  superseded, and (b) the canonical pair is not already present (so it never re-proposes an
  association already there — part of the §8/G2 saturation guard; the judge is also handed the
  neighborhood's existing edges as context).
- **Prune:** each run drops any edge whose endpoint id is missing or `superseded` — keeps the edge
  set consistent with the live pool (the one maintenance cost of the sidecar; runs in the pass that
  already iterates the pool).
- **Commit boundary (adversarial catch #5 — DONE 2026-06-26):** `links.json` lives under
  `knowledge/`, so it rides the **PHASE-1 canonical commit** (`gitCommit(..., ['knowledge/'])`, §5)
  — the same two-phase, lockfile-fenced write as the nodes. It is part of the canonical graph, not a
  derived cache (unlike the embedding cache, which is gitignored). **The PHASE-1 commit now fires
  when nodes OR `links.json` changed** — a link-only run persists; node writes + INDEX + links
  commit as one atomic `knowledge/` transaction (the accepted edge set is computed, every endpoint
  validated against the live pool, written, then `knowledge/` committed). On lock-acquire, refuse to reconcile over a **dirty canonical tree**
  (`git status --porcelain` on `knowledge/` → recover/abort first) so a crash mid-write can't leave
  a node without its link or a link without its endpoint.
- **Read path:** this is the real **L4–L5 relationship/wikilink-traversal layer** (§7) the graph
  has lacked — `INDEX.md` and ambient recall (MEM-30) may traverse it to surface neighbors, and it
  is the edge-data that finally unblocks the deferred degree-centrality / community recompute
  (§6a.3) — though building that topology stays deferred until link density is real.

**Net-new synthesis nodes are DEFERRED out of v1** (post-adversarial-review, MEM-31 amendment).
v1 writes only edges (above) — no autonomous *nodes*. If synthesis is ever built (v2), each
synthesis node is an ordinary `knowledge/nodes/<id>.md` stamped `source: dreaming` (§6a.1), `type:
knowledge` only, **never projection-eligible**, depth-capped (≥2 non-dreaming backing), recorded as
edges here to its evidence. Not in scope now.

**One-time migration — port existing in-body links into the sidecar (DONE — ran with the first `--reflect` 2026-06-26; idempotent on re-run).** Today links are scattered in node bodies as `[[ ]]` references, mostly distiller
decoration: of every distinct target across the 106-node pool, only 3 resolve to a real node id;
the rest point at documents/decisions (`[[STATE.md]]`, `[[MEM-25]]`, `[[BUILD-4]]`). Leaving them
in bodies would create a second, inconsistent link home (against DOC-1) once `links.json` exists,
so they are ported, not left alone:
1. Scan every node body for `[[target]]`.
2. **Resolves to a live node id** → add an undirected `{a,b,source:"ported",created}` edge (canonical
   sorted pair, deduped). **Strip ONLY the reconciler-owned `Links:` suffix line** (adversarial catch
   #6) — the exact `bodyWithLinks` pattern. **Inline `[[ ]]` inside the distilled prose are left as
   plain text / untouched** (the distiller owns prose, MEM-27; rewriting it changes the embed text +
   cache hash). Handle alias `[[id|label]]` and heading `[[id#h]]` forms; skip links inside code
   fences.
3. **Non-resolving** (doc/decision pointer, not a node) → **drop the suffix entry**, recorded in the
   migration audit diff (never silent). External-reference backlinks are out of scope (not node→node).
This is a bootstrap step, not the nightly pass — the bounded suffix-strip is acceptable for a
one-time port; the steady-state pass never rewrites bodies (the whole point of the sidecar). It sets
`updated` once (or a `schema_migrated` stamp) and the visionary fingerprint ignores that one
migration revision. Idempotent: a second run finds no `Links:` suffix left to port.

---

## 7. Retrieval

**Hybrid, complementary by level** (5-level taxonomy: exact → topic → semantic → relationship-chain → graph-inference):
- **Semantic (≈L3):** a **minimal in-process stack** (MEM-24, supersedes MEM-15's AnythingLLM pick) over the owned markdown — `@huggingface/transformers` running `all-MiniLM-L6-v2` (ONNX, zero-network, local) for embeddings, a flat `Float32Array`+JSON cache (re-embed on content-hash change), and **brute-force cosine** (no vector DB — unjustified below ~50k nodes). One shared graph (no per-vault isolation — MEM-23). The reconciler `require`s it in-process — no server/daemon/GUI. A swappable cache → low lock-in (breaks = lose convenience, not knowledge; the spine is engine-independent owned markdown).
- **Relationship / inference (≈L4–5):** **wikilink graph traversal** over the owned markdown.
- **Tiering for token discipline:** hot cache → master index → deep wiki (~40K baseline). Evergreen knowledge → graph; volatile/live data (project state, client meeting notes) → **pointed-to, not ingested**.
- **Session hygiene (separate concern):** context-mode handles in-session context-window protection — it is **not** a memory store of record (MEM-15). Never index canonical notes into context-mode.

**Engine choice (MEM-24, supersedes MEM-15):** the **minimal in-process stack** above — chosen over AnythingLLM at a real-machine smoke-test (2026-06-22) once MEM-23 removed the multi-workspace need that was AnythingLLM's main draw. Smoke-test passed decisively: native ORT backend on Node v26, 4/4 real-corpus queries correct, ~9–11 ms warm, ~234 MB steady RAM. Brute-force stays interactive to ~50k–100k nodes (≫ our scale); an ANN index (sqlite-vec/LanceDB) is a drop-in cache swap only if ever exceeded. NotebookLM dropped (TOOL-1); AnythingLLM + Open Notebook rejected (heavyweight app / SurrealDB+CVEs). Does not block the memory build: the store of record is owned markdown and the engine is swappable on top. **Depth:** decisions/retrieval-engine.md.

**Freshness:** owned markdown is truth, the retrieval engine is cache. Re-sync triggered post-reconciler-commit; per-document `last_synced`; queries in a stale window are flagged. (TTLs in backlog.)

---

## 8. Ingestion — capture + three modes

**Capture layer (`sources/`, MEM-14).** Each scope has a `sources/` dir: verbatim inputs — transcripts, repo snapshots, docs, pastes — frontmattered (`type · title · source · captured · session_anchor · scope · status · distilled_into · concepts/people/products`), fully search-indexed so nothing is ever invisible. **Capture = intent, no engagement gate** — everything autosaves (`/watch` autosaves here), **scope-tagged** (mechanical — from the input's origin + the session's scope; organization not security, MEM-23). The **dream judges depth** by reading (full cross-linked node / one-line stub / leave-in-raw) — reading comprehension is the filter, no engagement metric; a wrong call self-corrects (find raw by search later → next run promotes). Memory is **freely mutable; git is the undo** — no tombstone ceremony, no scheduled space-GC (MEM-14, supersedes §10's tombstone language).

1. **On-demand RAG = ambient recall** — pull at query time, automatically. **[BUILT + LIVE in both brains — MEM-30, 2026-06-25.]** Knowledge/fact nodes never project (MEM-20), so this is their ONLY route back into a live session. **Automatic ambient** recall, read-only (never writes the graph — MEM-8/9), **decoupled from capture** (TOOL-6), precision-biased (silence beats noise — MEM-27), marked + killable (`COCKPIT_RECALL=off`). **Mechanics (MEM-30):** a brain-neutral core `recall.mjs` + thin per-brain readers — Claude `recall-hook.mjs` on `UserPromptSubmit→additionalContext`, Hermes `recall-hermes.mjs` on the `pre_llm_call` shell hook→`{"context":…}` (cache-safe user-turn injection). **Two-tier trigger** (evaluate cheaply every turn, inject rarely): a per-turn gate with NO model load (scope-resolves ∧ ≥3 significant terms ∧ ≥1 ripgrep candidate) fires the budgeted cosine pull only when it trips — the scope-open seed is just the first substantive turn. **Precision floor cosine ≥ 0.35** (calibrated: on-topic 0.40–0.59, noise ≤~0.21; uses `searchScored()` since RRF discards scores). **Budget** ≤4 nodes, titles+one-liners, `[[id]]` expands on demand. **Dedup** vs the §6a.4 always-load fence (`projection-state.json`) + a per-session `staging/.recall/` cursor (the only thing it writes — a dot-dir reconcile skips, NOT the graph/cache). Freshness: cache-only reads honor §7 (the reconciler keeps the cache warm; stale/changed-but-unreconciled nodes drop until re-synced). Folded in the Hermes `memory_enabled` flip (DECISIONS TOOL-6). Full spec → DECISIONS MEM-30.
2. **Proactive "dreaming"** — the nightly `--reflect` pass (MEM-29), in two halves:

   **2a. Consolidation [BUILT — MEM-27].** Reads NEW staging since last run, distills to earned depth under the MEM-18 altitude filter, then LLM-semantically **consolidates** against the existing pool (fold paraphrases / merge / supersede) and self-heals drift among existing nodes. This half is *compressive/corrective* — it dedupes and tightens; it does not connect or invent. A cheap pass first gathers the salience-flagged spans (MEM-22: errors, `#good`/`#bad`, corrections, decisions) into a digest so the expensive model judges the digest, not the raw firehose, plus a small unmarked-but-likely-salient sample so forgotten sentinels don't create blind spots. Output writes straight to canonical, gated only by the narrowed instability guard (MEM-28).

   **2b. Visionary association-surfacing [BUILT + LIVE — MEM-31, 2026-06-26; v1 = LINK-ONLY].** The *associative* half — what 2a does not do. After 2a commits the clean pool (before projection), one pass runs **cross-scope** over the whole graph and surfaces **associations between existing nodes** → the `knowledge/links.json` sidecar (§6a.5). Mechanism: pick candidate node pairs by **semantic proximity** (`searchScored()`, warm cache, no graph DB — MEM-24; proximity is the candidate source since the graph started near-unlinked), then one `judge('hard')` call per neighborhood proposes edges, each with a one-line rationale. Edges are **auto-applied — no pending-review queue** (MEM-28; grounded + reversible, git is the undo) and **touch no node bodies and no always-load layer.** Folded into `--reflect` with a saturation guard keyed on the node fingerprint **+ an edge-set hash**; budget ≤16 new links/run (calibrated up from ≤8 after the first watched runs; tunable via `VISIONARY_BUDGET`). A one-time migration ported the existing in-body links into the sidecar (§6a.5).

   **Net-new synthesis nodes (the brain inventing new knowledge from old nodes) are DEFERRED** out of v1 after a cross-family adversarial review (Codex) found they carry nearly all the risk (autonomous guesses laundering onto the always-load layer via the projection streak-timer) and little marginal value on a ~100-node graph. The recording-vs-guess distinction is the line: capture nodes record real turns (cited, `claim: fact`); synthesis nodes manufacture inferences nobody asserted. If synthesis is ever built (v2), it is hard-constrained: `type: knowledge` only, **never projection-eligible**, `source: dreaming`/`claim: inference`, depth-capped (≥2 non-dreaming backing nodes, majority-dreaming rejected), with code-enforced anti-compounding. **Full design + the deferral trail → MEM-31 + `decisions/visionary-dreaming.md`; sidecar wiring → §6a.5.** *(The original mode-2 spec routed all dream output to a pending-review queue at lower trust; MEM-28 retired the standing human queue — for grounded edges the provenance + git-undo substitute, and the riskier synthesis half is deferred rather than queued.)*
3. **Active elicitation ("grill me")** — pull tacit knowledge *out of the human* into the identity/knowledge layer by **relentless one-question-at-a-time interviewing** (recommend an answer per question; if the codebase can answer, look there instead of asking). Checkpoint each answer to structured markdown as you go. Output = discovery nodes + key decisions + Q&A log + **open-flags** (what the human couldn't answer). Open-flags feed the reconciler's **human-escalation queue** (§5). This is the input path for knowledge that no log or resource contains. Packaged as a skill (skills dive). Pattern source: Matt Pocock's `grill-me`.

---

## 9. Logging

- **Automatic via hooks — there is no `/log` skill.** `session_end` + `pre-compaction` hooks capture the session into the scope's log/staging — **near-raw and judgment-free.** Capture *records*, it does not decide what matters. The scope stamp is derived **mechanically from session context** (which scope/project the session ran in), not by reading content. (`pre-compaction` ensures in-session observations aren't eaten by context compaction.)
- **Scope resolution + capture gate (MEM-14 clarified, 2026-06-23).** A session is captured ONLY if it resolves to a real scope, in priority: `COCKPIT_SCOPE` env → mapped cwd (`~/projects/<x>` → `<x>`; `~/.cockpit` → cockpit) → a typed **`#capture` / `#capture:<scope>`** sentinel. An **unmapped cwd is skipped** — no fabricated `global` — so autonomous agents (Hermes, ex-paperclip heartbeats) and incidental sessions in random dirs never auto-enroll. `#capture` is the in-chat opt-in (collision-free like `#good`/`#bad`, MEM-22); it captures the whole session retroactively (the cursor starts at 0).
- **Raw is the source of truth.** Any Haiku summary at capture is a **lossy convenience index, never the only copy** — Haiku here is plumbing (write the file), never judging what's worth keeping (MEM-12). If a cheap summary dropped a buried correction, the reconciler would never see it; so capture preserves raw signal.
- **All recognition + distillation is the reconciler's job** (§5, Sonnet/Opus): it reads the raw record and decides what's a durable rule/fact, frames it, dedupes, sets centrality, and promotes to CLAUDE.md/SOUL.md. Judgment is concentrated in the one place that can afford intelligence.
- **Salience signals (MEM-22).** Capture also emits cheap **mechanical** markers flagging likely-high-value moments for the reconciler to prioritize (it still makes the final call) — four categories: **keep · correction · error · decision**. **Tier 1 = explicit sentinels** the user types — **`#good`** / **`#bad`** — collision-free, deterministic, highest-confidence (the human verdict). They are **priority overrides, not gates**: reviewed first, never auto-promoted on their own, still judged by the reconciler. **Tier 2 = inferred** (the structural + regex signals below), best-effort, and still active whether or not a sentinel was used. **Sentinel absence is neutral, never low-value.** The reconciler's nightly heavy pass must still surface some unmarked-but-likely-salient candidates as a safety-net sweep, so forgotten sentinels do not create blind spots. Grounded in what Claude Code exposes: **errors are structural** (`tool_result.is_error: true` / the `PostToolUseFailure` hook); **keep/correction/decision = regex over verbatim user text** (`UserPromptSubmit.prompt` or transcript `user.message.content`). Detection is pattern-matching, not judgment — consistent with dumb capture. **Detect on `Stop` (per-turn, reliable) + `PreCompact` (before context loss) + `SessionEnd`** — the last has bug #6428 (doesn't fire on `/clear`), so never rely on it alone. Test failures + ESC interrupts are NOT structurally flagged → best-effort only. Affect/tone signals = deferred (feedback-mining mode).
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
- **Retrieval** → the minimal in-process stack (MEM-24) over one shared graph (MEM-23 — no per-vault workspaces).
- **context-mode** → **session hygiene only** (in-session context-window protection), never a store of record. Its keyword KB / auto-memory is not canonical.
- **NotebookLM** → dropped entirely (TOOL-1).

**Clean start — no legacy migration (MEM-15).** The new graph starts empty. All auto-learned memory (context-mode's auto-prefs, incidental native `MEMORY.md` entries) was made under the old/wrong setup → untrusted, discarded, not folded. Only deliberately hand-authored, currently-correct notes carry forward, by hand. The first build pass is the **salvage audit (BUILD-3)** across all memory substrates + `CLAUDE.md` files; any deliberately-kept memory file folds into it.

---

## 12. Multi-agent fleet

- **Builder + operator fleet:** Claude Code (singular builder) + Hermes (a *class* of capability-agents). Both + their Sonnet/Haiku subagents read+write the one substrate.
- **Coordination = shared Kanban board + the human** (stigmergic). No master conductor agent. (Board needs write-locking — backlog.)
- **Model routing:** Opus orchestrates; Sonnet executes (research/bulk/edits); Haiku does mechanical/git-plumbing. Each skill carries its own model binding.

---

## 13. Build backlog (non-blocking specs to finalize during build)

- Retrieval-engine **re-sync TTLs** (triggers post-reconciler-commit).
- `schema_version` **migration functions** (keyed `from→to`, in-repo, tested, lazy on read).
- Reconciler **audit-diff + tombstones** (observability).
- ~~Dreaming **token/node budget + pending-review queue**~~ — **RESOLVED 2026-06-26 → MEM-31** (v1 = link-only association-surfacing: ≤8 links/run budget; NO pending-review queue — grounded edges + git-undo, MEM-28). Net-new synthesis deferred (carries the risk; descoped after the Codex adversarial review). **BUILT + LIVE 2026-06-26** (`visionary.mjs`/`links.mjs`; ≤16 links/run as built).
- ~~**Projection gate determinism**~~ — **RESOLVED 2026-06-23 → MEM-20 amendment + §6a.4** (three-layer fence: human skeleton + auto-graduating Durable + sticky Emerging; counter-driven promotion, deterministic node-state demotion; quorum reserved as the escalation). Built + verified end-to-end.
- Session **heartbeat** for dead-session detection.
- Staging **growth cap** (block + warn, never silent drop).
- Shared **Kanban board write-locking**.
- ~~**Cold-start** bootstrap sequence~~ + ~~exact scope **directory paths**~~ — **LOCKED 2026-06-22 → §6a.3** (idempotent bootstrap, seed-live-scopes, append-only mode, INDEX.md).
- **Hybrid-retrieval merge function** (MEM-19, from agentmemory grading): §7 leaves *how* the ranked lists combine unspecified. Where WE own the merge (engine semantic results × wikilink-traversal results), fuse the already-ranked lists with **RRF — reciprocal rank fusion, k=60** (standard rank-list fusion). Does NOT violate "buy retrieval": the engine still owns embeddings/vector retrieval internally; we only re-rank *across* the lists it returns. Sole requirement on us: each node carries clean distilled prose (the engine ingests it) — we build no vector index ourselves.
- **Identity-node naming — already settled by §3** (node = TYPE × SCOPE grid cell); do NOT adopt agentmemory's flat 8-slot list wholesale — it's the single-axis model §3 rejected, and most slots aren't identity anyway (`tool_guidelines`→skills `## Rules`; `project_context`→§7 volatile/pointed-to; `pending_items`→Kanban/log; `session_patterns`→§8 dreaming output). At most cherry-pick `persona · user_preferences · guidance` as sub-fields *inside* an identity node. Reference only, low priority.

---

## 14. Explicitly deferred (other deep dives)

- **`~/CLAUDE.md` orchestration** — the auto-loaded layer; how CLAUDE.md ↔ STATE ↔ graph ↔ soul.md cross-reference without bloat. Its own deep dive. *(The memory→CLAUDE.md projection mechanism is now decided — MEM-20, §5; the rest of the orchestration stays deferred.)*
- **Tools layer** — MCP/tool topology per brain.
- **Skills layer** — `~/.cockpit/skills/` structure; self-improving skill `## Rules` block; `/watch` visual-ingestion evaluation.
- **Harness auto-upgrade from failures (OPEN-10).** The current reconciler improves the memory graph, `links.json`, and CLAUDE.md/SOUL.md projections; it does **not** mutate skills, workflows, tools, hooks/config, tests/evals, or project loaders. Future harness maintenance may consume memory signals (failures, corrections, `#bad`, repeated tool errors), but it is a separate patch+verification system — not ordinary node consolidation or nightly dreaming.
- **OKF-compatible exchange mapping.** Google Cloud's Open Knowledge Format validates Cockpit's markdown+frontmatter substrate, but OKF is an interoperability/export surface, not the internal schema. Defer a mapper until there is a real need to publish, exchange, or ingest external OKF bundles; likely mapping: Cockpit node id/path → OKF concept id, node title/prose/tags/timestamps → OKF fields/body, Cockpit-specific `scope`/`audience`/`claim`/`centrality`/projection fields retained as extension frontmatter or omitted on export by profile.
- **Hermes↔Claude handoff interface.**
- **Token-optimization** — treated as a cross-cutting thread applied in every layer, not a standalone dive.
