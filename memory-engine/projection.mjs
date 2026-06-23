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
// Damping: the input signature is embedded in the begin-marker (`inputs=<sha8>`). If a scope's
// eligible nodes + skeleton are unchanged since the last projection, the run is a no-op for that
// scope — no judge call, no write — so CLAUDE.md diffs stay stable run-to-run.

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
const CAP = 12;                 // ≤ BUILD-4's 10–15 cap on the always-load ## Rules block
const PROSE_CHARS = 500;        // per-candidate truncation handed to the gate

const HOME = homedir();
const COCKPIT_ROOT = resolve(HOME, '.cockpit');
const GLOBAL_SKELETON = resolve(COCKPIT_ROOT, 'shells', 'CLAUDE.md'); // canonical global shell (~/CLAUDE.md just imports it)
const KNOWN_SCOPES = ['global', 'cockpit', 'content', 'job-search'];

const sha8 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const isBehavioral = (n) => ['identity', 'feedback'].includes(n.frontmatter?.type) && !n.frontmatter?.superseded;

// scope → CANONICAL projection target. The reconciler writes ONLY its own two repos; project/client
// load-points (~/projects/<x>/CLAUDE.md) are thin hand-written loaders that @-import these canonicals,
// so foreign repos stay pristine. System scopes project public (cockpit repo); data scopes project
// private (memory repo, riding the same commit as the nodes they derive from).
//   global  → shells/CLAUDE.md      — public cockpit repo; ~/CLAUDE.md (loader) @-imports it.
//   cockpit → ~/.cockpit/CLAUDE.md  — public cockpit repo; load-point already in-repo, no loader.
//   <x>     → memory/scopes/<x>/CLAUDE.md — PRIVATE memory repo; ~/projects/<x>/CLAUDE.md loader imports it.
function targetFor(scope) {
  if (scope === 'global') return GLOBAL_SKELETON;                  // shells/CLAUDE.md (the canonical root shell)
  if (scope === 'cockpit') return resolve(COCKPIT_ROOT, 'CLAUDE.md');
  return resolve(MEMORY_ROOT, 'scopes', scope, 'CLAUDE.md');       // private memory repo (data scopes)
}

// ---------- fence (DESIGN §6a.4) ----------
const FENCE_RE = /[ \t]*<!-- managed:reconciler:begin\b[^>]*-->[\s\S]*?<!-- managed:reconciler:end -->\n?/;
const INPUTS_RE = /<!-- managed:reconciler:begin\b[^>]*\binputs=([0-9a-f]+)/;

function existingInputs(text) { const m = text.match(INPUTS_RE); return m ? m[1] : null; }

function renderFence(rules, inputsHash) {
  let body = `<!-- managed:reconciler:begin schema=1 inputs=${inputsHash} -->\n`
    + `## Rules (projected from memory — do not edit; edit the source node)\n`;
  body += rules.length
    ? rules.map((r) => `- ${r.rule}${r.source ? ` [[${r.source}]]` : ''}`).join('\n') + '\n'
    : `_(no rules currently meet the always-load bar — see retrieval-gated memory)_\n`;
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

// ---------- the adversarial gate (judge, hard tier) ----------
function gatePrompt(scope, candidates, skeleton) {
  const cand = candidates.map((n) =>
    `[${n.id}] (centrality ${n.frontmatter.centrality}) ${n.frontmatter.title}\n  ${truncate(n.prose.replace(/\s+/g, ' '), PROSE_CHARS)}`
  ).join('\n\n');
  return `You curate the ALWAYS-LOADED behavioral rules for the "${scope}" scope's CLAUDE.md — the few \
operating rules worth putting in front of the model in EVERY session (not retrieval-gated). Below are \
candidate behavioral memory nodes, and the rules ALREADY hand-written in the always-loaded skeleton.

Pick ONLY the candidates that genuinely deserve always-loading, applying an adversarial lens:
- DROP anything already covered by the skeleton (do not restate existing doctrine — that is bloat).
- DROP transient / build-in-progress scaffolding ("we are currently on phase X") — keep only DURABLE rules
  that will still matter after the current work ships.
- DROP vague platitudes; keep crisp, actionable operating rules.
- Rephrase each survivor as ONE tight imperative line (≤ ~20 words). Keep its source node id.
- Hard cap ${CAP}. Prefer FEW. Returning an EMPTY array is a correct, common outcome.

Reply ONLY a JSON array (possibly empty): [{ "rule": "<imperative one-liner>", "source": "<candidate node id>" }]

ALREADY-LOADED SKELETON (do not duplicate these):
"""
${skeleton || '(none)'}
"""

CANDIDATES:
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
    if (/nothing to commit/i.test(e.stderr || e.stdout || '')) return 'nochange';
    throw e;
  }
}

// ============================================================ main entry
// project(pool, { dryRun }) -> audit array. Called by reconcile.mjs after PHASE-1 node commit.
export async function project(pool, { dryRun = false } = {}) {
  const globalSkeleton = await readFile(GLOBAL_SKELETON, 'utf8').catch(() => '');

  // scopes to consider: any with behavioral candidates, plus any KNOWN scope whose CLAUDE.md already
  // carries a fence (so a now-empty scope's stale fence gets cleared).
  const scopes = new Set(pool.filter(isBehavioral).map((n) => n.frontmatter.scope));
  for (const s of KNOWN_SCOPES) {
    const t = await readFile(targetFor(s), 'utf8').catch(() => null);
    if (t && FENCE_RE.test(t)) scopes.add(s);
  }

  const audit = [];
  for (const scope of [...scopes].sort()) {
    const file = targetFor(scope);
    const existing = await readFile(file, 'utf8').catch(() => '');

    // candidates: behavioral, this scope, above the centrality floor, strongest first.
    const candidates = pool
      .filter((n) => isBehavioral(n) && n.frontmatter.scope === scope && (n.frontmatter.centrality || 0) >= CENTRALITY_FLOOR)
      .sort((a, b) => (b.frontmatter.centrality || 0) - (a.frontmatter.centrality || 0));

    // dedup context = global skeleton (always loads) + this scope's own skeleton (if not global).
    const skeleton = [scope === 'global' ? '' : skeletonOf(globalSkeleton), skeletonOf(existing)]
      .filter(Boolean).join('\n\n');

    // damping signature: eligible nodes (id+contenthash+centrality) + the skeleton we dedup against.
    const sig = sha8(JSON.stringify([
      candidates.map((n) => [n.id, contentHash(n.prose), n.frontmatter.centrality]),
      sha8(skeleton),
    ]));
    if (existingInputs(existing) === sig) { audit.push({ scope, file, skipped: 'unchanged' }); continue; }

    // nothing to project AND no fence to clear -> don't create an empty file.
    if (!candidates.length && !FENCE_RE.test(existing)) { audit.push({ scope, file, skipped: 'no-candidates' }); continue; }

    // the gate.
    let rules = [];
    if (candidates.length) {
      try {
        const got = await judge(gatePrompt(scope, candidates, skeleton), { tier: 'hard', json: true });
        if (Array.isArray(got)) rules = got;
      } catch (e) { audit.push({ scope, file, error: e.message }); continue; }
    }

    // validate + cap. order survivors by candidate centrality; keep backlink only for known ids.
    const cByCent = new Map(candidates.map((n) => [n.id, n.frontmatter.centrality || 0]));
    rules = rules
      .filter((r) => r && typeof r.rule === 'string' && r.rule.trim())
      .map((r) => ({ rule: r.rule.trim(), source: cByCent.has(r.source) ? r.source : null }))
      .sort((a, b) => (cByCent.get(b.source) || 0) - (cByCent.get(a.source) || 0));
    const dropped = Math.max(0, rules.length - CAP);
    rules = rules.slice(0, CAP);

    const fence = renderFence(rules, sig);
    const next = spliceFence(existing, fence);

    if (dryRun) { audit.push({ scope, file, rules, dropped, preview: fence, wrote: false }); continue; }

    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, next, 'utf8');
    const commit = await commitFile(file);
    audit.push({ scope, file, rules, dropped, wrote: true, commit });
  }
  return audit;
}

// pretty-print an audit (shared by reconcile + direct run).
export function printProjection(audit, dryRun) {
  console.log(`\n=== CLAUDE.md projection ${dryRun ? '(dry-run)' : ''} ===`);
  if (!audit.length) { console.log('  (no scopes considered)'); return; }
  for (const a of audit) {
    if (a.skipped) { console.log(`  · ${a.scope}: skipped (${a.skipped})`); continue; }
    if (a.error) { console.log(`  ✗ ${a.scope}: gate failed — ${a.error}`); continue; }
    const where = a.commit ? `[${a.commit}]` : (dryRun ? '[preview]' : '');
    console.log(`  → ${a.scope}: ${a.rules.length} rule(s)${a.dropped ? ` (+${a.dropped} over cap, dropped)` : ''} ${where}  ${a.file}`);
    for (const r of a.rules) console.log(`      - ${r.rule}${r.source ? `  [[${r.source}]]` : ''}`);
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
