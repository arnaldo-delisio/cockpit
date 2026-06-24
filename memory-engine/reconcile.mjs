#!/usr/bin/env node
// reconcile.mjs — the single-writer reconciler (DESIGN §5; MEM-8/9/11/12). THE HEART.
//
// Reads each live scope's near-raw staging (what capture appended), distills it into canonical
// graph nodes via judge() (the model adapter), dedups against the existing pool, and commits —
// the ONLY writer of knowledge/nodes/ (MEM-8). v1 = single on-demand batch command; the nightly
// "dreaming" timer (§8 mode 2) is later.
//
// Locked invariants this file must never break:
//   • single-writer        — only this process writes canonical nodes (lockfile-fenced, MEM-9).
//   • two-phase commit      — commit nodes FIRST, THEN advance the consumed marker; a crash between
//                             re-processes the same staging next run, and dedup absorbs it (idempotent).
//   • fact needs a citation — a claim distilled from a real captured turn cites it
//                             (stg:<anchor>:<sha8(turn-text)>); otherwise it downgrades to inference.
//   • instability guard     — a rewrite that drops a citation / swings centrality / flips a high-
//                             centrality node's cluster is HELD for review, never auto-committed.
//   • bootstrap mode (§6a.3)— below a node-count floor the graph is too sparse for heavy recompute/GC;
//                             we append + use the model's coarse centrality/cluster, no thrash.
//
// Usage:  node reconcile.mjs [--dry-run] [--scope <name>]
//   --dry-run : full preview (loads model, calls judge, prints the audit diff) with ZERO writes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, open, unlink, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { judge } from './judge.mjs';
import { MEMORY_ROOT, NODES_DIR, INDEX_FILE, loadPool, writeNode, serializeNode, uniqueId } from './nodes.mjs';
import { EmbeddingCache, syncCache, embed, contentHash, cosineTopK } from './retrieval.mjs';
import { project, printProjection } from './projection.mjs';

const execFileP = promisify(execFile);

const LIVE_SCOPES = ['global', 'cockpit', 'content', 'job-search', 'boringscale'];

// --- tunables (grey-area picks; tune after real runs) ---
const SIM_MERGE = 0.82;            // cosine ≥ this -> proposed node is a merge/supersede candidate
const BOOTSTRAP_MAX_NODES = 12;    // below this, append-only mode: no heavy recompute/GC (§6a.3)
const DIGEST_TURN_CAP = 80;        // bound judge cost: at most this many turns per scope digest
const TURN_CHARS = 600;            // per-turn truncation in the digest
const GUARD_CENTRALITY_DELTA = 0.25;
const GUARD_HIGH_CENTRALITY = 0.50;

// --- paths ---
const RECON_DIR = resolve(MEMORY_ROOT, '.reconciler');
const STATE_FILE = resolve(RECON_DIR, 'state.json');                 // committed: consumed markers
const LOCK_FILE = resolve(RECON_DIR, 'lock');                       // gitignored: transient fence
const CACHE_FILE = resolve(MEMORY_ROOT, '.cache', 'embeddings.json'); // gitignored: derived
const AUDIT_DIR = resolve(RECON_DIR, 'audit');
const PENDING_DIR = resolve(RECON_DIR, 'pending-review');

const nowISO = () => new Date().toISOString();
const sha8 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// ============================================================ lockfile fencing (MEM-9)
async function acquireLock() {
  await mkdir(RECON_DIR, { recursive: true });
  try {
    const fh = await open(LOCK_FILE, 'wx');                 // atomic create-or-fail
    await fh.writeFile(JSON.stringify({ pid: process.pid, at: nowISO() }));
    await fh.close();
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // someone holds it — steal only if that pid is dead (crash recovery)
    let held = {};
    try { held = JSON.parse(await readFile(LOCK_FILE, 'utf8')); } catch { /* garbled */ }
    if (held.pid && isAlive(held.pid)) {
      console.error(`reconcile: another instance is running (pid ${held.pid}, since ${held.at}). Exiting.`);
      return false;
    }
    console.error(`reconcile: clearing stale lock (pid ${held.pid || '?'} not alive).`);
    await unlink(LOCK_FILE).catch(() => {});
    return acquireLock();
  }
}
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
async function releaseLock() { await unlink(LOCK_FILE).catch(() => {}); }

// ============================================================ state (consumed markers)
async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { return { consumed: {} }; }
}
async function saveState(state) {
  await mkdir(RECON_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ============================================================ staging ingestion
// capture writes turns as:  #### <role> · <ts>  [tag, tag]\n<text>\n\n
function parseStaging(text) {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (fmMatch) for (const ln of fmMatch[1].split('\n')) {
    const i = ln.indexOf(':'); if (i > 0) fm[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  const turns = text.split(/\n#### /).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const header = nl === -1 ? part : part.slice(0, nl);
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    const tagM = header.match(/\[([^\]]+)\]\s*$/);
    return {
      role: header.split('·')[0].trim(),
      tags: tagM ? tagM[1].split(',').map((s) => s.trim()).filter(Boolean) : [],
      text: body,
    };
  });
  return { anchor: fm.session_anchor || 'unknown', scope: fm.scope, transcript: fm.transcript, brain: fm.brain, turns };
}

async function stagingFiles(scope) {
  const dir = resolve(MEMORY_ROOT, 'scopes', scope, 'staging');
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map((f) => resolve(dir, f));
  } catch { return []; }
}

// Build a compact digest from UNCONSUMED turns: salience-flagged turns (MEM-22) + their neighbors
// for context, plus an unmarked sample as the safety-net sweep. Returns { digest, turnIndex }.
function buildDigest(turns) {
  const keep = new Set();
  turns.forEach((t, i) => {
    if (t.tags.length) { keep.add(i); if (turns[i - 1]) keep.add(i - 1); if (turns[i + 1]) keep.add(i + 1); }
  });
  if (keep.size < 3) turns.forEach((t, i) => { if (t.role === 'user' && t.text) keep.add(i); }); // safety net
  const idx = [...keep].sort((a, b) => a - b).filter((i) => turns[i].text).slice(0, DIGEST_TURN_CAP);
  const turnIndex = {};
  const digest = idx.map((i) => {
    turnIndex[i] = turns[i].text;
    const tag = turns[i].tags.length ? ` {${turns[i].tags.join(',')}}` : '';
    return `[T${i}] (${turns[i].role})${tag}: ${truncate(turns[i].text, TURN_CHARS)}`;
  }).join('\n\n');
  return { digest, turnIndex };
}

// ============================================================ distillation (judge, hard tier)
const DISTILL_SCHEMA = `Return ONLY a JSON array (possibly empty). Each element is a node:
{
  "title": "<short human title>",
  "type": "knowledge" | "identity" | "feedback",
  "scope": "<scope>",
  "prose": "<2-5 sentences of distilled, self-contained fact/lesson — clean enough to embed; NOT a transcript quote>",
  "tags": ["<free-form>", ...],
  "entities": { "concepts": [...], "people": [...], "products": [...] },
  "centrality": <0.0-1.0 importance>,
  "cluster": "<short topic label>",
  "source_turns": ["T3", ...],
  "links": ["<existing-or-expected node id to wikilink>", ...]
}`;

function distillPrompt(scope, digest) {
  return `You are the memory reconciler's distiller for the "${scope}" scope. Below is a near-raw \
digest of captured conversation turns (each "[Tn]" is a turn; "{...}" are mechanical salience markers: \
#good/#bad = explicit human verdict, keep/correction/decision/error = inferred).

Distill DURABLE memory from it — facts worth remembering, decisions, and behavioral lessons. Rules:
- DISTILL, don't dump: only durable, reusable knowledge. Skip transient chatter, tool noise, one-offs.
- type "feedback" = a behavioral lesson (how to work) minted from a correction/#bad/decision/#good.
- type "identity" = durable truth about who is served / voice / mission / standing preference.
- type "knowledge" = a distilled fact or relationship.
- "source_turns" = the [Tn] ids that back the node (for provenance). Omit if it's pure synthesis.
- "centrality" = how load-bearing this is (0=trivial, 1=foundational). "cluster" = a short topic label.
- Prefer FEW high-quality nodes over many shallow ones. Empty array if nothing is durable.

${DISTILL_SCHEMA}

DIGEST:
${digest}`;
}

// ============================================================ dedup / merge (judge, bulk tier)
function mergePrompt(proposed, existing) {
  return `A new memory node is proposed. An existing node is semantically very close. Decide the action.
Reply ONLY JSON: { "action": "merge" | "supersede" | "new", "prose": "<resulting prose if merge/supersede, else omit>", "reason": "<short>" }
- "merge": same fact/lesson -> combine into one improved prose (keep the existing node id).
- "supersede": the new one REPLACES/contradicts the old (old kept but marked not-current).
- "new": actually distinct despite similarity -> keep both.

EXISTING [${existing.id}] (${existing.frontmatter.type}): ${existing.prose}

PROPOSED (${proposed.type}): ${proposed.prose}`;
}

// ============================================================ INDEX.md regeneration (§6a.3/§7)
function renderIndex(nodes) {
  const live = nodes.filter((n) => !n.frontmatter.superseded);
  const byCluster = {};
  for (const n of live) (byCluster[n.frontmatter.cluster || 'unclustered'] ||= []).push(n);
  let out = `<!-- generated by the reconciler — do not hand-edit (DESIGN §6a.3 / §7) -->\n# Knowledge INDEX\n\n`;
  if (!live.length) { out += `_Empty — append-only bootstrap mode until ≥1 centroid node per cluster exists (DESIGN §6a.3)._\n`; return out; }
  out += `_${live.length} node(s), regenerated ${nowISO()}._\n\n`;
  for (const cluster of Object.keys(byCluster).sort()) {
    out += `## ${cluster}\n`;
    for (const n of byCluster[cluster].sort((a, b) => (b.frontmatter.centrality || 0) - (a.frontmatter.centrality || 0))) {
      out += `- [[${n.id}]] — ${truncate((n.prose || '').replace(/\s+/g, ' '), 120)}\n`;
    }
    out += '\n';
  }
  return out;
}

// ============================================================ git (two-phase commit, MEM-9/12)
async function git(args) { return execFileP('git', ['-C', MEMORY_ROOT, ...args]); }
async function gitCommit(message, paths) {
  await git(['add', ...paths]);
  try { await git(['commit', '-m', message, '--quiet']); }
  catch (e) { if (!/nothing to commit/i.test(e.stderr || e.stdout || '')) throw e; }
}

// ============================================================ main pipeline
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const scopeArg = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : null;
  const scopes = scopeArg ? [scopeArg] : LIVE_SCOPES;

  if (!(await acquireLock())) process.exit(1);
  try {
    const state = await loadState();
    state.consumed ||= {};

    // ---- read all unconsumed staging across scopes ----
    const work = [];   // { scope, file, anchor, transcript, newTurns, turnIndex, digest, totalTurns }
    for (const scope of scopes) {
      for (const file of await stagingFiles(scope)) {
        const parsed = parseStaging(await readFile(file, 'utf8'));
        const consumed = state.consumed[file] || 0;
        if (parsed.turns.length <= consumed) continue;          // nothing new in this file
        const newTurns = parsed.turns.slice(consumed);
        const { digest, turnIndex } = buildDigest(newTurns);
        if (!digest.trim()) { state.consumed[file] = parsed.turns.length; continue; } // only noise -> mark consumed
        work.push({ scope, file, anchor: parsed.anchor, transcript: parsed.transcript, brain: parsed.brain,
          turnIndex, digest, totalTurns: parsed.turns.length, consumed });
      }
    }
    if (!work.length) {
      console.log('reconcile: no new staging to process.');
      // still project the existing pool into CLAUDE.md (MEM-20) — damping makes it a no-op if unchanged.
      printProjection(await project(await loadPool(), { dryRun }), dryRun);
      return;
    }

    // ---- load pool + embedding cache ----
    const pool = await loadPool();
    const cache = await new EmbeddingCache(CACHE_FILE).load();
    await syncCache(pool, cache);
    const poolEntries = () => pool.map((n) => ({ id: n.id, vec: cache.get(n.id, contentHash(n.prose)) })).filter((e) => e.vec);
    const takenIds = new Set(pool.map((n) => n.id));
    const bootstrapMode = pool.length < BOOTSTRAP_MAX_NODES;

    const audit = { added: [], modified: [], superseded: [], held: [], scopes: {} };

    // ---- per work-unit: distill -> dedup -> stage writes ----
    for (const w of work) {
      let proposals;
      try { proposals = await judge(distillPrompt(w.scope, w.digest), { tier: 'hard', json: true }); }
      catch (e) { console.error(`reconcile: distill failed for ${basename(w.file)} (${e.message}); skipping.`); continue; }
      if (!Array.isArray(proposals)) { console.error(`reconcile: non-array distill for ${basename(w.file)}; skipping.`); continue; }
      audit.scopes[w.scope] = (audit.scopes[w.scope] || 0) + proposals.length;

      // audience (B4): brain stamp is per-file (sessions are single-brain) -> audience is per work-unit,
      // independent of any p.scope override. Hermes-origin staging mints operator nodes; default builder.
      const audience = w.brain === 'hermes' ? 'operator' : 'builder';

      for (const p of proposals) {
        if (!p || !p.prose || !p.title) continue;
        const scope = p.scope || w.scope;

        // citation (grey-area-1): first backing turn -> stg:<anchor>:<sha8(turn-text)>, else inference.
        let citation;
        for (const ref of (p.source_turns || [])) {
          const i = String(ref).replace(/[^\d]/g, '');
          if (w.turnIndex[i]) { citation = `stg:${w.anchor}:${sha8(w.turnIndex[i])}`; break; }
        }
        const claim = citation ? 'fact' : 'inference';

        // embed proposal + find nearest existing node
        const [pv] = await embed([p.prose]);
        const near = cosineTopK(pv, poolEntries(), 1)[0];
        let action = 'new', mergedProse = null;
        if (near && near.score >= SIM_MERGE) {
          const existing = pool.find((n) => n.id === near.id);
          try {
            const d = await judge(mergePrompt({ ...p, scope }, existing), { tier: 'bulk', json: true });
            action = ['merge', 'supersede', 'new'].includes(d?.action) ? d.action : 'new';
            mergedProse = d?.prose || null;
          } catch { action = 'new'; }
          if (action === 'merge') { stageMerge(existing, p, mergedProse, scope, audience, claim, citation, audit, cache, pv); continue; }
          if (action === 'supersede') { stageSupersede(existing, audit); /* fall through to mint the new node */ }
        }
        stageNew(p, scope, audience, claim, citation, takenIds, pool, audit, cache, w.anchor, pv);
      }
    }

    // ---- audit summary ----
    printAudit(audit, dryRun, bootstrapMode);

    if (dryRun) {
      printProjection(await project(pool, { dryRun: true }), true);   // preview the CLAUDE.md projection too
      console.log('\n(--dry-run: no writes, no commits, staging not advanced.)');
      return;
    }

    // ---- PHASE 1: write nodes + INDEX, commit ----
    const touched = [...audit.added, ...audit.modified, ...audit.superseded].map((x) => x.id);
    if (touched.length) {
      for (const n of pool) if (touched.includes(n.id)) await writeNode(n);
      await writeFile(INDEX_FILE, renderIndex(pool), 'utf8');
      await syncCache(pool, cache); await cache.save();
      const summary = `reconcile: +${audit.added.length} ~${audit.modified.length} »${audit.superseded.length}`
        + (audit.held.length ? ` (held ${audit.held.length})` : '');
      await gitCommit(summary, ['knowledge/']);
    }
    // held proposals -> pending-review queue (lower trust, never auto-committed)
    if (audit.held.length) {
      await mkdir(PENDING_DIR, { recursive: true });
      for (const h of audit.held) await writeFile(resolve(PENDING_DIR, `${h.id}.md`), h.payload, 'utf8');
    }

    // ---- PHASE 2: advance consumed markers, commit (AFTER nodes are durable) ----
    for (const w of work) state.consumed[w.file] = w.totalTurns;
    await saveState(state);
    await gitCommit('reconcile: advance consumed markers', ['.reconciler/state.json']);

    // ---- audit diff artifact ----
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(resolve(AUDIT_DIR, `${nowISO().replace(/[:.]/g, '-')}.md`), auditMarkdown(audit), 'utf8');
    console.log(`\nreconcile: committed. ${touched.length} node file(s) written.`);

    // ---- PHASE 3: project behavioral nodes into scope-routed CLAUDE.md (MEM-20 / §6a.4) ----
    printProjection(await project(pool, { dryRun: false }), false);
  } finally {
    await releaseLock();
  }
}

// ---- staging helpers (mutate `pool` + `audit` in place; the writer commits the pool) ----
function stageNew(p, scope, audience, claim, citation, takenIds, pool, audit, cache, anchor, pv) {
  const id = uniqueId(p.title, takenIds);
  const node = {
    id,
    frontmatter: {
      id, title: p.title, type: ['knowledge', 'identity', 'feedback'].includes(p.type) ? p.type : 'knowledge',
      claim, scope, audience,
      centrality: clamp01(p.centrality), cluster: p.cluster || 'unclustered',
      tags: arr(p.tags), entities: ent(p.entities),
      ...(citation ? { citation } : {}),
      schema_version: 1, created: nowISO(), updated: nowISO(), last_synced: nowISO(),
    },
    body: bodyWithLinks(p.prose, p.links),
    prose: p.prose,
  };
  pool.push(node);
  if (pv) cache.set(id, contentHash(p.prose), pv);   // so later same-run proposals can dedup against it
  audit.added.push({ id, title: p.title, claim, type: node.frontmatter.type });
}

function stageMerge(existing, p, mergedProse, scope, audience, claim, citation, audit, cache, pv) {
  const before = { centrality: existing.frontmatter.centrality || 0, cluster: existing.frontmatter.cluster, hadCitation: !!existing.frontmatter.citation };
  const newProse = mergedProse || existing.prose;
  const newCentrality = clamp01(Math.max(existing.frontmatter.centrality || 0, p.centrality || 0));
  const newCluster = existing.frontmatter.cluster || p.cluster || 'unclustered';
  // instability guard (MEM-9): hold the rewrite if it destabilizes
  const reasons = instabilityReasons(
    { centrality: before.centrality, cluster: before.cluster, hadCitation: before.hadCitation },
    { centrality: newCentrality, cluster: newCluster, hasCitation: !!citation, claim },
  );
  if (reasons.length) {
    audit.held.push({ id: `${existing.id}--merge-${sha8(p.prose)}`, reasons,
      payload: `# HELD merge into [[${existing.id}]]\nreasons: ${reasons.join(', ')}\n\n## existing\n${existing.prose}\n\n## proposed\n${p.prose}\n` });
    return;
  }
  existing.body = bodyWithLinks(newProse, p.links);
  existing.prose = newProse;
  existing.frontmatter.centrality = newCentrality;
  existing.frontmatter.cluster = newCluster;
  // audience (B4, GA3): any operator provenance on a merged span -> operator; pre-B4 node (no audience) = builder.
  existing.frontmatter.audience = (existing.frontmatter.audience === 'operator' || audience === 'operator') ? 'operator' : 'builder';
  existing.frontmatter.tags = [...new Set([...(existing.frontmatter.tags || []), ...arr(p.tags)])];
  if (citation && !existing.frontmatter.citation) { existing.frontmatter.citation = citation; existing.frontmatter.claim = 'fact'; }
  existing.frontmatter.updated = nowISO();
  existing.frontmatter.last_synced = nowISO();
  audit.modified.push({ id: existing.id, title: existing.frontmatter.title });
}

function stageSupersede(existing, audit) {
  if (existing.frontmatter.superseded) return;
  existing.frontmatter.superseded = true;
  existing.frontmatter.updated = nowISO();
  audit.superseded.push({ id: existing.id, title: existing.frontmatter.title });
}

// ---- small pure helpers ----
// instability guard (MEM-9), exported pure for testing. before/after carry the comparable fields;
// any returned reason => the rewrite is HELD for review instead of auto-committed.
export function instabilityReasons(before, after) {
  const reasons = [];
  const bc = before.centrality || 0, ac = after.centrality || 0;
  if (before.hadCitation && !after.hasCitation && after.claim !== 'fact') reasons.push('citation-drop');
  if (Math.abs(ac - bc) > GUARD_CENTRALITY_DELTA) reasons.push('centrality-delta');
  if (after.cluster !== before.cluster && bc >= GUARD_HIGH_CENTRALITY) reasons.push('cluster-flip');
  return reasons;
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
const ent = (e) => ({ concepts: arr(e?.concepts), people: arr(e?.people), products: arr(e?.products) });
function bodyWithLinks(prose, links) {
  // strip any [[ ]] the model already added, dedup, then wrap once.
  const l = [...new Set(arr(links).map((x) => String(x).replace(/[[\]]/g, '').trim()).filter(Boolean))];
  return l.length ? `${prose.trim()}\n\nLinks: ${l.map((x) => `[[${x}]]`).join(', ')}` : prose.trim();
}

function printAudit(a, dryRun, bootstrapMode) {
  console.log(`\n=== reconcile audit ${dryRun ? '(dry-run)' : ''} ===`);
  console.log(`mode: ${bootstrapMode ? 'bootstrap (append-only, no heavy recompute)' : 'steady'}`);
  console.log(`added: ${a.added.length}  modified: ${a.modified.length}  superseded: ${a.superseded.length}  held: ${a.held.length}`);
  for (const x of a.added) console.log(`  + [${x.type}/${x.claim}] ${x.id} — ${x.title}`);
  for (const x of a.modified) console.log(`  ~ ${x.id} — ${x.title}`);
  for (const x of a.superseded) console.log(`  » ${x.id} — ${x.title}`);
  for (const x of a.held) console.log(`  ⚠ HELD ${x.id} — ${x.reasons.join(', ')}`);
}
function auditMarkdown(a) {
  const sec = (t, xs, f) => `## ${t} (${xs.length})\n${xs.map(f).join('\n') || '_none_'}\n\n`;
  return `# Reconcile audit — ${nowISO()}\n\n`
    + sec('Added', a.added, (x) => `- [${x.type}/${x.claim}] [[${x.id}]] — ${x.title}`)
    + sec('Modified', a.modified, (x) => `- [[${x.id}]] — ${x.title}`)
    + sec('Superseded', a.superseded, (x) => `- [[${x.id}]] — ${x.title}`)
    + sec('Held (instability guard)', a.held, (x) => `- ${x.id} — ${x.reasons.join(', ')}`);
}

// Run ONLY when invoked directly — importing this module must never trigger a real reconcile run.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error('reconcile failed:', e); releaseLock().finally(() => process.exit(1)); });
}
