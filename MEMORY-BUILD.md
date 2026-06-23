# MEMORY BUILD — live progress tracker

**TRANSIENT.** This file exists only for the duration of the Memory-layer build. It is the
cross-compaction **resume anchor**: any session resuming the build reads `STATE.md` +
latest `log/YYYY-MM.md` + **this file**, and knows exactly where things stand. **Delete it at
the end of the build** (final step of Phase 5); the permanent record lives in STATE/DECISIONS/log.

It holds **status + build-local micro-decisions + resume pointer only** — it never restates the
specs. The specs are the home (one-fact-one-home, DOC-1):
- **How it works** → `memory/DESIGN.md` (§4 schema · §5 reconciler+projection · §6 VM boundary ·
  §6a LOCKED formats · §7 retrieval · §8 ingestion · §9 logging · §10 GC · §13 backlog)
- **Why / rejected** → `DECISIONS.md` (MEM-8,9,10,11,12,13,16,20,21,22,23,24; TOOL-6; BUILD-1/3/4)
- **Deep reasoning** → `decisions/{path-topology,retrieval-engine,ingestion-and-curation,claude-md-projection}.md`

---

## Why this build (the pivot)

Pivoted from grill-me → Memory build: `/watch` is a *producer* writing to `sources/` with no
*consumer*. Build the substrate first (BUILD-1: substrate before orchestration). Well-prepped —
engine verified (MEM-24), build formats locked (DESIGN §6a), capture/salience designed, dual-brain
bridge wired. This is **execution, not design**.

---

## Load-bearing assumptions (confirm / redirect before Phase 1)

1. **One Node ESM project, in-repo.** Bootstrap + reconciler + projection + retrieval are one Node
   codebase (MEM-24 fixed the engine as Node; the reconciler `require`s it in-process, §7). Capture
   hooks register as Claude Code shell hooks but invoke a Node script.
2. **Code home = `~/.cockpit/memory/engine/`** (Node code); data home = `knowledge/` + `scopes/`
   (§6a.3). `engine/node_modules/` + the ONNX model cache → gitignored; deps pinned in `package.json`.
3. **Hooks live in `~/.claude/`** (outside the repo, like the skills bridge) → `bootstrap.sh`
   territory; the scripts they call live in-repo.
4. **Multi-session.** Phase 3 (reconciler) likely owns a session alone.

---

## Cross-cutting rules (every phase)

- Minimal where mechanical (Phases 1–2); rigorous where judgment lives (Phase 3 reconciler).
  Never minimize correctness: idempotency, no data loss, clone-clean.
- Clone-clean (MEM-23): no hardcoded abs paths beyond `~`, no secrets in tree, deps pinned.
- Single-writer invariant (MEM-8): ONLY the reconciler writes canonical nodes; capture only appends
  to staging.
- Engine = MEM-24 in-process stack (no vector DB, no daemon).
- Do NOT clobber `/watch`'s existing `scopes/<scope>/sources/` content.
- Per phase: propose impl → nod → build → test vs acceptance → update STATE/DECISIONS/log → commit.
  Verify before freezing. Advise, don't list.

---

## Phase status

| Phase | What | Status |
|-------|------|--------|
| 0 | Re-orient + create this tracker | ✅ done |
| 1 | Bootstrap the tree (MEM-13 / §6a.3) | ✅ done |
| 2 | Capture hooks (MEM-16/22 / §9) | ⏳ next |
| 3 | Reconciler + retrieval (MEM-8/9/11/12/24 / §5/§7/§10) — **the heart** | ☐ |
| 4 | CLAUDE.md projection (MEM-20 / §6a.4) | ☐ |
| 5 | Cutover + salvage (checklist 1b/c + 2; TOOL-6) + delete this file | ☐ |

---

## Phase detail + acceptance

### Phase 1 — Bootstrap  (MEM-13 / §6a.3)  [mechanical]  ✅ DONE 2026-06-23 → `memory/engine/bootstrap.mjs`
- [x] 1.1 Idempotent op (safe re-run; creates only what's missing; never overwrites a file).
- [x] 1.2 `knowledge/nodes/` + placeholder `INDEX.md`.
- [x] 1.3 `scopes/{global,cockpit,content,job-search}/{identity,log,staging,sources}/`; LIVE scopes
      only via `ensureScope()` (dormant materialize via the same fn at re-onboarding, OPEN-7); NO `vault/`.
- [x] 1.4 Seeds: `global/identity/soul.md` (= global identity, §3) + `<scope>.md` identity stub per
      other scope. (Append-only mode is a reconciler concern, Phase 3 — bootstrap just lays the tree.)
- [x] 1.5 Test transcript REMOVED (user call).
- **Acceptance MET:** re-run = no-op ✓; tree matches §6a.3 ✓; `/watch` `sources/` dirs preserved ✓;
  clone-clean (paths relative to script) ✓; data gitignored from public history (`check-ignore` ✓).

### Phase 2 — Capture hooks  (MEM-16/22 / §9)  [mechanical, dumb capture]
- [ ] 2.1 Session-boundary capture → append near-raw, judgment-free to scope `staging/`; scope
      stamped mechanically from session context.
- [ ] 2.2 Salience markers (MEM-22): T1 sentinels `#good`/`#bad` (regex on user text); T2 inferred
      (errors structural via `is_error`/`PostToolUseFailure`; keep/correction/decision regex). Not gates.
- [ ] 2.3 Fire on `Stop` + `PreCompact` + `SessionEnd` (bug #6428: skips `/clear` — not sole trigger).
- [ ] 2.4 Note: unblocks writer-cutover (checklist 1b/c) — cut over in Phase 5, not here.
- **Acceptance:** a session's turns land in staging with correct scope + salience flags; zero judgment
  at capture; idempotent; no canonical writes.

### Phase 3 — Reconciler + retrieval  (MEM-8/9/11/12/24 / §5/§7/§10)  [RIGOROUS — the heart]
- [ ] 3.1 Node writer: staging/logs/sources → canonical nodes per §6a.1. Field-ownership split
      (capture stamps scope/created/raw claim+citation; reconciler owns centrality/cluster/tags/
      claim-downgrade/updated/last_synced). Mint `feedback` nodes from MEM-22 markers.
- [ ] 3.2 Retrieval (MEM-24): embed node prose (re-embed on content-hash change), Float32Array+JSON
      cache, brute-force cosine + ripgrep, RRF k=60 fuse. Batch embeds ≤8 (avoid 8GB single-batch spike).
- [ ] 3.3 Write-safety (MEM-9): two-phase commit (write+git commit, THEN mark staging consumed);
      lockfile fencing; conflict precedence source-trust → recency → human-escalation.
- [ ] 3.4 Two tempos (MEM-16): continuous bookkeeping at capture boundaries + nightly heavy
      distillation/"dreaming" (§8 mode 2) → pending-review queue, lower trust. Cheap pass digests
      MEM-22-flagged spans; expensive model judges digest, not the firehose; + unmarked-salience sweep.
- [ ] 3.5 Instability guard: hold rewrite on citation-drop / centrality-delta / cluster-flip over
      threshold. Per-run audit diff (added/modified/deleted/held + reasons).
- [ ] 3.6 Regenerate `INDEX.md`. Model routing: judgment = Sonnet min / Opus hard; Haiku = git plumbing.
- **Acceptance:** staging → well-formed canonical nodes; retrieval returns sensible ranked nodes on
  real queries; two-phase commit crash-safe + idempotent; instability guard triggers; audit diff emitted.

### Phase 4 — CLAUDE.md projection  (MEM-20 / §6a.4)
- [ ] 4.1 Reconciler writes ONLY the fenced managed region
      (`<!-- managed:reconciler:begin/end -->`), full-interior idempotent replace; skeleton untouched.
- [ ] 4.2 Promote high-centrality BEHAVIORAL nodes only (`type ∈ {identity, feedback}`);
      facts/knowledge stay retrieval-gated. Gate (when_to_use + adversarial lens) + cap 10–15;
      over-cap → highest-centrality wins, rest logged.
- [ ] 4.3 Scope routing: global→`~/CLAUDE.md`; cockpit→`~/.cockpit/CLAUDE.md`; project→that project.
      Per-rule `[[source-node]]` backlink.
- **Acceptance:** behavioral nodes project into correct scoped CLAUDE.md, fenced/capped/backlinked;
  hand-authored skeleton untouched; re-run idempotent.

### Phase 5 — Cutover + salvage  (checklist 1b/c + 2; TOOL-6)
- [ ] 5.1 Disable native Claude writer (`autoMemoryDirectory`/disable) — kills #63903 token tax.
- [ ] 5.2 Bridge Hermes as a staging WRITER; cut over Hermes LAST.
- [ ] 5.3 Salvage remainder (BUILD-3): Hermes memory subsystem + live CLAUDE.md merge chain.
- [ ] 5.4 Clean-start (MEM-15): NO legacy migration; only keepers (`cockpit-working-rhythm`,
      `live-work-focus`) carry forward.
- [ ] 5.5 git checkpoint (checklist 5); update STATE (Memory: built); **delete this tracker.**
- **Acceptance:** one capture path, old writers off, no token tax, single timeline both brains append to.

---

## Build-local micro-decisions (running — not big enough for DECISIONS.md)

- **2026-06-23 — Node single-project confirmed (Option A).** Reconciler + engine + bootstrap +
  projection + capture-script all Node; reconciler `require`s the MEM-24 engine in-process.
- **2026-06-23 — Reconciler runtime → DECISIONS MEM-25** (promoted out of build-local). Standalone
  brain-neutral Node infra; model calls via `judge()` → `hermes proxy`; GPT-5.5 start, swappable.
- **2026-06-23 — Git posture → DECISIONS OSS-1** (promoted). Public = system, private = data;
  `memory/scopes/` + `memory/knowledge/` gitignored from the public repo now; private data repo +
  reconciler commit-target deferred to Phase 3. `bootstrap.mjs` = source of truth for the data tree.
- **2026-06-23 — Test transcript: REMOVE** (user call). Clean start; no real sources until live capture.

---

## Current position

**Phases 0–1 done.** Tree bootstrapped + data walled from public git (OSS-1). **Next: Phase 2 —
capture hooks** (MEM-16/22 / §9): `Stop`/`PreCompact`/`SessionEnd` → append near-raw, judgment-free
to scope `staging/`; mechanical scope-stamp + salience markers. Open Phase-2 grey areas to settle on
the nod: the `cwd → scope` map + the homeless live scopes (`content`/`job-search` have no
`~/projects/` dir → need cwd-map + env/flag override).
