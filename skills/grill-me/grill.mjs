#!/usr/bin/env node
// grill.mjs — mechanical helper for the grill-me skill (active elicitation, DESIGN §8 mode 3).
//
// Two jobs, both purely mechanical. The INTERVIEW itself (one question at a time, recommend-an-answer,
// judging what's worth asking) is JUDGMENT and lives in SKILL.md, driven by the agent inline — NOT here.
//
//   look   — query the live graph (retrieval.mjs search) + the scope's docs so the interviewer never
//            asks what memory already knows ("look in the codebase first", §8).
//   flush  — parse the interview checkpoint -> entries[] -> capture()  (the shared staging writer).
//
// Single-writer invariant (MEM-8/9): this NEVER writes canonical nodes (knowledge/nodes/). It writes
// ONLY to the scope's staging/, and ONLY through the shared capture() pipeline (same writer both brains
// use). The reconciler stays the sole graph writer; it distills this staging into discovery nodes.
//
// Usage:
//   node grill.mjs look  --scope <s> ["topic"]
//   node grill.mjs flush --scope <s> --session <anchor> --checkpoint <path> [--brain claude|hermes] [--dry-run]

import { resolve, basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MEMORY_ROOT, NODES_DIR, loadPool } from '../../memory-engine/nodes.mjs';
import { EmbeddingCache, syncCache, search } from '../../memory-engine/retrieval.mjs';
// NOTE: capture-core.mjs reads CAPTURE_DRY_RUN at module-load time, so it is imported DYNAMICALLY
// inside flush() — AFTER we set the env var — so --dry-run actually suppresses the write.

const execFileP = promisify(execFile);
const CACHE_FILE = resolve(MEMORY_ROOT, '.cache', 'embeddings.json'); // same derived cache the reconciler keeps warm

// ---------- tiny arg parser ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function truncate(s, n) { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ============================================================ look (look-first retrieval)
async function look({ scope, topic }) {
  const pool = await loadPool();
  // Knowledge is shared: a scope sees its own nodes + the global pool (DESIGN §4 — scope is organization).
  const inScope = pool.filter((n) => !n.frontmatter.superseded && [scope, 'global'].includes(n.frontmatter.scope));

  console.log(`# look — scope: ${scope}${topic ? `  ·  topic: "${topic}"` : ''}`);
  console.log(`# ${inScope.length} live node(s) visible to this scope (own + global)\n`);

  if (!inScope.length) {
    console.log('(no nodes yet — this scope is unwritten; the interview is greenfield.)');
  } else if (topic) {
    const cache = await new EmbeddingCache(CACHE_FILE).load();
    await syncCache(inScope.map((n) => ({ id: n.id, prose: n.prose })), cache);
    await cache.save();
    const ids = await search(topic, inScope.map((n) => ({ id: n.id, prose: n.prose })), cache, NODES_DIR, 8);
    const byId = new Map(inScope.map((n) => [n.id, n]));
    console.log('## already known (semantic × keyword) — DO NOT re-ask these:');
    for (const id of ids) {
      const n = byId.get(id); if (!n) continue;
      console.log(`- [[${id}]] (${n.frontmatter.type}, c=${n.frontmatter.centrality ?? '?'}) ${n.frontmatter.title || ''}`);
      console.log(`    ${truncate(n.prose, 180)}`);
    }
  } else {
    console.log('## current state of this scope (by centrality) — fill the gaps around these:');
    for (const n of inScope.sort((a, b) => (b.frontmatter.centrality || 0) - (a.frontmatter.centrality || 0)).slice(0, 15)) {
      console.log(`- [[${n.id}]] (${n.frontmatter.type}, c=${n.frontmatter.centrality ?? '?'}) ${n.frontmatter.title || ''}`);
    }
  }

  // Also scan the scope's raw docs (identity stub, sources, scope shell) — they answer before the human does.
  if (topic) {
    const terms = (topic.match(/[\p{L}\p{N}]{3,}/gu) || []).slice(0, 8);
    if (terms.length) {
      const scopeDir = resolve(MEMORY_ROOT, 'scopes', scope);
      try {
        const { stdout } = await execFileP('rg', ['-l', '-i', '--no-messages', '-e', terms.join('|'),
          '--glob', '*.md', '--glob', '!staging/.grill/**', scopeDir]);
        const hits = stdout.trim().split('\n').filter(Boolean);
        if (hits.length) {
          console.log('\n## scope docs that mention the topic (read before asking):');
          for (const h of hits) console.log(`- ${h.replace(MEMORY_ROOT + '/', '')}`);
        }
      } catch { /* rg exits 1 on no match */ }
    }
  }
}

// ============================================================ flush (checkpoint -> staging via capture)
// Checkpoint format (human-facing + machine-parseable):
//   **Q:** <question>
//   **A:** <answer>            <- becomes a user turn (the elicited knowledge)
//   **A:** [open-flag] <why>   <- SKIPPED here; open-flags stay human-facing (checkpoint + report)
function parseCheckpoint(raw) {
  const pairs = [];
  let open = 0;
  const blocks = raw.split(/^\*\*Q:\*\*/m).slice(1); // text before the first Q is preamble
  for (const blk of blocks) {
    const parts = blk.split(/^\*\*A:\*\*/m);
    const q = truncateMultiline(parts[0]);
    // answer runs until the next section heading (e.g. "## Open flags"); the next Q already split us off
    let a = (parts[1] || '').split(/^\#\#\s/m)[0].trim();
    if (!q) continue;
    if (!a) { continue; }
    if (/^\[open-flag\]/i.test(a)) { open++; continue; } // gap, not knowledge — never staged
    pairs.push({ q, a });
  }
  return { pairs, open };
}
function truncateMultiline(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

async function flush({ scope, session, checkpoint, brain, dry }) {
  if (!session || !checkpoint) { console.error('flush needs --session and --checkpoint'); process.exit(2); }
  const raw = await readFile(checkpoint, 'utf8');
  const { pairs, open } = parseCheckpoint(raw);
  if (!pairs.length) { console.log(`flush: no answered Q&A in ${checkpoint} (open-flags: ${open}) — nothing to stage.`); return; }

  const ts = new Date().toISOString();
  const entries = [];
  for (const { q, a } of pairs) {
    entries.push({ role: 'assistant', text: `Q: ${q}`, ts });   // the question = context for the answer
    entries.push({ role: 'user', text: a, ts });                // the answer = the elicited knowledge (gets salience)
  }

  // Force the target scope explicitly (COCKPIT_SCOPE = capture's priority-1 override) so the flush lands
  // in the real scope regardless of cwd (scope-gating, MEM-14).
  process.env.COCKPIT_SCOPE = scope;
  if (dry) process.env.CAPTURE_DRY_RUN = '1';

  // Dynamic import: capture-core snapshots CAPTURE_DRY_RUN at load, so it must load AFTER the line above.
  const { capture } = await import('../../memory-engine/capture-core.mjs');
  const result = await capture({
    entries,
    cwd: process.cwd(),
    sessionId: session,
    event: 'grill-me',
    provenance: checkpoint.replace(MEMORY_ROOT + '/', ''),
    brain: brain || 'claude',
  });
  console.log(`flush: ${pairs.length} Q&A pair(s) staged, ${open} open-flag(s) held human-facing (not staged).`);
  console.log(JSON.stringify(result, null, 2));
  if (!dry && result && result.outFile) {
    console.log(`\nstaged: ${result.outFile}`);
    console.log('Next: the nightly dreaming pass (or `node memory-engine/reconcile.mjs --scope ' + scope + '`) distills it into discovery nodes.');
  }
}

// ============================================================ main
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const scope = args.scope;
if (!cmd || !scope) {
  console.error('usage:\n  node grill.mjs look  --scope <s> ["topic"]\n  node grill.mjs flush --scope <s> --session <anchor> --checkpoint <path> [--brain claude|hermes] [--dry-run]');
  process.exit(2);
}
try {
  if (cmd === 'look') await look({ scope, topic: args._[1] || null });
  else if (cmd === 'flush') await flush({ scope, session: args.session, checkpoint: args.checkpoint, brain: args.brain, dry: !!args['dry-run'] });
  else { console.error(`unknown command: ${cmd}`); process.exit(2); }
} catch (e) {
  console.error('grill.mjs error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
