---
topic: the visionary dreaming layer — autonomous cross-graph synthesis + association-surfacing
decisions: [MEM-31]
relates: [MEM-17, MEM-27, MEM-28, MEM-29, MEM-20, MEM-30, MEM-24, MEM-23]
status: locked (design) — build pending
date: 2026-06-26
---

# The Visionary Dreaming Layer — Decision Analysis

> The generative/associative half of MEM-17 mode-2 "dreaming" that the built `--reflect`
> pass (MEM-27/29) does **not** do. `--reflect` today consolidates (dedup / self-heal); it
> never *connects* nodes or *infers* net-new insight. This layer adds both — links-first.

## TL;DR

The knowledge graph is, in practice, **unlinked**: 3 resolving cross-node wikilinks across 106
nodes. It captures, consolidates, projects, and recalls — but it never surfaces the association
between two distant nodes, and never synthesizes a net-new insight from combining them. The
visionary pass closes that gap. It borrows Generative Agents' reflection mechanism (focal-point
questions → insights that cite the nodes backing them), runs **cross-scope** over the clean
post-consolidation pool, stores associations in a reconciler-owned **`knowledge/links.json`
sidecar** (not node bodies — that would re-fire the cost guard), mints net-new insight nodes
stamped **`source: dreaming`** (auto-applied, no review queue — git is the undo, MEM-28), and
folds into the nightly `--reflect` pass with a **non-dreaming-only fingerprint** so it can't
mint forever. Every production memory system auto-applies autonomous memory with no review
gate and no trust tier — so cockpit's `source: dreaming` tag is *more* conservative than the
field, and it's the one cheap defense against autonomously-generated nodes compounding through
future consolidation.

---

## The problem

A self-growing graph has a third failure mode beyond "never fills" and "rots": it can fill with
*disconnected* nodes — true, well-distilled, but inert, because nothing relates them. That is
exactly where the cockpit graph sits.

Ground truth at design time (2026-06-26, 106 nodes):

- Only ~18 nodes carry any `[[ ]]` at all, and of every distinct wikilink target used, **only 3
  resolve to a real node id** (`arnaldo-root-identity-source` ×12, plus two). The rest point at
  *documents* (`[[STATE.md]]`, `[[MEM-25]]`, `[[BUILD-4]]`) that are not graph nodes — they are
  model-authored decoration the distiller invented, dangling.
- The reconciler computes **zero** node-to-node associations. `stageNew` passes no links;
  `bodyWithLinks` only wraps what the distiller already put in prose.
- This is why DESIGN §6a.3 degree-centrality / community recompute is deferred ("24 links / 44
  nodes → topology algos = noise") — the link layer the topology needs does not exist.

So the cross-pollination MEM-23 explicitly sanctions, and the "one coherent body of work" north
star, are both unrealized: Boring Scale, content, job-search, and cockpit knowledge sit in
separate piles that never meet.

## What the built `--reflect` does vs. what was specified

`--reflect` (MEM-27/29) is **compressive and corrective, not generative**: distill new staging →
consolidate/fold paraphrases → self-heal drift among existing nodes → project. It never invents
net-new knowledge and never links.

MEM-17 mode 2 and DESIGN §8 specified more than that — "the dream **cross-links (finding
relationships across the graph)**, surfaces **suggestions unprompted**", output tagged
`source=dreaming` at lower trust to a pending-review queue. That associative/generative half was
named but never built. This layer is it.

---

## The design

**Hook.** A new phase inside `--reflect` (C4), after consolidation has committed the clean node
pool (PHASE 1/2), before projection. It reads the *post-consolidation* graph so it links/synthesizes
over clean nodes, and its outputs then flow into projection (G4) and recall (MEM-30).

**Mechanism — Generative Agents reflection (Park 2023), the Phase-2 find.** Three steps, no graph DB:

1. **Focal points** — a cheap pass picks a few salient anchors (recently-changed nodes + their
   high-centrality neighbors). Generative Agents' literal prompt: *"what are the [N] most salient
   high-level questions we can answer about the subjects grounded in the statements?"*
2. **Retrieve** — per focal point, `searchScored()` pulls the semantic neighborhood from the
   warm embedding cache (cosine, brute-force, MEM-24 — no vector/graph DB). This keeps each
   `judge` call bounded *regardless of graph size* — the reason to retrieve-per-question rather
   than dump the whole pool.
3. **Insight + links in one call** — one `judge('hard')` over each neighborhood returns insights,
   each citing the node-ids that back it (Generative Agents: *"insight (because of 1, 5, 3)"*).
   **The citations are simultaneously the new insight and its cross-links** — synthesis and
   association in a single call.

**Cross-scope (G1).** One synthesis phase over the whole pool, not per-scope. The objections to
cross-scope mostly dissolved under scrutiny: candidate-space "explosion" is a non-issue at ~100
nodes with retrieval-gated neighborhoods; confidentiality is void (MEM-23 sanctions free
cross-pollination in the main VM); recall noise is floored by cosine ≥ 0.35 (MEM-30). The one
real question — **what `scope` a cross-cutting node gets** — resolves cleanly: a synthesis node's
scope = its backing nodes' shared scope, or **`global`** when they span scopes (global =
cross-cutting knowledge, MEM-2). Within-scope-only-v1 was rejected because it defers the headline
value (the Boring Scale ↔ content ↔ north-star connections).

**Trust (C2).** Auto-applied — **no pending-review queue** (honors MEM-28; the literal MEM-17
"pending-review" spec is set aside). But every autonomous output is stamped **`source: dreaming`**
(+ `claim: inference`, since pure synthesis has no captured-turn citation). The tag is purely
*machine-legible* and buys three things no production system has:
1. future **consolidation treats dreaming nodes as lower-trust input** (never authoritative
   backing) — the anti-compounding guard;
2. recall / INDEX can mark or down-rank them;
3. `grep source: dreaming` audits the entire autonomous footprint in one command.
No human gate; git is the undo (MEM-10/14/28).

**Links sidecar (G3) — wire this correctly.** Associations live in a reconciler-owned
**`knowledge/links.json`** edge-list, *not* in node bodies or frontmatter. The deciding factor is
the cost guard: a link written into a real node's frontmatter would bump that node's `updated`,
shift the non-dreaming fingerprint, and **re-fire the pass every night**. A sidecar leaves real
nodes untouched — no prose churn, no instability-guard interaction, no fingerprint churn — and is
naturally bidirectional. This matches what external systems converged on independently (mem0's
separate `entity_store` / `linked_memory_ids`; Generative Agents' separate `filling` list). Full
wiring contract → DESIGN §6a.5. **Existing in-body links are PORTED into the sidecar, not left
alone** (revises an earlier sub-decision — leaving them would create a second link home against
DOC-1): a one-time migration at first build ports body `[[ ]]` targets that resolve to a live node
into `links.json` (`source: ported`) and strips them from the bodies; non-resolving targets
(`[[STATE.md]]`, `[[MEM-25]]` — distiller decoration) are dropped and logged in the migration audit.
The sidecar becomes the single link home; the steady-state pass never rewrites bodies (the port is
a bootstrap step).

**Cadence + saturation (C4/G2).** Folded into nightly `--reflect`. Because synthesis *adds* nodes,
which would shift the reflect fingerprint and re-fire forever, the visionary trigger fingerprints
**non-dreaming nodes only** — a stable real graph yields no new dreaming output even though prior
dreaming nodes changed the overall pool. The judge is also handed the existing edges + dreaming
nodes in each neighborhood, so it never re-proposes an association already present.

**Projection (G4).** `source: dreaming` nodes are **eligible to project** to the always-load layer
under the *existing* gates — centrality floor (0.6) + adversarial gate + 3-run graduation streak +
MEM-28 instability guard. No special exclusion. A strong autonomous insight can graduate to
CLAUDE.md/SOUL over 3 nights; this is the widest blast radius in the design, accepted because the
gates hold and graduation is reversible (and demotion is deterministic on node-state).

**Budget (G5).** Start **≤2 synthesis nodes + ≤5 links per scope per run**, tunable constants;
loosen after reading a week of audit diffs. The cap forces quality-over-quantity (the model picks
its best few, like Generative Agents' "prefer few high-quality"), bounds judge cost, bounds graph
growth, and limits compounding risk. Conservative-start because it auto-applies nightly and won't
be eyeballed every run.

---

## External research (Phase 2 — the goldmine)

Four systems, code-grounded. The recurring finding: **everyone auto-applies autonomous memory;
nobody human-gates it; nobody tags trust tiers.** Cockpit's `source: dreaming` + auto-apply is
therefore slightly more conservative than the entire field — the right posture for a long-lived
personal graph.

### Generative Agents (Park et al. 2023) — the portable synthesis mechanism

The only one of the four that does true net-new synthesis, and it ports almost 1:1.

- **Reflection trigger:** an importance-sum gate — accumulated poignancy (1–10 per memory) crosses
  150 → reflect.
- **Synthesis:** focal-points prompt (*"[3] most salient high-level questions"*) → retrieve →
  insight prompt (*"[5] high-level insights … (because of 1, 5, 3)"*). Output hard-capped at
  3 × 5 = **≤15 nodes/cycle**.
- **Cross-linking:** explicit — each reflection stores `filling` = the resolved evidence node-ids,
  plus a `depth` field (0 = observation, 1 = reflection, 2 = reflection-over-reflection). Not a
  graph DB; IDs as data on the node.
- **Trust:** none — reflections score identically to observations in retrieval; `depth` is
  informational; no human review.
- Source: https://arxiv.org/abs/2304.03442 ; https://github.com/joonspk-research/generative_agents

**Borrowed:** the focal-point→insight-with-citations loop (synthesis + links in one call); the
node-cap budget shape; `depth`/provenance as precedent for the `source: dreaming` tag.
**Set aside:** the importance-sum accumulator — cockpit's reflect fingerprint + MEM-22 salience
already gate firing.

### Zep / Graphiti — the cross-linking reference (infra-incompatible)

A temporal knowledge graph: entity extraction → typed fact edges → LLM dedup/resolve →
bi-temporal `valid_at`/`invalid_at` → Leiden/label-propagation community-summary nodes.

- **Net-new synthesis:** yes — community nodes carry LLM-generated summaries over a cluster.
- **Cross-linking:** explicit typed edges (`EntityEdge`/`EpisodicEdge`/`CommunityEdge`) in Neo4j;
  `episodes[]` backlinks for provenance.
- **Contradiction:** `resolve_edge` returns `duplicate_facts` + `contradicted_facts`; a contradicted
  edge gets `invalid_at` set, old fact retained for audit.
- **Trust/review:** fully autonomous; the bi-temporal model *substitutes* for a review gate.
- Source: https://arxiv.org/abs/2501.13956 ; https://github.com/getzep/graphiti

**Incompatible:** the Neo4j graph DB (MEM-24 = brute-force in-process, no DB) and the bi-temporal
schema (supersede + git already cover contradiction). **Borrowed as a later idea:** community-summary
nodes — but parked until cockpit clustering is real (MEM-24 deferral).

### mem0 — extract+dedupe, explicitly NOT synthesis

ADD/UPDATE/DELETE/NOOP over extracted atomic facts (v2); ADD-only in v3 with `linked_memory_ids`.
Confirmed: "no cross-memory synthesis step." A SQLite history table is the undo; no trust tiers,
no queue, auto-apply. mem0g (graph variant) = Neo4j triplets (incompatible, MEM-24).
- Source: https://arxiv.org/html/2504.19413v1 ; https://github.com/mem0ai/mem0

**Mostly validates cockpit's *existing* consolidation (MEM-27).** Contribution: `linked_memory_ids`
as a *separate link payload* — confirms G3's sidecar over body-rewrites.

### Letta / MemGPT — validates the offline-synthesis frame

Self-editing memory via function calls; the **sleeptime agent** runs a background agent that
`rethink_memory`s the primary agent's blocks offline ("discard outdated, integrate new"). The
sleep-time-compute paper shows offline pre-reasoning cuts live-session compute ~5×. No cross-linking
(flat archival + prose blocks); no trust tiers; auto-apply.
- Source: https://arxiv.org/abs/2310.08560 ; https://www.letta.com/blog/sleep-time-compute ;
  https://arxiv.org/abs/2504.13171

**Borrowed:** external endorsement that synthesis belongs in the offline nightly pass (C4), and a
compute-savings argument for why the layer earns its cost.

---

## Rejected / set aside

| What | Why |
|---|---|
| Graph database for the edge layer (Graphiti/Neo4j, mem0g) | Conflicts MEM-24 (brute-force in-process, no vector/graph DB). Keep edge-as-data, drop the DB. |
| Frontmatter / body link storage | Bumps real nodes' `updated` → re-fires the cost guard; body-rewrite churns the distiller's prose + trips the instability guard (G3). |
| Pending-review queue for dreaming output | The literal MEM-17 spec, but contradicts MEM-28's no-standing-queue lock. Provenance tag + git-undo substitutes. |
| Within-scope-only v1 | Cost fear overblown at ~100 nodes; cross-scope is the headline value matching the north star (G1). |
| Bi-temporal validity schema (Graphiti) | `supersede` + git already cover contradiction (MEM-9/14/27). |
| Community-summary synthesis nodes (Graphiti) | Needs real clusters; MEM-24 defers clustering. Later synthesis flavor. |
| A second importance-accumulator trigger (Generative Agents) | The reflect fingerprint + MEM-22 salience already gate firing. |
| Excluding `source: dreaming` from projection | Chose G4 = eligible under existing gates; the gates + reversibility are sufficient. |

---

## Sources

| Source | Contributed |
|---|---|
| DECISIONS MEM-17 / DESIGN §8 | The named-but-unbuilt mode-2 dreaming this completes |
| DECISIONS MEM-27 / MEM-29 | What `--reflect` actually does (consolidate, not synthesize) + the cost-guard pattern extended |
| DECISIONS MEM-28 | No standing review queue; git is the undo; always-load instability guard |
| DECISIONS MEM-20 / MEM-30 | Projection (G4) + recall as the dreaming nodes' delivery channel |
| DECISIONS MEM-24 / MEM-23 / MEM-2 | No DB; cross-scope sanctioned; scope = organization (global for cross-cutting) |
| Live graph audit (2026-06-26) | 3 resolving cross-node links / 106 nodes — the unlinked-graph finding |
| Generative Agents (arXiv 2304.03442 + repo) | Focal-point→insight-with-citations synthesis mechanism; node-cap budget |
| Zep/Graphiti (arXiv 2501.13956 + repo) | Cross-linking + contradiction reference (infra set aside) |
| mem0 (arXiv 2504.19413 + repo) | Extract≠synthesis; `linked_memory_ids` separate-payload pattern |
| Letta/MemGPT (arXiv 2310.08560, 2504.13171; sleep-time blog) | Offline-synthesis frame + compute-savings argument |
