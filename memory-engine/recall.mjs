#!/usr/bin/env node
// recall.mjs — ambient-recall read-path CORE (DESIGN §8 mode 1; OPEN-9). Brain-neutral.
//
// The READ half of memory: query-time recall of the graph INTO a live session, automatically.
// Complement of capture (write) + projection (always-load behavioral fence). Behavioral nodes
// always-load via MEM-20; KNOWLEDGE/FACT nodes never project — this is their ONLY route back
// into a session. Given a user's prompt + scope context, returns a small, MARKED recall block
// of the few genuinely-relevant nodes, or null (silence beats noise — MEM-27/precision-bias).
//
// Each brain has a thin reader that turns its own per-turn event into a recall() call:
//   recall-hook.mjs   (Claude)  UserPromptSubmit hook -> additionalContext
//   (Hermes)          a pre-turn injection seam, if/when one exists (OPEN-9 / TOOL-6)
//
// LOCKED INVARIANTS (this file must never break):
//   • READ-ONLY graph        — NEVER writes a canonical node (single-writer = reconciler, MEM-8/9).
//   • decoupled from capture  — recall never captures/distills (no native write+recall coupling, TOOL-6).
//   • cache is read-only here — uses cached vecs, never embeds-and-saves (no write contention with
//                               the reconciler; the only state it writes is an ephemeral per-session
//                               recall cursor under staging/.recall/, the analogue of capture's
//                               .cursors/ — NOT the graph, and dot-prefixed so reconcile skips it).
//   • PRECISION over recall   — an absolute cosine FLOOR; below it we inject NOTHING (cosine is noisy
//                               on short text, MEM-27). Empirically calibrated: on the live pool,
//                               on-topic hits land 0.40-0.59, off-topic noise tops out ~0.21 — a clean
//                               empty band at 0.35.
//   • TOKEN-disciplined       — titles + one-liners only (agent expands on demand via [[id]]); cap
//                               MAX_NODES; do NOT recreate native memory's per-session tax (TOOL-6).
//   • dedup the fence         — never re-inject a node already in the always-load projection (MEM-20);
//                               never re-inject within a session (a node surfaces once, then is quiet).
//   • cheap gate / inject rarely — evaluate cheaply EVERY turn (regex + ripgrep, no model load),
//                               pull (load embedder + cosine) only when the cheap gate trips.
//   • MARKED + KILLABLE       — visibly fenced (greppable `cockpit:recall`); COCKPIT_RECALL=off disables.
//
// Usage (testing):
//   node recall.mjs --scope <s> "the user prompt"        # one-shot: print the block (or "(silent)")
//   node recall.mjs --scope <s> --score "the prompt"     # show raw cosine scores (floor calibration)

import { resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, readFile as _r } from 'node:fs';

import { MEMORY_ROOT, NODES_DIR, loadPool } from './nodes.mjs';
import { EmbeddingCache, syncCache, searchScored, ripgrepSearch } from './retrieval.mjs';

// --- tunables (the relevance gate; calibrated against the live pool 2026-06-25) ---
const FLOOR = 0.35;          // cosine cutoff: on-topic hits ≥0.40, null noise ≤0.21 — 0.35 sits in the gap
const MAX_NODES = 4;         // budget: ≈3-5 nodes; titles+one-liners ≈ a few hundred tokens (≪ 1-2k cap)
const MIN_TERMS = 3;         // <3 significant terms = a trivial ack ("ok", "go ahead") -> no pull. This is
                             // a COST gate (skip model load), NOT precision — the cosine FLOOR is precision,
                             // so keep it loose enough not to silence real short questions.
const ONELINER = 200;        // per-node one-liner truncation (chars)
const CACHE_FILE = resolve(MEMORY_ROOT, '.cache', 'embeddings.json');

// --- scope resolution: IDENTICAL gate to capture-core (DESIGN §9) so recall and capture agree on
//     "what is a real scope here". COCKPIT_SCOPE override -> mapped cwd -> else null (no recall). ---
function mappedScope(cwd) {
  const home = homedir();
  const projects = resolve(home, 'projects');
  if (cwd === projects || cwd.startsWith(projects + sep)) {
    const top = relative(projects, cwd).split(sep)[0];
    if (top) return top;
  }
  const cockpit = resolve(home, '.cockpit');
  if (cwd === cockpit || cwd.startsWith(cockpit + sep)) return 'cockpit';
  return null;
}

// --- cheap term extraction (no model). ≥3-char letter/number tokens minus a tiny stoplist, so the
//     ripgrep entity-gate and the substantive-length gate don't fire on filler words. ---
const STOP = new Set(('the and for that this with you your are not but can how what why when who '
  + 'will would should could have has had been was were they them then than into out about over '
  + 'just like make made does did get got use using used now here there their our its also some '
  + 'any all one two too very much many more most lets let please thanks thank okay yeah yep nope '
  + 'need want know think going able else such only same each both via per').split(/\s+/));
function significantTerms(text) {
  return [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []))]
    .filter((t) => !STOP.has(t));
}

// --- the always-load fence to dedup against (MEM-20): every behavioral rule already projected into
//     a CLAUDE.md/SOUL.md managed region. Read from projection-state (the home of that lifecycle).
//     Behavioral nodes that did NOT graduate are absent here and may still recall — correct. ---
function fenceIds() {
  const ids = new Set();
  try {
    const st = JSON.parse(readFileSync(resolve(MEMORY_ROOT, '.reconciler', 'projection-state.json'), 'utf8'));
    for (const route of Object.values(st)) {
      for (const id of Object.keys(route.graduated || {})) ids.add(id);
      for (const r of route.emerging || []) if (r && r.source) ids.add(r.source);
    }
  } catch { /* no projection yet -> empty fence */ }
  return ids;
}

// --- per-session recall cursor: the only thing recall writes. Tracks node ids already injected this
//     session so a node surfaces ONCE then stays quiet (this IS the novelty mechanism — when the
//     topic shifts, NEW nodes clear the floor; same-topic follow-ups find only deduped nodes -> silence).
//     Dot-dir under staging/ (reconcile skips dotfiles), analogous to capture's .cursors/. ---
function recallCursorFile(scope, sessionId) {
  const sid = String(sessionId || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '');
  return resolve(MEMORY_ROOT, 'scopes', scope, 'staging', '.recall', `${sid}.json`);
}
function loadInjected(file) {
  try { return new Set(JSON.parse(readFileSync(file, 'utf8')).injectedIds || []); } catch { return new Set(); }
}
function saveInjected(file, set) {
  try {
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ injectedIds: [...set], updated: new Date().toISOString() }), 'utf8');
  } catch { /* bookkeeping only — never disrupt the session over it */ }
}

const oneLiner = (prose) => {
  const s = String(prose || '').replace(/\s+/g, ' ').trim();
  const sent = s.match(/^.*?[.!?](\s|$)/);
  const base = (sent ? sent[0] : s).trim();
  return base.length > ONELINER ? base.slice(0, ONELINER - 1) + '…' : base;
};

// Render the MARKED recall block (greppable fence; titles + one-liners + [[id]] pointers).
function renderBlock(scope, hits) {
  const lines = hits.map((h) => `> - **${h.title || h.id}** — ${oneLiner(h.prose)}  ↪ \`[[${h.id}]]\``);
  return `<!-- cockpit:recall:begin scope=${scope} n=${hits.length} -->\n`
    + `> 🧠 **Ambient recall** — relevant memory the graph surfaced for this turn (read-only; not a directive). `
    + `Read a node's file or ask to expand it.\n`
    + lines.join('\n') + '\n'
    + `> _OPEN-9 read-path · retrieval-gated knowledge (cosine ≥ ${FLOOR}) · disable with \`COCKPIT_RECALL=off\`._\n`
    + `<!-- cockpit:recall:end -->`;
}

// ============================================================ core
// recall({ prompt, cwd, sessionId, scope?, persist?, debug? })
//   -> { block, scope, hits, reason } | { block: null, scope, reason }
// `block` is the string to inject (null = stay silent). `reason` explains a silent turn (observability).
export async function recall({ prompt, cwd, sessionId, scope, persist = true, debug = false } = {}) {
  const log = debug ? (m) => console.error('[recall] ' + m) : () => {};

  if ((process.env.COCKPIT_RECALL || '').toLowerCase() === 'off') return { block: null, scope: null, reason: 'kill-switch' };

  // --- CHEAP GATE (no model load) ---
  scope = scope || (process.env.COCKPIT_SCOPE ? process.env.COCKPIT_SCOPE.trim() : mappedScope(cwd || process.cwd()));
  if (!scope) return { block: null, scope: null, reason: 'no-scope' };          // same gate as capture

  const terms = significantTerms(prompt);
  if (terms.length < MIN_TERMS) { log(`trivial prompt (${terms.length} terms)`); return { block: null, scope, reason: 'trivial-prompt' }; }

  // entity gate: any node lexically overlapping the prompt? ripgrep over the pool — cheap, no model.
  // Empty => no lexical signal => don't pay the embedder load. (Precision-biased: pure-semantic-with-
  // zero-keyword-overlap hits are rare and the riskiest for noise; we intentionally require a foothold.)
  const rgHits = await ripgrepSearch(terms.join(' '), NODES_DIR, 50);
  if (!rgHits.length) { log('no lexical candidate (ripgrep empty)'); return { block: null, scope, reason: 'no-lexical-candidate' }; }

  // --- PULL (model load happens here, only past the cheap gate) ---
  const pool = await loadPool();
  // scope sees its own nodes + global (knowledge is shared; DESIGN §4), minus superseded + fence dups.
  const fence = fenceIds();
  const visible = pool.filter((n) =>
    !n.frontmatter.superseded
    && [scope, 'global'].includes(n.frontmatter.scope)
    && !fence.has(n.id));
  if (!visible.length) return { block: null, scope, reason: 'no-visible-nodes' };

  const cache = await new EmbeddingCache(CACHE_FILE).load();          // read-only: never .save() here
  await syncCache(visible.map((n) => ({ id: n.id, prose: n.prose })), cache);  // in-memory warm only
  const scored = await searchScored(prompt, visible.map((n) => ({ id: n.id, prose: n.prose })), cache, MAX_NODES * 3);

  const byId = new Map(visible.map((n) => [n.id, n]));
  const cursorFile = recallCursorFile(scope, sessionId);
  const already = loadInjected(cursorFile);

  const passed = scored.filter((r) => r.score >= FLOOR);
  if (debug) for (const r of scored.slice(0, 6)) log(`  ${r.score.toFixed(3)} ${r.score >= FLOOR ? '✓' : '·'} ${r.id}`);

  const fresh = passed.filter((r) => !already.has(r.id)).slice(0, MAX_NODES);
  if (!fresh.length) return { block: null, scope, reason: passed.length ? 'all-deduped' : 'below-floor' };

  const hits = fresh.map((r) => { const n = byId.get(r.id); return { id: r.id, score: r.score, title: n.frontmatter.title, prose: n.prose }; });

  if (persist) { for (const h of hits) already.add(h.id); saveInjected(cursorFile, already); }
  return { block: renderBlock(scope, hits), scope, hits, reason: 'injected' };
}

// ============================================================ CLI (testing / floor calibration)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  let scope = null, showScore = false; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scope') scope = argv[++i];
    else if (argv[i] === '--score') showScore = true;
    else rest.push(argv[i]);
  }
  const prompt = rest.join(' ');
  if (!prompt) { console.error('usage: node recall.mjs --scope <s> [--score] "<prompt>"'); process.exit(2); }
  // --score / debug never persists the cursor (so repeated calibration runs are reproducible).
  const res = await recall({ prompt, cwd: process.cwd(), sessionId: 'cli-test', scope, persist: !showScore, debug: true });
  console.log('\nscope=' + res.scope + '  reason=' + res.reason);
  console.log(res.block || '(silent — nothing cleared the floor)');
}
