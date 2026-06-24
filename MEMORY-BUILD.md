# MEMORY BUILD — live progress tracker

**TRANSIENT.** This file exists only for the duration of the Memory-layer build. It is the
cross-compaction **resume anchor**: any session resuming the build reads `STATE.md` +
latest `log/YYYY-MM.md` + **this file**, and knows exactly where things stand. **Delete it ONLY on the
user's explicit say-so**, after an **internalization audit** confirms every fact here is permanently
homed in STATE/DECISIONS/DESIGN/log (its content must outlive it — never auto-delete at "build end").

It holds **status + build-local micro-decisions + resume pointer only** — it never restates the
specs. The specs are the home (one-fact-one-home, DOC-1):
- **How it works** → `memory-engine/DESIGN.md` (§4 schema · §5 reconciler+projection · §6 VM boundary ·
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
2. **Code home = `~/.cockpit/memory-engine/`** (Node code); data home = `knowledge/` + `scopes/`
   (§6a.3). `memory-engine/node_modules/` + the ONNX model cache → gitignored; deps pinned in `package.json`.
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
| 2 | Capture hooks (MEM-16/22 / §9) | ✅ done |
| 3 | Reconciler + retrieval (MEM-8/9/11/12/24 / §5/§7/§10) — **the heart** | ✅ done (v1) |
| 4 | CLAUDE.md projection (MEM-20 / §6a.4) | ✅ done (v1) |
| 5 | Cutover + salvage (checklist 1b/c + 2; TOOL-6) + delete this file | 🔄 A (Claude-side) DONE; B (Hermes) + C (close-out) pending |

---

## Phase detail + acceptance

### Phase 1 — Bootstrap  (MEM-13 / §6a.3)  [mechanical]  ✅ DONE 2026-06-23 → `memory-engine/bootstrap.mjs`
- [x] 1.1 Idempotent op (safe re-run; creates only what's missing; never overwrites a file).
- [x] 1.2 `knowledge/nodes/` + placeholder `INDEX.md`.
- [x] 1.3 `scopes/{global,cockpit,content,job-search}/{identity,log,staging,sources}/`; LIVE scopes
      only via `ensureScope()` (dormant materialize via the same fn at re-onboarding, OPEN-7); NO `vault/`.
- [x] 1.4 Seeds: `global/identity/soul.md` (= global identity, §3) + `<scope>.md` identity stub per
      other scope. (Append-only mode is a reconciler concern, Phase 3 — bootstrap just lays the tree.)
- [x] 1.5 Test transcript REMOVED (user call).
- **Acceptance MET:** re-run = no-op ✓; tree matches §6a.3 ✓; `/watch` `sources/` dirs preserved ✓;
  clone-clean (paths relative to script) ✓; data gitignored from public history (`check-ignore` ✓).

### Phase 2 — Capture hooks  (MEM-16/22 / §9)  [mechanical, dumb capture]  ✅ DONE 2026-06-23 → `memory-engine/capture.mjs`
- [x] 2.1 Near-raw, judgment-free append to scope `staging/<date>__<session>.md`; scope stamped
      mechanically via `scopeFromCwd` (folder map: `~/projects/<x>`→`<x>`; `~/.cockpit`→`cockpit`;
      fallback `global`; `COCKPIT_SCOPE` manual override). NO model call (v1 skips the optional Haiku
      summary — raw transcript path stored as provenance; huge tool outputs not duplicated).
- [x] 2.2 Salience markers (MEM-22): T1 `#good`/`#bad` + T2 keep/correction/decision regex (user text)
      + `error` structural (`tool_result.is_error`). Tagged inline; markers focus, never gate.
- [x] 2.3 Hooks `Stop` + `PreCompact` + `SessionEnd` registered in `~/.claude/settings.json` (GLOBAL —
      user chose global-now). Incremental per-session cursor (`staging/.cursors/`) so per-turn `Stop`
      only appends new entries. **Fail-safe:** all errors swallowed → `global/staging/.capture-errors.log`,
      exit 0 always — never disrupts the session.
- [x] 2.4 Homeless live scopes: created `~/projects/{content,job-search}` + CLAUDE.md scope pointer
      (MEM-13c) so the folder map reaches them.
- **Acceptance MET:** tested on this session's real transcript — 1710 entries captured, correct scope,
  salience tags present, **idempotent** (re-run appended nothing), exit 0. Cutover (1b/c) noted for Phase 5.
- **Known limits (acceptable, best-effort per MEM-22):** sentinel regex false-fires when user text
  *discusses* `#good`/`#bad` (rare in normal sessions; reconciler judges in context); per-turn `Stop`
  re-reads the full transcript (O(n)/turn — fine at current sizes; byte-offset cursor is a later optim).
- **Lives outside the repo (→ `bootstrap.sh`):** `~/.claude/settings.json` hooks + `~/projects/{content,job-search}/`.

### Phase 3 — Reconciler + retrieval  (MEM-8/9/11/12/24 / §5/§7/§10)  [RIGOROUS — the heart]
- **3.0 Setup forks (before the reconciler runs):**
  - [x] **Private data repo stood up (Option D, 2026-06-23):** `memory-engine/` + `memory-engine/DESIGN.md` → cockpit
        top level (public); `memory/` = standalone private git repo (data only, gitignored wholesale).
        This **is** the reconciler's two-phase-commit target. bootstrap+capture verified from new paths.
  - [x] **Model access settled (MEM-25 revised + Sonnet research, 2026-06-23).** `judge(prompt,tier)` shells
        to `hermes -z "<prompt>" --ignore-rules -t ''` (clean stdout, verified). Tiered in-plan Codex per
        TOOL-3: `hard`→`gpt-5.5`, `bulk`→`gpt-5.4-mini`. Gemma throttle-fallback (MR-1). **Nous/proxy +
        `hermes portal` login DROPPED** — proxy can't reach Codex; no login needed (blocker gone).
  - [x] **v1 = single on-demand batch command** (`node reconcile.mjs [--dry-run] [--scope <s>]`); nightly timer later.
- [x] 3.1 Node writer: staging/logs/sources → canonical nodes per §6a.1. Field-ownership split
      (capture stamps scope/created/raw claim+citation; reconciler owns centrality/cluster/tags/
      claim-downgrade/updated/last_synced). Mint `feedback` nodes from MEM-22 markers.
- [x] 3.2 Retrieval (MEM-24): embed node prose (re-embed on content-hash change), Float32Array+JSON
      cache, brute-force cosine + ripgrep, RRF k=60 fuse. Batch embeds ≤8 (avoid 8GB single-batch spike).
- [x] 3.3 Write-safety (MEM-9): two-phase commit (write+git commit, THEN mark staging consumed);
      lockfile fencing; conflict precedence source-trust → recency → human-escalation.
- [~] 3.4 Two tempos (MEM-16): **DEFERRED — v1 is the on-demand light pass only.** Nightly heavy
      "dreaming" (§8 mode 2), pending-review queue beyond the held-merge case, and the unmarked-salience
      sweep land with the timer. The cheap-digest mechanism (salience gather → model judges digest) IS built. continuous bookkeeping at capture boundaries + nightly heavy
      distillation/"dreaming" (§8 mode 2) → pending-review queue, lower trust. Cheap pass digests
      MEM-22-flagged spans; expensive model judges digest, not the firehose; + unmarked-salience sweep.
- [x] 3.5 Instability guard: hold rewrite on citation-drop / centrality-delta / cluster-flip over
      threshold. Per-run audit diff (added/modified/deleted/held + reasons).
- [x] 3.6 Regenerate `INDEX.md`. Model routing: judgment = Sonnet min / Opus hard; Haiku = git plumbing.
- **Acceptance:** staging → well-formed canonical nodes; retrieval returns sensible ranked nodes on
  real queries; two-phase commit crash-safe + idempotent; instability guard triggers; audit diff emitted.

### Phase 4 — CLAUDE.md projection  (MEM-20 / §6a.4)  ✅ DONE 2026-06-23 → `memory-engine/projection.mjs`
- [x] 4.1 Writes ONLY the fenced managed region (`<!-- managed:reconciler:begin/end -->`), full-interior
      idempotent replace; hand-authored skeleton untouched. Append-at-EOF if no fence (verified on a
      skeletoned file + an empty file).
- [x] 4.2 Promotes high-centrality BEHAVIORAL nodes only (`type ∈ {identity, feedback}`, ≥ floor 0.6);
      facts/knowledge stay retrieval-gated. **Gate = one batched `judge('hard')` per scope** handed
      candidates + the already-loaded skeleton → drops skeleton-dupes + transient scaffolding, rephrases
      survivors as imperative one-liners; cap 12; over-cap → highest-centrality wins, rest logged. Under-
      promotion (even to 0) is correct. Damping: input signature in the begin-marker (`inputs=<sha8>`)
      → unchanged scope = no-op (no judge, no write), stable diffs.
- [x] 4.3 Scope routing **(resolved — loader-indirection + public/private split):** global→`shells/CLAUDE.md`
      (public, via `~/CLAUDE.md` loader); cockpit→`~/.cockpit/CLAUDE.md` (public, in-repo); data scopes→
      `memory/scopes/<x>/CLAUDE.md` (PRIVATE memory repo, via a thin `~/projects/<x>/CLAUDE.md` loader).
      Reconciler commits ONLY its own repos (cockpit + memory), never foreign. Per-rule `[[source-node]]`.
- [x] 4.4 **Gate determinism + fence lifecycle (2026-06-23, supersedes 4.2's single-list `inputs=` damping):**
      three layers — human **skeleton** (anchor) + auto-graduating **Durable** + sticky **Emerging**; counter-driven
      promotion (N=3), deterministic node-state demotion; `schema=2` fence is a pure render of
      `memory/.reconciler/projection-state.json`. See the resolved micro-decision below + MEM-20 amendment. Quorum reserved.
- **Acceptance MET:** dry-run over the live pool projects 2–4 well-formed cockpit rules into a fenced,
  capped, backlinked region below the hand skeleton; gate drops dupes/transient; idempotent via `inputs=`
  hash; skeleton untouched. Real isolated write → `~/.cockpit/CLAUDE.md` committed to the cockpit repo.
- **Build call:** projection isolated in `projection.mjs` (mirrors nodes/retrieval split), run from
  `reconcile.mjs` as PHASE 3 + the no-work path + dry-run preview. Cockpit `~/.cockpit/CLAUDE.md` got a
  thin hand-authored skeleton (Orient-before-building + DOC-1 pointer) above the fence.

### Phase 5 — Cutover + salvage  (checklist 1b/c + 2; TOOL-6)  [sequencing = option 1: Claude-side close-out, then ONE batched Hermes push]

**A. Claude-side close-out (do first — quick wins, no Hermes):**
- [x] A1 **Migrate the 2 keepers into the new graph** — `cockpit-working-rhythm` (behavioral → projects to
      CLAUDE.md) + `live-work-focus` (project knowledge), via staging → reconciler → nodes (MEM-15 keepers-
      carry-forward). They are NOT yet in the new system (reconciler has only distilled live staging). **MUST
      precede A3** — else disabling native injection loses always-loaded doctrine.
- [x] A2 Keepers resurface verified — all 3 migrated nodes always-load at root (projection) AND rank #1 on
      their natural retrieval queries. Done before native injection was disabled (A3).
- [x] A3 **Native Claude auto-memory writer DISABLED** (2026-06-23). CORRECTION to the earlier grounding: the
      key DOES exist — `autoMemoryEnabled` (confirmed in the v2.1.186 binary AND its settings schema). It is
      **all-or-nothing**: `false` disables native READ *and* WRITE of the auto-memory dir (no write-only toggle).
      Set `"autoMemoryEnabled": false` in `~/.claude/settings.json` (user scope, via the update-config skill).
      Safe because our system now owns both sides (capture hooks write; projection/retrieval read). Applies on
      next session start. **Clone-clean TODO:** mirror this key into `bootstrap.sh` (settings.json is out-of-repo).
- [x] A4 Clean-start confirmed (MEM-15): only the working-rhythm doctrine carried (3 nodes); `live-work-focus`
      intentionally dropped; old native files left INERT at `~/.claude/projects/-home-arn--cockpit/memory/`.

**B. Hermes integration push (ONE batch — memory side + identity side together):**
- [~] B1 Bridge Hermes as a staging WRITER (TOOL-6) — **CODE DONE + VALIDATED, ACTIVATION PENDING (2026-06-24).**
      Shared-core seam shipped (decision 3): `capture-core.mjs` (brain-neutral pipeline: scope gate, salience,
      cursor, staging frontmatter + `brain:` stamp, append, fail-safe log) + thin readers `capture.mjs` (Claude
      transcript JSONL) + `hermes-capture.mjs` (Hermes `state.db` via built-in `node:sqlite`, read-only, no new
      dep). Dry-run-validated: Claude path **A/B byte-identical** to the pre-refactor capture (2.2MB / 640+
      entries; only the intended `brain:` line differs); Hermes path gate-skips unmapped cwd (paperclip
      protection holds for Hermes), captures real user+assistant prose, structural tool-error tag, idempotent
      re-fire; no residue. **Still needed to FIRE (out-of-repo, → `bootstrap.sh`):** `config.yaml`
      `hooks: on_session_end:` entry + a one-time TTY consent (writes `~/.hermes/shell-hooks-allowlist.json`,
      covers CLI + gateway). Dormant until approved.
- [ ] B2 Salvage remainder (BUILD-3): Hermes memory subsystem (`memory_store.db` + `memories/USER.md` ONLY —
      **NO `MEMORY.md` on disk**, corrected) + VERIFY the live CLAUDE.md merge chain (cwd→`/`, native to Claude
      Code now — likely a verify, not a build). Flag the native-memory disable as cut-last (don't execute).
- [ ] B3 Write the real thin `shells/SOUL.md` (operator shell, counterpart to the builder shell); symlink stale
      `~/.hermes/SOUL.md` → it (loader follows symlinks; SOUL **can't** `@`-import). **BLOCKER (verified against
      source, 2026-06-24):** `hermes -z … --ignore-rules` DOES load SOUL — the flag is honored only in the
      TUI/gateway path, NOT `hermes_cli/oneshot.py` (default `skip_context_files=False` → `prompt_builder.py:1791
      if not skip_soul:` loads it). So once SOUL is real, it injects operator identity slot #1 into EVERY
      brain-neutral `judge()` call (breaks MEM-8/MEM-25). **Fix BEFORE symlinking:** give `judge.mjs` a dedicated
      reconciler `HERMES_HOME` carrying config/auth but no `SOUL.md`. NOT `HERMES_HOME=/dev/null` (relocates the
      whole home → loses Codex OAuth); NOT dropping `--ignore-rules` (never gated SOUL — no-op). Ground the
      minimal HERMES_HOME set at B3. (Resolves the handoff's `--ignore-rules`-skips-SOUL claim: false for oneshot.)
- [ ] B4 **Extend MEM-20 projection to the global operator shell** (in-scope BUILD, not just a decision).
      Add `audience` to the node template (§6a.1) + mint it in the reconciler distill from the brain-stamp
      (Hermes-origin → `operator`, default `builder`; **any-Hermes-provenance → operator** on merged spans, GA3);
      route `global + operator → shells/SOUL.md` in `projection.mjs` `targetFor` (inherits the three-layer fence).
      Renders EMPTY now (zero operator nodes). **GA2 limitation (recorded):** audience routing is scope-naive —
      Hermes runs in `~/.cockpit` (scope=cockpit), and only `global`+operator routes to SOUL, so SOUL won't
      organically fill until a scope-aware route or global Hermes runs exist; revisit when real operator nodes
      appear. **Acceptance = a SYNTHETIC global+operator node renders into SOUL's fence** in B4's dry-run (proves
      the axis), NOT organic fill. Defer per-project `HERMES.md` operator shells as YAGNI.

**C. Tracker close-out — ONLY on the user's explicit say-so:**
- [ ] C1 **Internalization audit:** confirm every fact in THIS file is permanently homed in STATE/DECISIONS/
      DESIGN/log. Nothing is lost when it goes.
- [ ] C2 git checkpoint; update STATE (Memory: built); **then** delete this tracker.

- **Acceptance:** one capture path, old writers off, no token tax, single timeline both brains append to,
  Hermes operator shell real, tracker content internalized.

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
- **2026-06-23 — Private data repo = Option D** (user call). `memory-engine/` (code) + `memory-engine/DESIGN.md` (spec)
  moved to cockpit top level (public); `memory/` is now its **own standalone private git repo** holding
  only data, gitignored wholesale from the cockpit repo. Chosen over B (detached git-dir, no moves) and
  C (`memory/data/` subdir). Costlier in churn but gives a clean conventional data repo. `bootstrap.mjs`
  `MEMORY_ROOT` now = `resolve(REPO_ROOT,'memory')`; settings.json hook paths + cockpit `.gitignore`
  rewired; doc refs swept (log/ left as historical). Finalizes OSS-1's deferred data-repo + commit-target.
- **2026-06-23 — `judge()` endpoint = `hermes -z`, tiered Codex (MEM-25 revised).** Dropped the Nous proxy
  (can't reach Codex; redundant paid path). User caught that this is just TOOL-3's main/aux split applied to
  the reconciler: `gpt-5.5` (hard) + `gpt-5.4-mini` (bulk), both in-plan Codex; Gemma throttle-fallback (MR-1).
  Process lesson → new build-doctrine rule in `shells/CLAUDE.md` ("Ground in the decisions first"): read the
  relevant DECISIONS/decisions before building (I'd proposed off-doctrine Gemini before reading TOOL-3/MR-1).
- **2026-06-23 — Capture-scope fix: unmapped cwd = opt-in only (`capture.mjs`).** A global-scope reconcile
  distilled **autonomous paperclip-agent heartbeats** — the `global` catch-all was auto-enrolling any session
  in an unmapped dir. Fix: capture only on a REAL scope (`COCKPIT_SCOPE` > mapped cwd > `#capture`/`#capture:<scope>`
  sentinel); unmapped → **skip** (no fabricated `global`). Tested 5/5 (skip · #capture→global · #capture:scope ·
  mapped · env-override). MEM-14 clarified + DESIGN §9. Root cause was paperclip (a systemd service running
  `npx paperclipai run` on a restart loop) — **removed entirely** (service+processes+package; agency work product
  preserved in scratch git history, video dropped). Next paperclip-shaped risk = Hermes; the fix covers it structurally.
- **2026-06-23 — Phase 5 A1+A2 DONE (keeper migration).** The `cockpit-working-rhythm` keeper was migrated as
  **3 hand-authored global behavioral nodes** (`delegate-research-to-sonnet-summarize-only`, `advise-dont-just-list-options`,
  `verify-before-freezing-cross-family-adversarial-panel`) — NOT distiller-fed (curated keepers must not be re-distilled;
  lossy). `claim=fact` + provenance citation `keeper:cockpit-working-rhythm`. The `live-work-focus` keeper was
  **intentionally dropped** (clean-start MEM-15; user owns work focus). All 3 verified retrievable (#1 each) and
  always-loaded at root: `advise`+`adversarial` as projected fence rules in `shells/CLAUDE.md`; `delegate-to-sonnet`
  **hand-folded into the skeleton's Model routing** (see next note). INDEX regenerated; engine code untouched.
- **2026-06-23 — Gate non-determinism: RESOLVED (was a known wart).** The projection gate is a `judge('hard')` LLM
  call, so its membership flips on borderline nodes (3→2 flip observed) and the old `inputs=<sha8>` damping froze the
  arbitrary set. **Fixed (design discussion → build, this session) with a three-layer fence + automatic lifecycle**, not a
  quorum: hand **skeleton** (human-only, deterministic anchor; reconciler never writes it) · **Durable** (rules the gate
  keeps `GRADUATE_AFTER`=3 consecutive reconciles auto-graduate, then held by a counter + node-state — not re-judged;
  auto-demoted when the source node is superseded / below floor) · **Emerging** (the gate's volatile pick, made *sticky* —
  last set fed back, hysteresis not coin-flip). Promotion = the gate's repeated judgment + a counter → **fully automatic,
  no human gate, no second LLM boundary** (user's explicit call). Lifecycle state → `memory/.reconciler/projection-state.json`
  (committed); fence is `schema=2` (`### Durable`/`### Emerging`), a pure render. Quorum/best-of-N reserved as escalation
  (YAGNI). Verified end-to-end on the live pool (streak→graduate→demote, sticky convergence, settled no-op); latent
  `commitFile` no-op bug found + fixed. Filed → DECISIONS MEM-20 amendment + DESIGN §5/§6a.4 + §13 wart cleared +
  decisions/claude-md-projection.md Resolution. **Note:** the earlier `delegate-to-sonnet` hand-fold stays (skeleton is
  still the right home for foundational doctrine — it just shrinks the gate's borderline surface). **SOUL.md (B4) inherits
  this same three-layer model** when projection extends to it.

---

- **2026-06-23 — Phase 5 sequencing = option 1; 5.1 coupling grounded.** Close out the Claude side first
  (keeper migration + native-writer disable + clean-start), THEN one batched Hermes push — its MEMORY side
  (staging-writer bridge) and IDENTITY side (`SOUL.md` shell + wiring) together, so Hermes internals load
  once. Grounding found A3 is **coupled to A1**: NO `autoMemory` disable key in `settings.json` (native writer
  at Claude-Code default), and the 2 keepers aren't in the new graph yet → migrate keepers FIRST, then disable,
  else lose always-injected doctrine; verify the disable mechanism via claude-code-guide. The Phase-4 work also
  left a **dual-brain projection-symmetry gap** (SOUL.md gets no MEM-20 projection) → decided in the Hermes
  push (B4). Tracker deletion gated on user say-so + an internalization audit. **Continuing in a fresh session.**
- **2026-06-23 — CLAUDE.md projection routing → loader-indirection + public/private split (Phase 4).**
  Reframed from the lock's "project → that project's CLAUDE.md" after a topology brainstorm with the user.
  Projection writes the scope's CANONICAL file in a reconciler-OWNED repo; foreign project/client repos
  hold only a thin hand-written loader that `@`-imports it (same trick as `~/CLAUDE.md`→`shells/`). System
  scopes (global→`shells/CLAUDE.md`, cockpit→`~/.cockpit/CLAUDE.md`) project PUBLIC (cockpit repo); data
  scopes (project/venture/client) project PRIVATE (`memory/scopes/<x>/CLAUDE.md`, rides the node commit).
  Reconciler commits cockpit + memory only — never foreign. Global writes the canonical shell, NOT the
  `~/CLAUDE.md` pure-pointer loader. Filed → DECISIONS MEM-20 amendment + DESIGN §5/§6a.4 + the deep-dive
  Resolution section. Code: `projection.mjs` `targetFor()` + `commitFile()` (cockpit-or-memory repo only).
- **2026-06-24 — B1 staging-writer bridge: CODE DONE + VALIDATED (activation pending).** Built the shared-core
  seam (decision 3): `capture-core.mjs` holds the brain-neutral pipeline (scope gate, salience, cursor, staging
  frontmatter + `brain:` stamp, append, fail-safe log); `capture.mjs` + `hermes-capture.mjs` are thin readers that
  each normalize their own session record to `{role,text,errored,ts}[]`. Claude path proven **A/B byte-identical**
  to the pre-refactor capture (2.2MB transcript, 640+ entries; only the intended `brain: claude` line differs).
  Hermes path dry-run-proven: gate-skips unmapped cwd (paperclip protection holds for Hermes), reads `state.db`
  read-only via built-in `node:sqlite` (Node v26.2.0, no new dep), captures real user+assistant prose, idempotent
  re-fire. Build-local calls: (a) **all-rows read** `ORDER BY timestamp,id` (NOT `active=1` — the `active` flag
  flips on compaction → count shrinks → stale cursor strands later turns; all-rows is append-monotonic + compacted
  turns are real memory); (b) **structural tool-error** detection (parse tool JSON → `success:false`/`error`/
  `is_error`, NOT substring — substring false-fires on legit `{"output":…}`); (c) **no `reasoning_content`
  capture** (parity with Claude skipping thinking blocks; **possible tunable** if the reconciler later misses
  CoT-only corrections); (d) **`brain:` in staging frontmatter** (per-file; sessions are single-brain). The
  SOUL/`-z` BLOCKER was found here (see B3) — and it resolved a handoff contradiction: `--ignore-rules` does NOT
  skip SOUL in the oneshot path (TUI-only). Activation (config.yaml hook + TTY consent) is the next step.

## Current position

**Phases 0–4 done; Phase 5 A DONE; Phase 5 B1 (Hermes staging-writer bridge) CODE DONE + VALIDATED, activation pending.**
Substrate bootstrapped, capture hooks live globally, the single-writer reconciler + MEM-24 retrieval engine
run end-to-end, the reconciler projects behavioral nodes into scope-routed CLAUDE.md, and the Claude-side
cutover off native auto-memory is complete.

✅ **Phase 5 A (Claude-side close-out) built + validated** (2026-06-23). The `cockpit-working-rhythm` keeper
migrated as 3 hand-authored global behavioral nodes (delegate-to-sonnet / advise-don't-list / verify-before-
freezing); `live-work-focus` intentionally dropped (clean-start). All 3 always-load at root (advise + adversarial
as projected fence rules in `shells/CLAUDE.md`; delegate-to-sonnet hand-folded into the skeleton's Model routing
after the gate flip-flopped on it — gate non-determinism wart recorded) and rank #1 in retrieval. Native
auto-memory DISABLED via `"autoMemoryEnabled": false` (key confirmed in v2.1.186; all-or-nothing read+write).
Clean-start confirmed; old native files left inert. **Next: Phase 5 B** — batched Hermes push (B1 staging-writer
bridge + B2 salvage/merge-chain verify + B3 real `shells/SOUL.md` + wiring + B4 SOUL.md-projection decision),
then C (internalization audit + tracker delete) ONLY on explicit say-so.

✅ **Phase 4 (CLAUDE.md projection) built + validated** (2026-06-23) → `memory-engine/projection.mjs`,
wired into `reconcile.mjs` as PHASE 3. Judge gate (drops skeleton-dupes + transient, rephrases survivors),
fenced managed region with `inputs=` damping, resolved scope routing (loader-indirection + public/private
split). Cockpit `~/.cockpit/CLAUDE.md` created with a thin hand skeleton + the projected fence (2 rules over
the committed 12-node pool), committed to the cockpit repo. Acceptance met.

**Earlier (Phases 0–3):**

✅ **Reconciler v1 built + validated on `cockpit`** (2026-06-23). Files in `memory-engine/`: `retrieval.mjs`
(all-MiniLM-L6-v2 ONNX embed, brute-force cosine, ripgrep, RRF k=60, disposable JSON cache), `nodes.mjs`
(node frontmatter I/O), `reconcile.mjs` (lock → staging digest → `judge()` distill → embed/dedup → instability
guard → two-phase commit → INDEX + audit). Deps pinned: `@huggingface/transformers@4.2.0`, `js-yaml@5.1.0`.
**All 5 acceptance criteria pass** (well-formed §6a.1 nodes · sensible retrieval · crash-safe+idempotent
two-phase commit · guard 5/5 · audit diff). Grey areas resolved → both Option A: citation token
`stg:<anchor>:<sha8>` (DESIGN §6a.1); identity-home = flat pool (MEM-11 clarified). Bugs caught: main()-on-import
(guarded), double-wrapped wikilinks (fixed). `cockpit` committed in the private `memory/` repo (12 nodes).

**Next:** ① ~~reconcile `global`~~ — DONE-as-wiped: `global` was autonomous paperclip-agent noise, not real
work; paperclip removed + global staging wiped + capture-scope fix shipped (unmapped = `#capture` opt-in only).
`content`/`job-search` empty. ② **Phase 4 — CLAUDE.md projection (MEM-20 / §6a.4)**: project high-centrality
`type ∈ {identity, feedback}` nodes into scope-routed fenced CLAUDE.md regions. Deferred from v1 (non-blocking):
nightly "dreaming" two-tempo pass (3.4), degree-centrality/community recompute (bootstrap mode, §6a.3), and
logs/sources ingestion (v1 reads staging only).
