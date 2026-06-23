---
topic: CLAUDE.md as a reconciler-projected always-load layer over the memory graph
decisions: [MEM-20]
status: locked
amended_by: MEM-23
date: 2026-06-22
supersedes_park: TOOL-2 (headroom learn)
---

# CLAUDE.md = Always-Load Projection of Memory

> **Amended 2026-06-22 (MEM-23):** the "vault never projects to a shared-loaded file" / `substrate`-tag passages below are **retired** (no vault under VM isolation). The projection mechanism — reconciler-written fenced managed regions, scope-routed, capped, behavioral nodes only — **stands**.

## TL;DR

The reconciler — already the single writer of canonical memory (MEM-8) — is **also** the writer of the **managed regions** of CLAUDE.md files. It promotes high-centrality *behavioral* nodes from the graph into the always-loaded CLAUDE.md layer, **routed by scope**. Memory stays the home (one fact, one home); the CLAUDE.md block is a generated, fenced projection, never hand-edited. This unifies two things we'd modeled separately — the reconciler and the "self-evolving CLAUDE.md" mechanism — and **retires the external `headroom learn` miner** we'd parked as the candidate impl.

## Context / the problem

Two layers deliver context to an agent on completely different schedules:

- **Memory (the graph)** is *retrieval-gated*: a node only reaches the model if RAG or wikilink traversal surfaces it for the current query.
- **CLAUDE.md** is *always-loaded*: the harness merges every `CLAUDE.md` from cwd→`/` into every session, unconditionally (OM-6).

This matters because **behavioral rules are weak when only retrieval-gated.** "Always pin `model: sonnet` on research subagents" or "verify before you freeze" only change behavior if they're *in front of the model at the moment of acting* — not if they happen to surface when you search for them. The salvage audit made this concrete: `cockpit-working-rhythm` is exactly this kind of doctrine, and as a pure retrieval node it would fire inconsistently.

Separately, the roadmap already carried a **"self-evolving CLAUDE.md"** design input for the deferred CLAUDE.md orchestration dive: *mine sessions → classify candidates → adversarial structure+accuracy lenses → write only survivors → gate with `when_to_use` + caps.* The parked candidate implementation was `headroom learn` (TOOL-2) — an external offline transcript miner.

The insight that closed both: **these are the same machine.** The reconciler already reads raw inputs (logs/staging/sources), fact-checks, cross-links, rewrites, and is scope-aware. Asking it to *also* emit the always-load projection is wiring two existing layers together, not building a third.

## The model

**Memory is the substrate (everything, retrieval-gated). CLAUDE.md is the always-loaded projection of the few in-scope, behavior-critical rules. Promotion memory→CLAUDE.md is the reconciler's job — scope-routed and capped.**

Mechanically:
- **What promotes:** high-`centrality` nodes of `type ∈ {identity, feedback}` only — operating/behavioral rules. Facts and knowledge (`type: knowledge`) stay retrieval-gated; they do not belong always-loaded.
- **Gate:** `when_to_use` + an adversarial structure/accuracy lens (the self-evolving design's lens) decides what survives. Most memory is never promoted.
- **Cap:** the BUILD-4 `## Rules` pattern — a hard 10–15 entry cap — keeps the always-load layer thin (BUILD-2's whole point).
- **Scope routing (mandatory):** a node promotes only into the CLAUDE.md *of its own scope*. Global node → `~/CLAUDE.md`; cockpit node → `~/.cockpit`'s CLAUDE.md; project/client node → that project's co-located CLAUDE.md.
- **Generated, fenced, not hand-edited:** the managed region is wrapped (`<!-- managed:reconciler … -->`). The hand-authored skeleton (BUILD-2) lives in a separate block of the same file. To change a managed rule you edit the *node*; the next reconciler run refreshes the projection.

## How it sits on the locked decisions (it extends, doesn't fight)

- **MEM-8 (single-writer reconciler):** natural extension — one more output of the sole writer. No new writer introduced, so no new write-collision surface.
- **BUILD-4 (`## Rules`, 10–15 cap, reconciler-only promotion):** this *is* that pattern, generalized from skills to CLAUDE.md. We already accepted "reconciler promotes capped behavioral rules into an always-loaded file."
- **MEM-11 (node schema):** the promotion signal already exists — `type` filters behavioral-vs-knowledge, `centrality` ranks. No schema change.
- **MEM-10 / DOC-1 (one fact, one home; engine = cache over owned markdown):** CLAUDE.md becomes *another projection/cache* over the owned graph, exactly as the retrieval engine is. Memory is the single home; the projection can be regenerated and never diverges, because it's never hand-edited.
- **BUILD-2 / OM-6 (thin global root, loads everywhere):** preserved *by the scope-routing constraint* — scope-specific rules never reach the global root. This is the guardrail that makes the whole thing safe rather than a bloat vector.

## Options considered

**A. Keep memory and CLAUDE.md fully separate; hand-maintain CLAUDE.md (status quo).**
- *Pro:* simplest; no feedback loop; CLAUDE.md fully under manual control.
- *Con:* behavioral memory stays retrieval-gated and weak; CLAUDE.md drifts from the graph by hand (the exact STATE/DESIGN divergence DOC-1 was created to kill); the self-evolving-CLAUDE.md goal goes unmet. **Rejected** — leaves the always-load gap open.

**B. Adopt an external miner (`headroom learn`) for the self-evolving CLAUDE.md.**
- *Pro:* off-the-shelf; offline, dry-run by default; writes standard CLAUDE.md/MEMORY.md.
- *Con:* a *second* distiller duplicating reconciler machinery (violates minimalism); imports Headroom's open cross-origin data-disclosure vuln + opt-out telemetry surface (the very reasons TOOL-2 rejected it as core infra); reads all projects' transcripts by default (scope-blind — fights our walling). **Rejected** — our own reconciler does this with no external leak surface.

**C. Reconciler projects to CLAUDE.md, scope-routed (chosen).**
- *Pro:* one distiller; reuses an accepted pattern (BUILD-4); no new writer or schema; no external dependency; behavioral rules get always-on force; scope routing keeps the global root thin.
- *Con:* introduces a session→log→reconciler→CLAUDE.md→session feedback loop (must be damped by the gate + cap + the reconciler's existing instability guard); requires the managed-region discipline to hold (generated-not-hand-edited). *Both costs are bounded by mechanisms we already have.* **Chosen.**

## Guardrails (these are load-bearing, not nice-to-haves)

1. **Scope routing is mandatory.** A leak of cockpit/client rules into `~/CLAUDE.md` would put scope-specific noise (or worse, confidential framing) into every unrelated project session. The reconciler is already scope-aware (MEM-6 substrate tags); promotion inherits that scope.
2. **Generated, never hand-edited.** The managed block is the projection; the node is the home. Mixing hand edits into the managed block re-creates divergence. Skeleton and managed region are visibly separated.
3. **Capped + gated.** `when_to_use` + adversarial lens + 10–15 cap. The point of an always-load layer is that it's *small*; an uncapped projection defeats BUILD-2.
4. **Vault never projects to a shared-loaded file.** A `vault:<scope>` node may only project into that scope's own (local, gitignored-adjacent) CLAUDE.md, never anything with a wider load surface. Consistent with §6 cross-substrate-promotion-forbidden.

## Consequences

- **`headroom learn` is retired** (TOOL-2 park closed) — the need it was held for is served natively. Headroom stays rejected as core infra; nothing changes there.
- **The CLAUDE.md orchestration dive shrinks:** its "self-evolving" sub-question is now answered (mechanism = reconciler projection). The rest of that dive (how CLAUDE.md ↔ STATE ↔ graph ↔ soul.md cross-reference without bloat) stays deferred.
- **Salvage keep-criterion sharpens:** the question for each candidate node becomes "is this a durable behavioral rule worth *always-loading* into a scoped CLAUDE.md?" — a stronger filter than "is it true?". Under it, `cockpit-working-rhythm` is both a keeper and a promotion candidate.
- **Build:** the projection is part of the reconciler build (memory-build beat 2 / reconciler), not a separate step.

## Nuances / open threads

- **Exact fence syntax + refresh trigger** (every reconciler run vs on-promotion-change) → finalize at build, alongside the reconciler's audit-diff (DESIGN §10).
- **Loop damping:** the projection feeds sessions that feed logs that feed the reconciler. The existing instability guard (citation-drop / centrality-delta / cluster-flip → hold for human review) covers the node side; confirm it also gates promotion churn at build.
- **Interaction with skills' `## Rules` (BUILD-4):** two promotion targets now (skill `## Rules` and CLAUDE.md managed regions). Confirm the reconciler routes a behavioral node to the right one (skill-specific → that skill; cross-cutting → scoped CLAUDE.md) — likely the same scope/centrality logic.

## Resolution [2026-06-23, build — Phase 4]

Built as `memory-engine/projection.mjs` (a `project(pool, {dryRun})` step the reconciler runs after the PHASE-1 node commit) + wired into `reconcile.mjs`. Two things the build had to settle that the lock above left open:

**1. The gate is one batched `judge('hard')` call per scope, handed the candidates *and* the already-always-loaded skeleton text.** It drops (a) anything already covered by the hand skeleton — no restating doctrine — and (b) transient build-scaffolding that won't matter after the current work ships; survivors are rephrased as tight imperative one-liners, capped, backlinked. Validated on the live cockpit pool: of 5 behavioral candidates it kept 2 and correctly dropped the skeleton-duplicates (`cockpit-is-a-two-brain-OS` ≈ skeleton Identity; `ground-reconciler-work` ≈ skeleton "Ground in the decisions first") and the transient ones. **Under-promotion — even to zero rules — is a correct outcome, not a bug.** Stability damping: the input signature (eligible nodes' id+content-hash+centrality, plus the skeleton) is embedded in the begin-marker (`inputs=<sha8>`); an unchanged scope is a no-op (no judge call, no write), so CLAUDE.md diffs stay stable run-to-run.

**2. Routing = the loader trick, generalized, with a public/private split (supersedes the lock's "project → that project's CLAUDE.md").** The projection writes the scope's *canonical* always-load file inside a repo the reconciler **owns**, and foreign project/client repos hold only a thin hand-written loader that `@`-imports it — so generated bytes never land in a deliverable repo, and the commit policy is uniform. Targets:

| scope kind | scope | canonical target | repo / privacy | load-point |
|---|---|---|---|---|
| system | global | `shells/CLAUDE.md` | cockpit — **public** | `~/CLAUDE.md` loader `@`-imports it |
| system | cockpit | `~/.cockpit/CLAUDE.md` | cockpit — **public** | in-repo; no loader needed |
| data | project/venture/client `<x>` | `memory/scopes/<x>/CLAUDE.md` | memory — **private** | `~/projects/<x>/CLAUDE.md` thin loader |

Rationale for data scopes → private memory repo: client/project rules can carry scope-specific context that must never enter the public OSS history; the file co-locates with that scope's `identity/log/staging/sources`; and it rides the **same** memory two-phase commit as the nodes it derives from. The reconciler ends up committing only its own two repos (cockpit-public for system scopes, memory-private for data scopes) and **never** a foreign project/client repo — satisfying the "pristine repos / one writer" goal. Global writes into the canonical `shells/CLAUDE.md`, never the `~/CLAUDE.md` pure-pointer loader (the lock's original "global → `~/CLAUDE.md`" is corrected here). Deferred (not Phase-4-blocking): the exact `@import` path form for project loaders, verified when content/job-search actually wire up.

## Resolution [2026-06-23, design discussion + build] — gate determinism + fence lifecycle

The Phase-4 gate is one `judge('hard')` LLM call, so its rule *membership* is non-deterministic on **borderline** nodes (ones that partially overlap the skeleton): a dry-run kept 3 rules, the next real run kept 2, and the `inputs=<sha8>` damping then *froze* the arbitrary 2-rule answer. Two distinct problems: **(A)** the coin-flip itself, and **(B)** damping making a one-time flip permanent and invisible (damping assumed an output-stability the gate never had).

**Resolved by a three-layer always-load model + an automatic fence lifecycle** — not a quorum (held in reserve), and explicitly *not* by letting the reconciler write the hand skeleton (that would re-import non-determinism into the one deterministic, highest-stakes layer and make demotion dangerous):

1. **Hand skeleton** — human-authored, outside the fence, never written by the reconciler. The deterministic anchor; foundational doctrine can be hand-folded here (e.g. the `delegate-to-sonnet` Phase-5-A fold), shrinking the gate's borderline surface.
2. **Durable** (inside fence) — a rule the gate keeps `GRADUATE_AFTER`=3 consecutive reconciles **auto-graduates** here and is thereafter **held by a counter + node-state, not re-judged each run** (so it stops flickering — fixes A for the rules that matter). **Auto-demoted** when its source node is superseded or drops below the centrality floor — deterministic, tied to node-state, never an LLM re-judgment (so demotion is safe to automate). Graduation removes the rule from Emerging; Durable rules join the gate's dedup context so they're never re-proposed.
3. **Emerging** (inside fence) — the gate's volatile pick, made **sticky**: last run's set is fed into the prompt ("keep unless clearly wrong"), turning the coin-flip into hysteresis and the damping-freeze into deliberate continuity (fixes B). The gate is re-run only when its inputs change; otherwise the set is reused and streaks still advance, so stable scopes graduate cheaply.

**"Fully automatic with AI judgment, no human gate"** (the user's explicit call, after disliking approval-gates): the *AI judgment* is the gate's repeated keeping; a *counter* decides when a rule has earned the durable box — no second LLM boundary, no human in the loop. Lifecycle state (streaks · graduated · last-emerging · gate-signature, per scope) lives in `memory/.reconciler/projection-state.json` (committed); the `schema=2` fence (`### Durable` / `### Emerging`) is a pure render of it.

**Reserved escalation:** quorum / best-of-N the gate, only if a future multi-scope load makes the Emerging boundary flip again (YAGNI now). **Symmetry:** this model is projection-general — when MEM-20 projection extends to `SOUL.md` (Phase 5 B4), Hermes's shell inherits the same three layers, decided here so it isn't re-designed. Built in `projection.mjs` + verified end-to-end on the live pool (streak→graduate→demote, sticky convergence, settled no-op); a latent `commitFile` bug (pathspec commit with no diff → "no changes added to commit" not caught) was found and fixed. Filed → DECISIONS MEM-20 amendment + DESIGN §5/§6a.4 (+ §13 wart cleared).

## Sources

- This build session, 2026-06-22 — the salvage audit surfaced `cockpit-working-rhythm` as a behavioral keeper, which prompted the "use memory to enrich CLAUDE.md" insight and this decision.
- Builds on: the self-evolving-CLAUDE.md design input (log 2026-06-19pm, video XZautQfr3HU); BUILD-4 reconciler-only `## Rules` promotion; the Headroom evaluation (TOOL-2, `decisions/headroom-eval.md`).
