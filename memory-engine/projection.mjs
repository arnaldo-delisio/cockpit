#!/usr/bin/env node
// projection.mjs — CLAUDE.md projection (DESIGN §5 / §6a.4; MEM-20). Phase 4.
//
// The reconciler's SECOND output: after canonical nodes are durable, promote the few
// high-centrality BEHAVIORAL nodes (type ∈ {identity, feedback}) into the always-loaded
// layer — the fenced "managed region" of the scope-routed CLAUDE.md. Facts/`knowledge`
// stay retrieval-gated and never project (DESIGN §6a.4).
//
// Locked invariants this file must never break:
//   • behavioral-only      — only type ∈ {identity, feedback} project; knowledge never does.
//   • fence discipline      — read/replace ONLY the bytes between :begin and :end; the
//                             hand-authored skeleton (BUILD-2) outside the fence is untouched.
//   • scope routing         — a node projects ONLY into its own scope's CLAUDE.md
//                             (global→~/CLAUDE.md; cockpit→~/.cockpit/CLAUDE.md; <x>→~/projects/<x>).
//   • cap (BUILD-4)         — ≤ CAP rules; over-cap = highest-centrality wins, rest logged (no
//                             silent truncation).
//   • the node is the home  — the block is a generated cache; each rule carries [[source-node]].
//
// The adversarial gate (decisions/claude-md-projection.md) is one batched judge('hard') call per
// scope, handed the candidates AND the already-always-loaded skeleton text, told to keep only
// durable always-load rules NOT already covered by the skeleton (drops duplicates + transient
// build-scaffolding). Under-promotion (even to zero rules) is a correct outcome, not a bug.
//
// THREE-LAYER MODEL (MEM-20 determinism amendment, 2026-06-23). The gate is an LLM call → its
// membership flips on borderline nodes. We contain that flip instead of letting `inputs=` freeze a
// coin-flip. A scope's CLAUDE.md now carries three layers:
//   • HAND SKELETON  — outside the fence; human-authored; the reconciler NEVER writes it.
//   • DURABLE rules  — inside the fence; rules the gate has kept GRADUATE_AFTER reconciles in a row
//                      auto-graduate here and are HELD by a counter + node-state (not re-judged each
//                      run), so they stop flickering. Auto-demoted when their source node is
//                      superseded or drops below the centrality floor. State is the home; git is undo.
//   • EMERGING rules — inside the fence; the gate's volatile pick, made STICKY: last run's set is fed
//                      back so the gate keeps it unless there's a clear reason to change (hysteresis,
//                      not a fresh coin-flip). Survives N runs → graduates to DURABLE.
// "AI judgment" drives promotion (the gate's repeated keeping); a counter decides *when* it has earned
// the durable box — no second LLM boundary, no human gate. Quorum/best-of-N is the reserved escalation
// if a future multi-scope load makes the emerging boundary flip again (DECISIONS MEM-20).
//
// Projection state (streaks · graduated set · last emerging set · gate signature, per scope) lives in
// `memory/.reconciler/projection-state.json` (committed, sibling of the reconciler's state.json). The
// CLAUDE.md file is a pure render of that state, so its diff only moves when membership actually moves.
//
// Damping: the gate signature (gate candidates + skeleton + last emerging set) is stored per scope. If
// it is unchanged we REUSE last run's emerging set instead of re-calling the gate — but streak
// bookkeeping still advances (stickiness guarantees the gate would re-select it), so stable scopes keep
// graduating cheaply. The gate runs only when its inputs actually change.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { judge } from './judge.mjs';
import { contentHash } from './retrieval.mjs';
import { MEMORY_ROOT } from './bootstrap.mjs';

const execFileP = promisify(execFile);

// --- tunables (grey-area picks; tune after real runs) ---
const CENTRALITY_FLOOR = 0.6;   // below this, a behavioral node is not "high-centrality" enough to always-load
const CAP = 12;                 // ≤ BUILD-4's 10–15 cap on the always-load ## Rules block (durable + emerging)
const PROSE_CHARS = 500;        // per-candidate truncation handed to the gate
const GRADUATE_AFTER = 3;       // consecutive reconciles a rule must survive the gate before it auto-graduates
                                // to DURABLE (at on-demand cadence ≈ 3 runs; revisit when the nightly timer lands)

const HOME = homedir();
const COCKPIT_ROOT = resolve(HOME, '.cockpit');
const GLOBAL_SKELETON = resolve(COCKPIT_ROOT, 'shells', 'CLAUDE.md'); // canonical global builder shell (~/CLAUDE.md just imports it)
const GLOBAL_SOUL = resolve(COCKPIT_ROOT, 'shells', 'SOUL.md');       // canonical global operator shell (~/.hermes/SOUL.md symlinks it)
const PROJ_STATE_FILE = resolve(MEMORY_ROOT, '.reconciler', 'projection-state.json'); // committed (sibling of state.json)

const sha8 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const isBehavioral = (n) => ['identity', 'feedback'].includes(n.frontmatter?.type) && !n.frontmatter?.superseded;

// projection-state key for a route: builder keeps the BARE scope key (back-compat — existing
// projection-state.json survives B4); operator routes get a `<scope>::operator` suffix.
const routeKey = (scope, audience) => (audience === 'operator' ? `${scope}::operator` : scope);
const parseRouteKey = (key) => (key.endsWith('::operator') ? [key.slice(0, -'::operator'.length), 'operator'] : [key, 'builder']);

// (scope × audience) → CANONICAL projection target (B4 audience axis). The reconciler writes ONLY its
// own two repos; project/client load-points (~/projects/<x>/CLAUDE.md) are thin hand-written loaders
// that @-import these canonicals, so foreign repos stay pristine. System scopes project public (cockpit
// repo); data scopes project private (memory repo, riding the same commit as the nodes they derive from).
//   builder/global   → shells/CLAUDE.md      — public cockpit repo; ~/CLAUDE.md (loader) @-imports it.
//   builder/cockpit  → ~/.cockpit/CLAUDE.md  — public cockpit repo; load-point already in-repo, no loader.
//   builder/<x>      → memory/scopes/<x>/CLAUDE.md — PRIVATE memory repo; ~/projects/<x>/CLAUDE.md loader imports it.
//   operator/global  → shells/SOUL.md        — public cockpit repo; ~/.hermes/SOUL.md symlinks it.
//   operator/<x>     → null (NO route) — audience routing is scope-naive (GA2); non-global operator nodes
//                      don't project until a scope-aware route exists, and must NOT fall back to the
//                      builder shell (that would leak operator rules into the always-loaded builder root).
function targetFor(scope, audience) {
  if (audience === 'operator') return scope === 'global' ? GLOBAL_SOUL : null;
  if (scope === 'global') return GLOBAL_SKELETON;                 // shells/CLAUDE.md (the canonical root shell)
  if (scope === 'cockpit') return resolve(COCKPIT_ROOT, 'CLAUDE.md');
  return resolve(MEMORY_ROOT, 'scopes', scope, 'CLAUDE.md');      // private memory repo (data scopes)
}

// ---------- fence (DESIGN §6a.4) ----------
const FENCE_RE = /[ \t]*<!-- managed:reconciler:begin\b[^>]*-->[\s\S]*?<!-- managed:reconciler:end -->\n?/;

const renderRule = (r) => `- ${r.rule}${r.source ? ` [[${r.source}]]` : ''}`;

// render the managed fence from the two computed layers (durable = graduated/held, emerging = volatile).
function renderFence(durable, emerging, gateSig) {
  let body = `<!-- managed:reconciler:begin schema=2 inputs=${gateSig} -->\n`
    + `## Rules (projected from memory — do not edit; edit the source node)\n`;
  if (!durable.length && !emerging.length) {
    body += `_(no rules currently meet the always-load bar — see retrieval-gated memory)_\n`;
  } else {
    if (durable.length) {
      body += `### Durable (auto-graduated — survived ${GRADUATE_AFTER}+ reconciles; held until superseded)\n`
        + durable.map(renderRule).join('\n') + '\n';
    }
    if (emerging.length) {
      body += `### Emerging (volatile — promotes to Durable after ${GRADUATE_AFTER} consecutive reconciles)\n`
        + emerging.map(renderRule).join('\n') + '\n';
    }
  }
  body += `<!-- managed:reconciler:end -->\n`;
  return body;
}

// replace the existing fence in place, else append one at EOF after a blank line (§6a.4).
function spliceFence(text, fence) {
  if (FENCE_RE.test(text)) return text.replace(FENCE_RE, fence);
  const base = text.trimEnd();
  return base ? `${base}\n\n${fence}` : fence;
}

// strip the managed fence from a file's text -> the hand-authored skeleton only (for dedup context).
function skeletonOf(text) { return text.replace(FENCE_RE, '').trim(); }

// ---------- projection state (streaks / graduated / last-emerging / gate-sig, per scope) ----------
// The home for the durable lifecycle; the CLAUDE.md fence is a pure render of it. Shape:
//   { "<scope>": { streaks: { "<sourceId>": <n> }, graduated: { "<sourceId>": { rule, source } },
//                  emerging: [{ rule, source }], gateSig: "<sha8>" } }
async function loadProjState() { try { return JSON.parse(await readFile(PROJ_STATE_FILE, 'utf8')); } catch { return {}; } }
async function saveProjState(state) {
  await mkdir(dirname(PROJ_STATE_FILE), { recursive: true });
  await writeFile(PROJ_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
const scopeState = (state, scope) => (state[scope] ||= { streaks: {}, graduated: {}, emerging: [], gateSig: '' });

// ---------- the adversarial gate (judge, hard tier) ----------
// `sticky` = last run's emerging picks. Fed back so the gate keeps them unless there is a clear reason
// to change (hysteresis): this is what turns the borderline coin-flip into a stable set run-to-run.
function gatePrompt(scope, audience, candidates, skeleton, sticky) {
  const cand = candidates.map((n) =>
    `[${n.id}] (centrality ${n.frontmatter.centrality}) ${n.frontmatter.title}\n  ${truncate(n.prose.replace(/\s+/g, ' '), PROSE_CHARS)}`
  ).join('\n\n');
  const prior = (sticky || []).filter((r) => r && r.rule).map((r) => `- ${r.rule}${r.source ? ` [[${r.source}]]` : ''}`).join('\n');
  const shell = audience === 'operator'
    ? `the "${scope}" OPERATOR shell (SOUL.md — Hermes the operator's always-loaded identity)`
    : `the "${scope}" scope's CLAUDE.md`;
  return `You curate the ALWAYS-LOADED behavioral rules for ${shell} — the few \
operating rules worth putting in front of the model in EVERY session (not retrieval-gated). Below are \
candidate behavioral memory nodes, the rules ALREADY hand-written in the always-loaded skeleton, and the \
set you selected on the PREVIOUS run.

Pick ONLY the candidates that genuinely deserve always-loading, applying an adversarial lens:
- STABILITY FIRST: keep each previously-selected rule whose candidate is still present, UNLESS there is a
  clear reason to drop it (it is now covered by the skeleton, became transient, or a better candidate
  supersedes it). Add or drop only on a clear basis — do not churn the set for cosmetic rewording.
- DROP anything already covered by the skeleton (do not restate existing doctrine — that is bloat).
- DROP transient / build-in-progress scaffolding ("we are currently on phase X") — keep only DURABLE rules
  that will still matter after the current work ships.
- DROP vague platitudes; keep crisp, actionable operating rules.
- Rephrase each survivor as ONE tight imperative line (≤ ~20 words). Keep its source node id; reuse the
  previous wording verbatim when the rule is unchanged (stable diffs).
- Hard cap ${CAP}. Prefer FEW. Returning an EMPTY array is a correct, common outcome.

Reply ONLY a JSON array (possibly empty): [{ "rule": "<imperative one-liner>", "source": "<candidate node id>" }]

ALREADY-LOADED SKELETON (do not duplicate these):
"""
${skeleton || '(none)'}
"""

PREVIOUSLY SELECTED (keep unless clearly wrong):
"""
${prior || '(none — first run)'}
"""

CANDIDATES (eligible for selection; graduated rules are excluded and must not be re-listed):
${cand}`;
}

// ---------- git (auto-commit, scoped to the cockpit repo only) ----------
async function repoRoot(dir) {
  try { return (await execFileP('git', ['-C', dir, 'rev-parse', '--show-toplevel'])).stdout.trim(); }
  catch { return null; }
}
// commit a single touched file IFF it belongs to a repo the reconciler OWNS (cockpit public or memory
// private); a foreign project/client repo / no repo -> write only. Returns 'committed' | 'written' | 'nochange'.
async function commitFile(file) {
  const root = await repoRoot(dirname(file));
  if (root !== COCKPIT_ROOT && root !== MEMORY_ROOT) return 'written';   // never commit a foreign repo
  const rel = relative(root, file);
  await execFileP('git', ['-C', root, 'add', '--', rel]);
  try {
    await execFileP('git', ['-C', root, 'commit', '-m', `reconcile: project memory -> ${rel}`, '--quiet', '--', rel]);
    return 'committed';
  } catch (e) {
    // pathspec-scoped commit with no diff for `rel`: "nothing to commit" (clean tree) OR "no changes
    // added to commit" (other files unstaged) — both mean this file is unchanged, not a real failure.
    if (/nothing to commit|no changes added to commit/i.test(e.stderr || e.stdout || '')) return 'nochange';
    throw e;
  }
}

// ============================================================ main entry
// project(pool, { dryRun }) -> audit array. Called by reconcile.mjs after PHASE-1 node commit.
export async function project(pool, { dryRun = false } = {}) {
  const globalSkeleton = await readFile(GLOBAL_SKELETON, 'utf8').catch(() => '');
  const state = await loadProjState();

  // Read scopes from memory/scopes.json (same source as reconcile.mjs). Fallback to safe minimum.
  let knownScopes = ['global', 'cockpit'];
  try {
    const raw = JSON.parse(await readFile(resolve(MEMORY_ROOT, 'scopes.json'), 'utf8'));
    if (Array.isArray(raw) && raw.length) knownScopes = raw;
  } catch { /* use defaults */ }
  // KNOWN routes to sweep for a now-empty fence to clear: every builder scope + the global operator shell.
  const knownRoutes = [...knownScopes.map((s) => [s, 'builder']), ['global', 'operator']];

  // ROUTES (B4 audience axis): the unit of projection is a (scope × audience) route, not a scope — one
  // scope (global) hosts both a builder route (→ CLAUDE.md) and an operator route (→ SOUL.md). Consider:
  // any route with behavioral candidates; any route with existing projection-state (so demotion/cleanup
  // runs); any KNOWN route whose target already carries a fence (clear a now-empty one). operator+non-global
  // routes have no target (null) and are dropped here (GA2) — the node simply doesn't project.
  const routes = new Map();   // routeKey -> { scope, audience, key, file }
  const addRoute = (scope, audience) => {
    const file = targetFor(scope, audience);
    if (!file) return;                                  // operator+non-global: no route (GA2)
    const key = routeKey(scope, audience);
    if (!routes.has(key)) routes.set(key, { scope, audience, key, file });
  };
  for (const n of pool) if (isBehavioral(n)) addRoute(n.frontmatter.scope, n.frontmatter.audience || 'builder');
  for (const key of Object.keys(state)) { const [s, a] = parseRouteKey(key); addRoute(s, a); }
  for (const [s, a] of knownRoutes) {
    const t = await readFile(targetFor(s, a), 'utf8').catch(() => null);
    if (t && FENCE_RE.test(t)) addRoute(s, a);
  }

  const audit = [];
  for (const { scope, audience, key, file } of [...routes.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const existing = await readFile(file, 'utf8').catch(() => '');
    const sc = scopeState(state, key);

    // candidates: behavioral, THIS route (scope × audience; pre-B4 nodes default to builder), above the
    // centrality floor, strongest first.
    const candidates = pool
      .filter((n) => isBehavioral(n) && n.frontmatter.scope === scope
        && (n.frontmatter.audience || 'builder') === audience
        && (n.frontmatter.centrality || 0) >= CENTRALITY_FLOOR)
      .sort((a, b) => (b.frontmatter.centrality || 0) - (a.frontmatter.centrality || 0));
    const candById = new Map(candidates.map((n) => [n.id, n]));
    const centOf = (id) => (candById.get(id)?.frontmatter.centrality || 0);

    // --- DEMOTION: a durable rule whose source node no longer qualifies (superseded / below floor /
    //     gone) drops out of the durable layer. Deterministic, tied to node state — never an LLM guess.
    const demoted = [];
    for (const id of Object.keys(sc.graduated)) {
      if (!candById.has(id)) { demoted.push(id); delete sc.graduated[id]; delete sc.streaks[id]; }
    }
    const graduatedIds = new Set(Object.keys(sc.graduated));

    // the gate only ever sees NOT-yet-graduated candidates — durable rules are held, not re-judged.
    const gateCandidates = candidates.filter((n) => !graduatedIds.has(n.id));

    // dedup context = this route's own skeleton + its durable rules (already always-loaded, so the gate
    // never re-proposes a graduated rule), PLUS the global BUILDER skeleton — but ONLY for builder-non-global
    // routes: shells/CLAUDE.md always-loads into every builder session, yet does NOT load into Hermes
    // sessions, so an operator rule must not be dropped as a duplicate of builder doctrine it never sees.
    const inheritGlobal = audience === 'builder' && scope !== 'global';
    const durableText = Object.values(sc.graduated).map((r) => `- ${r.rule}`).join('\n');
    const skeleton = [inheritGlobal ? skeletonOf(globalSkeleton) : '', skeletonOf(existing), durableText]
      .filter(Boolean).join('\n\n');

    // --- GATE (sticky), skipped when its inputs are unchanged: reuse last emerging set, no judge call.
    const gateSig = sha8(JSON.stringify([
      gateCandidates.map((n) => [n.id, contentHash(n.prose), n.frontmatter.centrality]),
      sha8(skeleton),
      (sc.emerging || []).map((r) => [r.rule, r.source]),
    ]));
    let emerging, gated;
    if (gateCandidates.length && gateSig !== sc.gateSig) {
      try {
        const got = await judge(gatePrompt(scope, audience, gateCandidates, skeleton, sc.emerging), { tier: 'hard', json: true });
        emerging = Array.isArray(got) ? got : [];
        gated = true;
      } catch (e) { audit.push({ scope, audience, key, file, error: e.message }); continue; }
    } else {
      emerging = sc.emerging || [];   // reuse — stickiness guarantees the gate would re-select it
      gated = false;
    }
    sc.gateSig = gateSig;

    // validate + resolve source against the gate candidates; order by centrality; backlink known ids only.
    emerging = emerging
      .filter((r) => r && typeof r.rule === 'string' && r.rule.trim())
      .map((r) => ({ rule: r.rule.trim(), source: gateCandidates.some((n) => n.id === r.source) ? r.source : null }))
      .sort((a, b) => centOf(b.source) - centOf(a.source));

    // --- STREAK: a survival = the rule is still selected (or reused while gate inputs hold). Consecutive.
    const keptIds = new Set(emerging.map((r) => r.source).filter(Boolean));
    for (const id of keptIds) sc.streaks[id] = (sc.streaks[id] || 0) + 1;
    for (const id of Object.keys(sc.streaks)) if (!keptIds.has(id)) delete sc.streaks[id];

    // --- GRADUATION: survived GRADUATE_AFTER consecutive runs -> move to the durable layer (leaves emerging).
    const graduated = [];
    for (const r of emerging) {
      if (r.source && (sc.streaks[r.source] || 0) >= GRADUATE_AFTER) {
        sc.graduated[r.source] = { rule: r.rule, source: r.source };
        delete sc.streaks[r.source];
        graduated.push(r.source);
      }
    }
    emerging = emerging.filter((r) => !graduated.includes(r.source));
    sc.emerging = emerging;

    // --- CAP (durable + emerging ≤ CAP); durable earned its place first, emerging fills the remainder.
    const durable = Object.values(sc.graduated).sort((a, b) => centOf(b.source) - centOf(a.source));
    const durableShown = durable.slice(0, CAP);
    const emergingShown = emerging.slice(0, Math.max(0, CAP - durableShown.length));
    const dropped = (durable.length - durableShown.length) + (emerging.length - emergingShown.length);

    // nothing to show AND no fence to clear -> don't create an empty file; drop any vestigial state.
    if (!durableShown.length && !emergingShown.length && !FENCE_RE.test(existing)) {
      if (!Object.keys(sc.streaks).length) delete state[key];
      audit.push({ scope, audience, key, file, skipped: 'no-candidates', graduated, demoted });
      continue;
    }

    const fence = renderFence(durableShown, emergingShown, gateSig);
    const next = spliceFence(existing, fence);

    if (dryRun) {
      audit.push({ scope, audience, key, file, durable: durableShown, emerging: emergingShown, graduated, demoted, dropped, gated, preview: fence, wrote: false });
      continue;
    }

    let commit = 'nochange';
    if (next !== existing) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, next, 'utf8');
      commit = await commitFile(file);
    }
    audit.push({ scope, audience, key, file, durable: durableShown, emerging: emergingShown, graduated, demoted, dropped, gated, wrote: next !== existing, commit });
  }

  // persist + commit projection state (no-op commit if unchanged, e.g. a fully-settled scope).
  if (!dryRun) { await saveProjState(state); await commitFile(PROJ_STATE_FILE); }
  return audit;
}

// pretty-print an audit (shared by reconcile + direct run).
export function printProjection(audit, dryRun) {
  console.log(`\n=== CLAUDE.md projection ${dryRun ? '(dry-run)' : ''} ===`);
  if (!audit.length) { console.log('  (no scopes considered)'); return; }
  const lifecycle = (a) => [a.graduated?.length ? `+${a.graduated.length} graduated` : '',
    a.demoted?.length ? `-${a.demoted.length} demoted` : ''].filter(Boolean).join(', ');
  for (const a of audit) {
    const label = a.key || a.scope;   // operator routes show as "<scope>::operator"
    if (a.skipped) { const lc = lifecycle(a); console.log(`  · ${label}: skipped (${a.skipped})${lc ? ` [${lc}]` : ''}`); continue; }
    if (a.error) { console.log(`  ✗ ${label}: gate failed — ${a.error}`); continue; }
    const where = a.commit ? `[${a.commit}]` : (dryRun ? '[preview]' : '');
    const tags = [a.gated ? 'gated' : 'reused', lifecycle(a), a.dropped ? `${a.dropped} over cap` : ''].filter(Boolean).join(', ');
    console.log(`  → ${label}: ${a.durable.length} durable / ${a.emerging.length} emerging (${tags}) ${where}  ${a.file}`);
    for (const r of a.durable) console.log(`      ★ ${r.rule}${r.source ? `  [[${r.source}]]` : ''}`);
    for (const r of a.emerging) console.log(`      · ${r.rule}${r.source ? `  [[${r.source}]]` : ''}`);
    if (dryRun && a.preview) console.log(a.preview.split('\n').map((l) => '      | ' + l).join('\n'));
  }
}

// Direct run for debugging:  node projection.mjs [--dry-run]   (projects the live pool)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const { loadPool } = await import('./nodes.mjs');
  const dryRun = process.argv.includes('--dry-run');
  const audit = await project(await loadPool(), { dryRun });
  printProjection(audit, dryRun);
}
