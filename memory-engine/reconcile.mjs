#!/usr/bin/env node
// reconcile.mjs — the single-writer reconciler (DESIGN §5; MEM-8/9/11/27). THE HEART.
//
// Reads each live scope's near-raw staging (what capture appended), distills it into canonical
// graph nodes via judge() (the model adapter), then CONSOLIDATES (LLM-semantic dedup, MEM-27)
// against the existing pool, and commits — the ONLY writer of knowledge/nodes/ (MEM-8).
//
// Pipeline (MEM-27, replaces the per-proposal cosine→merge mint path):
//   distill (per work-unit, altitude-filtered MEM-18) → group (size-triggered, per scope)
//     → consolidate (ONE judge('hard') per group → GROUPING DECISIONS only; the reconciler then assembles
//        each node from the distilled backing candidates — fold paraphrases / merge into existing / supersede)
//     → guard (MEM-9 on every update/supersede) → two-phase commit → project (MEM-20).
// Two tempos, same engine: `node reconcile.mjs` (on-write: new staging vs existing) and
// `node reconcile.mjs --reflect` (nightly: consolidate a scope's existing nodes with NO new staging —
// self-heals accumulated drift/dups). The cron/timer that fires --reflect is out-of-repo (bootstrap.sh).
//
// Why consolidation, not cosine (MEM-27): cosine cannot separate same-rule from different-rule for terse
// behavioral nodes (within-synonym 0.33–0.84 overlaps cross-distinct ≤0.54) — no SIM_MERGE cutoff works.
// Embeddings stay for RETRIEVAL + cache warmth (retrieval.mjs); they no longer gate the mint path.
//
// Locked invariants this file must never break:
//   • single-writer        — only this process writes canonical nodes (lockfile-fenced, MEM-9).
//   • two-phase commit      — commit nodes FIRST, THEN advance the consumed marker; a crash between
//                             re-processes the same staging next run, and consolidation absorbs it.
//   • fact needs a citation — a claim distilled from a real captured turn cites it
//                             (stg:<anchor>:<sha8(turn-text)>); otherwise it downgrades to inference.
//   • instability guard     — narrowed (MEM-28, supersedes MEM-9's human-review default): a risky change
//                             (citation-drop / centrality-swing / cluster-flip / supersede) only matters on an
//                             ALWAYS-LOAD node (behavioral type, centrality ≥ projection floor); anything else
//                             just applies (memory is git-versioned — git is the undo). For an always-load
//                             risky change an LLM (judge) adjudicates apply-vs-escalate; only a genuine
//                             contradiction / evidence-loss (or an adjudication failure) escalates to
//                             pending-review. The human is NOT the default reviewer.
//   • conservative keep     — an existing node the consolidator never mentions is kept UNCHANGED
//                             (logged), never silently dropped.
//
// Usage:  node reconcile.mjs [--dry-run] [--reflect] [--scope <name>]
//   --dry-run : full preview (loads model, calls judge, prints the audit diff) with ZERO writes.
//   --reflect : also consolidate scopes that have existing nodes but NO new staging (self-healing).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, open, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { judge } from './judge.mjs';
import { MEMORY_ROOT, INDEX_FILE, loadPool, writeNode, uniqueId } from './nodes.mjs';
import { EmbeddingCache, syncCache } from './retrieval.mjs';
import { project, printProjection } from './projection.mjs';

const execFileP = promisify(execFile);

const LIVE_SCOPES = ['global', 'cockpit', 'content', 'job-search', 'boringscale'];

// --- tunables (grey-area picks; tune after real runs) ---
const BOOTSTRAP_MAX_NODES = 12;      // below this, the audit prints a bootstrap-floor label (display only, §6a.3)
const DIGEST_TURN_CAP = 80;          // bound judge cost: at most this many turns per work-unit digest
const TURN_CHARS = 600;              // per-turn truncation in the digest
const CONSOLIDATE_PROSE_CHARS = 600; // per-item truncation handed to the consolidator
const GROUP_CHAR_BUDGET = 180_000;   // scope prompt-body chars before splitting by cluster label (MEM-27 part C);
                                     // gpt-5.5 ~400K-token window — one consolidate call stays well below this.
const DISTILL_TIMEOUT_MS = 180_000;  // per work-unit distill (hard tier); judge default 120s is too tight at scale.
const CONSOLIDATE_TIMEOUT_MS = 300_000; // the heaviest call: whole-scope input context in one pass. Output is now
                                        // DECISIONS-ONLY (ids/indices/centrality — a few KB), so the old full-prose
                                        // reply overflow is gone; budget stays generous for reasoning over a big scope.
const GUARD_CENTRALITY_DELTA = 0.25;
const GUARD_HIGH_CENTRALITY = 0.50;   // cluster-flip detector threshold inside instabilityReasons()
const ALWAYS_LOAD_FLOOR = 0.60;       // MEM-28: mirrors projection.mjs CENTRALITY_FLOOR — only behavioral nodes
                                      // at/above this reach the always-load layer, the one path the guard protects.
const ADJUDICATE_TIMEOUT_MS = 60_000; // the safety-adjudicator judge() call (rare; only always-load risky changes).

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

// ============================================================ distillation (judge, hard tier) — MEM-18 altitude
const DISTILL_SCHEMA = `Return ONLY a JSON array (possibly empty). Each element is a node:
{
  "title": "<short human title>",
  "type": "knowledge" | "identity" | "feedback",
  "prose": "<2-5 sentences of distilled, self-contained fact/lesson — clean enough to embed; NOT a transcript quote>",
  "tags": ["<free-form>", ...],
  "entities": { "concepts": [...], "people": [...], "products": [...] },
  "centrality": <0.0-1.0 importance>,
  "cluster": "<short topic label>",
  "source_turns": ["T3", ...]
}`;

function distillPrompt(scope, digest) {
  return `You are the memory reconciler's distiller for the "${scope}" scope. Below is a near-raw \
digest of captured conversation turns (each "[Tn]" is a turn; "{...}" are mechanical salience markers: \
#good/#bad = explicit human verdict, keep/correction/decision/error = inferred).

Distill ONLY DURABLE, EVERGREEN memory — knowledge worth keeping long after the current work ships. \
Apply this altitude filter (MEM-18) strictly:

INCLUDE (these belong in the knowledge graph):
- evergreen knowledge: a distilled fact, relationship, or finding that stays true beyond this session.
- standing behavioral rules: how to work — a correction / #bad / decision / #good that should change FUTURE behavior.
- identity: durable truth about who is served / voice / mission / a standing preference.

EXCLUDE (these are LOG CHRONOLOGY, not graph nodes — do NOT emit them at all):
- build/session mechanics: phase status, "we are on step/phase X", what was just committed/built, next steps.
- handoff / process notes: "do X in a fresh chat", "internalize Y", "resume from Z", TODO/bookkeeping.
- transient state: what is currently in-flight, one-off tool noise, status reports, chatter.
If a turn only reports progress, status, or hands off work, it is NOT durable — skip it.

Per surviving node:
- type "feedback" = a behavioral lesson; "identity" = durable who/voice/mission/preference; "knowledge" = a fact/relationship.
- "source_turns" = the [Tn] ids that back the node (provenance). Omit if it is pure synthesis.
- "centrality" = how load-bearing this is (0=trivial, 1=foundational). "cluster" = a short topic label.
- Prefer FEW high-quality nodes over many shallow ones. Empty array if nothing survives the altitude filter.

${DISTILL_SCHEMA}

DIGEST:
${digest}`;
}

// ============================================================ consolidation (judge, hard tier) — MEM-27 + compact-decisions amendment
// Output is DECISIONS-ONLY (the grouping: ids / backing indices / centrality) — NO prose/title/tags/type.
// The reconciler assembles each final node from the already-distilled backing candidates (their prose is reliable
// and small-per-call) or the existing node. Splitting decide-grouping from write-prose bounds the reply to a few
// KB so a big-scope consolidate no longer overflows the model's single-reply ceiling.
const CONSOLIDATE_SCHEMA = `Return ONLY a JSON array — the GROUPING DECISIONS for this group's canonical node set.
Return DECISIONS ONLY — ids, backing indices, centrality. Do NOT write node prose/title/tags/type: they already
exist (the distiller wrote each candidate's prose; existing nodes keep theirs). The reconciler assembles each final
node from the candidates you point at. Echo EVERY existing node exactly once (action "keep" if unchanged) and add
one element per genuinely-new node. Per element:
{
  "action": "keep" | "update" | "new" | "supersede",
  "id": "<existing node id — REQUIRED for keep/update/supersede; OMIT for new>",
  "backing": [<NEW-candidate index this node folds in>, ...],   // REQUIRED for "new"; the candidates that back it
  "supersedes": ["<existing id this node absorbs/replaces>", ...],
  "centrality": <0.0-1.0 — your cross-evidence importance judgment, not a max of inputs>,
  "cluster": "<short topic label, optional>"
}`;

function consolidatePrompt(scope, proposals, existing) {
  const prop = proposals.map((p) =>
    `[#${p.idx}] (${p.type}, centrality ${p.centrality}) ${p.title}\n  ${truncate((p.prose || '').replace(/\s+/g, ' '), CONSOLIDATE_PROSE_CHARS)}`
  ).join('\n\n') || '(none — reflection pass: consolidate the existing nodes against EACH OTHER for drift/dups)';
  const exist = existing.map((n) =>
    `[${n.id}] (${n.frontmatter.type}, centrality ${n.frontmatter.centrality ?? '?'}) ${n.frontmatter.title}\n  ${truncate((n.prose || '').replace(/\s+/g, ' '), CONSOLIDATE_PROSE_CHARS)}`
  ).join('\n\n') || '(none — empty scope)';
  return `You are the memory reconciler's CONSOLIDATOR for the "${scope}" scope. You receive the scope's \
EXISTING canonical knowledge nodes and a set of NEW candidate nodes freshly distilled from conversation. \
Decide how they consolidate — which candidates fold together, which restate an existing node, which are genuinely \
new — so each distinct lesson/fact is represented ONCE. Output GROUPING DECISIONS only: the reconciler assembles \
the prose from the candidates you cite; you never write prose.

Rules:
- FOLD PARAPHRASES: if several NEW candidates state the same rule/fact, emit ONE node for it (list ALL their
  indices in "backing"). Short behavioral rules are often the same rule reworded — collapse them aggressively.
- MERGE INTO EXISTING: if a NEW candidate restates an EXISTING node, "update" that existing node (keep its "id"),
  folding in any added nuance; put the backing candidate indices in "backing".
- ABSORB DUPLICATE EXISTING NODES: if two EXISTING nodes say the same thing, "update" one and list the other
  id in its "supersedes".
- KEEP DISTINCT: genuinely different nodes stay separate. An existing node that nothing touches → "keep" (echo
  its id; omit prose). Do NOT drop an existing node by omission — echo it.
- CONTRADICTIONS: if a NEW candidate corrects/replaces an EXISTING node, emit the new/updated node AND name the
  outdated id in its "supersedes" (or a standalone {action:"supersede", id}).
- "centrality" = how load-bearing the node is across ALL its evidence (your judgment, not a max of inputs).
- Prefer FEW high-quality nodes. Be conservative on identity/feedback wording — preserve meaning when merging.

${CONSOLIDATE_SCHEMA}

EXISTING CANONICAL NODES:
${exist}

NEW CANDIDATES (reference by "#n" in "backing"):
${prop}`;
}

// ============================================================ grouping (size-triggered, MEM-27 part C)
// One group = the whole scope until it overflows one judge call; then split by the distiller's cluster label.
// A single label that still overflows is the SUB-CLUSTER SEAM — DEFERRED (needs real edge-data; building it
// now would contradict MEM-24). We process the oversized label whole and log a warning (never silent).
function groupForConsolidation(proposals, existing) {
  const sizeOf = (ps, ns) =>
    ps.reduce((s, p) => s + (p.prose || '').length + 120, 0) + ns.reduce((s, n) => s + (n.prose || '').length + 120, 0);
  if (sizeOf(proposals, existing) <= GROUP_CHAR_BUDGET) return [{ proposals, existing }];
  const groups = new Map();
  const bucket = (c) => { if (!groups.has(c)) groups.set(c, { proposals: [], existing: [] }); return groups.get(c); };
  for (const p of proposals) bucket(p.cluster || 'unclustered').proposals.push(p);
  for (const n of existing) bucket(n.frontmatter.cluster || 'unclustered').existing.push(n);
  for (const g of groups.values())
    if (sizeOf(g.proposals, g.existing) > GROUP_CHAR_BUDGET)
      console.error('reconcile: a single cluster exceeds the judge budget — sub-cluster seam deferred (MEM-24); processing whole.');
  return [...groups.values()];
}

// ============================================================ provenance derivation (MEM-27 part 3)
// citation ← first resolvable backing source-turn (stg:<anchor>:<sha8(turn-text)>); preserves fact-vs-inference.
function deriveCitation(backing) {
  for (const p of backing) for (const ref of (p.source_turns || [])) {
    const i = String(ref).replace(/[^\d]/g, '');
    const txt = p._wu.turnIndex[i];
    if (txt) return `stg:${p._wu.anchor}:${sha8(txt)}`;
  }
  return null;
}
// audience ← operator if ANY backing proposal came from a Hermes work-unit, else builder (operator∪builder=operator).
function deriveAudience(backing) { return backing.some((p) => p._wu.brain === 'hermes') ? 'operator' : 'builder'; }

// ============================================================ instability guard, narrowed (MEM-28; supersedes MEM-9 human-review)
// The guard protects ONLY the always-load path — a behavioral node (identity/feedback) at/above the projection
// floor, i.e. one that can reach the always-loaded CLAUDE.md/SOUL layer where a bad rule bites every session.
// Everything else applies unguarded (memory is git-versioned; git is the undo). For an always-load risky change,
// an LLM adjudicates apply-vs-escalate, defaulting to APPLY (reversible) and escalating only a genuine
// contradiction / evidence-loss; an adjudication infra failure fails SAFE (escalates). The human reviews only
// what lands in pending-review — which, by design, is now near-empty.
export const isAlwaysLoadEligible = (node, afterCentrality = 0) =>
  ['identity', 'feedback'].includes(node.frontmatter?.type)
  && Math.max(node.frontmatter?.centrality || 0, afterCentrality || 0) >= ALWAYS_LOAD_FLOOR;

const ADJUDICATE_SCHEMA = `Reply ONLY a JSON object: { "verdict": "apply" | "escalate", "reason": "<one short line; REQUIRED iff escalate>" }`;
export async function adjudicate(kind, ctx, reasons) {
  const prompt = `You are the memory reconciler's SAFETY ADJUDICATOR for an ALWAYS-LOADED behavioral rule — it \
loads into the model in EVERY session, so a bad change is high-impact. A consolidation ${kind} to this rule \
tripped the instability guard (${reasons.join(', ')}). Memory is git-versioned, so any change is reversible — \
so DEFAULT TO "apply". Escalate to a human ONLY if applying would clearly: (a) contradict or corrupt the rule's \
meaning, (b) drop real supporting evidence with no replacement, or (c) remove a still-valid load-bearing rule. \
Cosmetic re-clustering, a modest centrality nudge, or any change that leaves the rule's TEXT intact is NOT a \
reason to escalate — apply it.

RULE [[${ctx.id}]] (centrality ${ctx.centrality ?? '?'}):
${ctx.prose}

THE PROPOSED ${kind.toUpperCase()}: ${ctx.summary}

${ADJUDICATE_SCHEMA}`;
  const got = await judge(prompt, { tier: 'hard', json: true, timeoutMs: ADJUDICATE_TIMEOUT_MS });
  const escalate = !!(got && got.verdict === 'escalate');
  return { escalate, reason: escalate ? (got.reason || 'adjudicator gave no reason') : null };
}

// Decide an always-load-eligible risky change. Returns 'apply' | 'held'. Side effects: escalate → audit.held;
// any auto-applied risky change → audit.autoApplied (honest trail of what bypassed human review).
export async function guardDecision(reasons, eligible, kind, ctx, audit) {
  if (!reasons.length) return 'apply';                                   // not risky at all
  if (!eligible) { audit.autoApplied.push({ id: ctx.id, kind, reasons, via: 'not-always-load' }); return 'apply'; }
  let verdict;
  try { verdict = await adjudicate(kind, ctx, reasons); }
  catch (e) { verdict = { escalate: true, reason: `adjudication failed (${e.message})` }; }  // fail safe → escalate
  if (verdict.escalate) {
    audit.held.push({ id: `${ctx.id}--${kind}`, reasons, reason: verdict.reason, payload: ctx.escalatePayload(verdict.reason) });
    return 'held';
  }
  audit.autoApplied.push({ id: ctx.id, kind, reasons, via: 'llm-approved' });
  return 'apply';
}

// ============================================================ apply a consolidation result (MEM-27 part 2/3 + compact amendment)
// The model returns DECISIONS ONLY; this assembles each final node from its backing candidates (new) or the
// existing node (update) — prose is the distiller's, never the consolidator's. Mutates `pool` (+ byId) + `audit`
// + `takenIds`. Conservative: an existing node the model never names is kept UNCHANGED (logged in
// audit.unmentioned). Every risky update/supersede passes the narrowed guard (MEM-28: always-load → LLM-adjudicated).
async function applyConsolidation(result, proposals, existing, scope, pool, takenIds, audit) {
  if (!Array.isArray(result)) { console.error(`reconcile: non-array consolidate for scope ${scope}; skipping group.`); return; }
  const byId = new Map(pool.map((n) => [n.id, n]));
  const propByIdx = new Map(proposals.map((p) => [p.idx, p]));
  const backingOf = (r) => arr(r.backing).map((i) => propByIdx.get(Number(i))).filter(Boolean);
  const mentioned = new Set();        // existing ids the model named (keep/update/supersede/absorbed)
  const standaloneSupersede = [];     // explicit supersede actions (not an absorb) — guarded at the end

  for (const r of result) {
    if (!r || typeof r !== 'object') continue;
    const action = ['keep', 'update', 'new', 'supersede'].includes(r.action) ? r.action : (r.id ? 'update' : 'new');

    if (action === 'keep') {
      if (r.id) mentioned.add(r.id);
      for (const sid of arr(r.supersedes)) { mentioned.add(sid); standaloneSupersede.push(sid); }  // keep+absorb = mark dup
      continue;
    }
    if (action === 'supersede') {
      if (r.id) { mentioned.add(r.id); standaloneSupersede.push(r.id); }
      continue;
    }

    const backing = backingOf(r);
    const citation = deriveCitation(backing);
    const audFromBacking = deriveAudience(backing);

    if (action === 'update' && r.id && byId.has(r.id)) {
      mentioned.add(r.id);
      for (const sid of arr(r.supersedes)) mentioned.add(sid);    // absorbed ids: handled inside stageUpdate (only if it applies)
      // decisions-only: existing prose stays; centrality/cluster are the model's, tags/entities fold in from backing.
      const spec = { centrality: r.centrality, cluster: r.cluster, tags: unionTags(backing), entities: unionEntities(backing) };
      await stageUpdate(byId.get(r.id), spec, citation, audFromBacking, arr(r.supersedes), byId, audit);
      continue;
    }
    // new (or update naming an unknown id → mint fresh). Assemble from the backing candidates the distiller wrote:
    // the primary (highest-centrality, tie→lowest idx) sources title/type/prose; tags/entities union all backing.
    // No backing → no prose source → skip (the model named nothing concrete to build from).
    if (!backing.length) continue;
    for (const sid of arr(r.supersedes)) { mentioned.add(sid); standaloneSupersede.push(sid); }
    const primary = primaryOf(backing);
    const spec = {
      title: primary.title, type: primary.type, prose: primary.prose,
      centrality: r.centrality, cluster: r.cluster || primary.cluster,
      tags: unionTags(backing), entities: unionEntities(backing),
    };
    stageNew(spec, scope, audFromBacking, citation, takenIds, pool, byId, audit);
  }

  // conservative default-keep: existing scope nodes the model never mentioned stay UNCHANGED (logged, not dropped).
  for (const n of existing) if (!mentioned.has(n.id) && !n.frontmatter.superseded) audit.unmentioned.push({ scope, id: n.id });

  // explicit/standalone supersedes, through the narrowed guard (MEM-28: always-load → LLM-adjudicated).
  for (const id of [...new Set(standaloneSupersede)]) await stageSupersede(byId.get(id), audit);
}

// ---- staging helpers (mutate `pool`/node objects + `audit` in place; the writer commits the pool) ----
// assemble + stage a brand-new node. `spec` is reconciler-assembled from the backing candidates (decisions-only
// output, MEM-27 compact amendment): title/type/prose from the primary candidate, tags/entities unioned across all.
function stageNew(spec, scope, audience, citation, takenIds, pool, byId, audit) {
  const claim = citation ? 'fact' : 'inference';
  const id = uniqueId(spec.title, takenIds);
  const node = {
    id,
    frontmatter: {
      id, title: spec.title, type: ['knowledge', 'identity', 'feedback'].includes(spec.type) ? spec.type : 'knowledge',
      claim, scope, audience,
      centrality: clamp01(spec.centrality), cluster: spec.cluster || 'unclustered',
      tags: arr(spec.tags), entities: ent(spec.entities),
      ...(citation ? { citation } : {}),
      schema_version: 1, created: nowISO(), updated: nowISO(), last_synced: nowISO(),
    },
    body: bodyWithLinks(spec.prose, spec.links),
    prose: spec.prose,
  };
  pool.push(node);
  byId.set(id, node);
  audit.added.push({ id, title: node.frontmatter.title, claim, type: node.frontmatter.type });
}

// rewrite an existing node's METADATA from a consolidation "update" — its PROSE stays unchanged (decisions-only;
// the distiller owns prose). centrality = LLM cross-evidence judgment (MEM-27); tags/entities fold in `spec`'s
// backing union. Citation is PRESERVED (derived → existing → absorbed), never silently dropped. A risky change
// passes the narrowed guard (MEM-28): unguarded unless this is an always-load rule, then LLM-adjudicated; only an
// escalation HOLDS the whole update (and its absorbs) — the dup stays live for the next pass.
async function stageUpdate(existing, spec, citation, audFromBacking, supersedeIds, byId, audit) {
  const absorbed = supersedeIds.map((id) => byId.get(id)).filter((n) => n && n.id !== existing.id);
  const before = { centrality: existing.frontmatter.centrality || 0, cluster: existing.frontmatter.cluster, hadCitation: !!existing.frontmatter.citation };
  const newCentrality = clamp01(spec.centrality != null ? spec.centrality : existing.frontmatter.centrality);
  const newCluster = spec.cluster || existing.frontmatter.cluster || 'unclustered';
  const newCitation = citation || existing.frontmatter.citation || absorbed.map((a) => a.frontmatter.citation).find(Boolean) || null;
  const newClaim = newCitation ? 'fact' : 'inference';
  const reasons = instabilityReasons(before, { centrality: newCentrality, cluster: newCluster, hasCitation: !!newCitation, claim: newClaim });
  const eligible = isAlwaysLoadEligible(existing, newCentrality);
  const summary = `centrality ${before.centrality}→${newCentrality}, cluster "${before.cluster}"→"${newCluster}", `
    + `citation ${before.hadCitation ? (newCitation ? 'kept' : 'DROPPED') : (newCitation ? 'added' : 'none')}`
    + `${absorbed.length ? `, absorbs ${absorbed.map((a) => a.id).join(', ')}` : ''} (prose UNCHANGED)`;
  const escalatePayload = (reason) => `# ESCALATED update to [[${existing.id}]]\nreasons: ${reasons.join(', ')}\n`
    + `adjudicator: ${reason}\nwould absorb: ${supersedeIds.join(', ') || '(none)'}\n\n## existing (prose unchanged; metadata update held)\n${existing.prose}\n`;
  if (await guardDecision(reasons, eligible, 'update', { id: existing.id, centrality: existing.frontmatter.centrality, prose: existing.prose, summary, escalatePayload }, audit) === 'held') return;
  const audienceUnion = [existing.frontmatter.audience, audFromBacking, ...absorbed.map((a) => a.frontmatter.audience)].includes('operator') ? 'operator' : 'builder';
  existing.frontmatter.centrality = newCentrality;
  existing.frontmatter.cluster = newCluster;
  existing.frontmatter.audience = audienceUnion;
  existing.frontmatter.tags = [...new Set([...(existing.frontmatter.tags || []), ...arr(spec.tags)])];
  existing.frontmatter.entities = mergeEntities(existing.frontmatter.entities, spec.entities);
  if (newCitation) { existing.frontmatter.citation = newCitation; existing.frontmatter.claim = 'fact'; }
  else existing.frontmatter.claim = 'inference';
  existing.frontmatter.updated = nowISO();
  existing.frontmatter.last_synced = nowISO();
  audit.modified.push({ id: existing.id, title: existing.frontmatter.title });
  for (const a of absorbed) await stageSupersede(a, audit);   // mark the absorbed dups not-current (guarded)
}

async function stageSupersede(node, audit) {
  if (!node || node.frontmatter.superseded) return;
  // MEM-28: removing a node only needs review when it is an always-load rule (its disappearance changes every
  // session). Anything else — a routine dedup absorb, a low-centrality / knowledge node — just applies (git is
  // the undo). An always-load supersede is LLM-adjudicated; only an escalation holds it for the human.
  if (isAlwaysLoadEligible(node)) {
    const escalatePayload = (reason) => `# ESCALATED supersede of [[${node.id}]] (centrality ${node.frontmatter.centrality})\n`
      + `adjudicator: ${reason}\nConsolidation marked this always-load rule not-current.\n\n## prose\n${node.prose}\n`;
    const ctx = { id: node.id, centrality: node.frontmatter.centrality, prose: node.prose,
      summary: 'mark this rule not-current — removes it from the graph AND the always-load layer', escalatePayload };
    if (await guardDecision(['always-load-supersede'], true, 'supersede', ctx, audit) === 'held') return;
  }
  node.frontmatter.superseded = true;
  node.frontmatter.updated = nowISO();
  audit.superseded.push({ id: node.id, title: node.frontmatter.title });
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
  const reflect = args.includes('--reflect');
  const scopeArg = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : null;
  const scopes = scopeArg ? [scopeArg] : LIVE_SCOPES;

  if (!(await acquireLock())) process.exit(1);
  try {
    const state = await loadState();
    state.consumed ||= {};

    // ---- read all unconsumed staging, grouped by scope ----
    const workByScope = {};   // scope -> [ { scope, file, anchor, transcript, brain, turnIndex, digest, totalTurns } ]
    for (const scope of scopes) {
      for (const file of await stagingFiles(scope)) {
        const parsed = parseStaging(await readFile(file, 'utf8'));
        const consumed = state.consumed[file] || 0;
        if (parsed.turns.length <= consumed) continue;          // nothing new in this file
        const newTurns = parsed.turns.slice(consumed);
        const { digest, turnIndex } = buildDigest(newTurns);
        if (!digest.trim()) { state.consumed[file] = parsed.turns.length; continue; } // only noise -> mark consumed
        (workByScope[scope] ||= []).push({ scope, file, anchor: parsed.anchor, transcript: parsed.transcript,
          brain: parsed.brain, turnIndex, digest, totalTurns: parsed.turns.length });
      }
    }

    const pool = await loadPool();
    // scopes to process: those with new staging; --reflect adds every live scope that already has nodes.
    const scopeSet = new Set(Object.keys(workByScope));
    if (reflect) for (const s of scopes) if (pool.some((n) => n.frontmatter.scope === s)) scopeSet.add(s);

    if (!scopeSet.size) {
      console.log(`reconcile: no new staging to process${reflect ? ' and no existing nodes to reflect on' : ''}.`);
      // still project the existing pool into CLAUDE.md (MEM-20) — damping makes it a no-op if unchanged.
      printProjection(await project(pool, { dryRun }), dryRun);
      return;
    }

    const cache = await new EmbeddingCache(CACHE_FILE).load();   // retrieval cache (kept warm post-commit)
    const takenIds = new Set(pool.map((n) => n.id));
    const bootstrapMode = pool.length < BOOTSTRAP_MAX_NODES;
    const audit = { added: [], modified: [], superseded: [], held: [], autoApplied: [], unmentioned: [], scopes: {} };

    // ---- per scope: distill all work-units -> consolidate against existing -> apply ----
    for (const scope of [...scopeSet].sort()) {
      const work = workByScope[scope] || [];

      // distill each work-unit (hard tier, MEM-18 altitude); attach the work-unit for provenance.
      const proposals = [];
      for (const w of work) {
        let distilled;
        try { distilled = await judge(distillPrompt(scope, w.digest), { tier: 'hard', json: true, timeoutMs: DISTILL_TIMEOUT_MS }); }
        catch (e) { console.error(`reconcile: distill failed for ${basename(w.file)} (${e.message}); skipping.`); continue; }
        if (!Array.isArray(distilled)) { console.error(`reconcile: non-array distill for ${basename(w.file)}; skipping.`); continue; }
        for (const p of distilled) {
          if (!p || !p.prose || !p.title) continue;
          proposals.push({ ...p, idx: proposals.length, _wu: w });
        }
      }
      const existingInScope = pool.filter((n) => n.frontmatter.scope === scope && !n.frontmatter.superseded);
      audit.scopes[scope] = { distilled: proposals.length, existing: existingInScope.length };

      if (!proposals.length && !reflect) continue;                  // normal run, nothing new survived distill
      if (!proposals.length && existingInScope.length < 2) continue; // reflect: <2 existing -> no dup to fold

      // consolidate (size-triggered grouping; one group = whole scope at our scale)
      for (const g of groupForConsolidation(proposals, existingInScope)) {
        if (!g.proposals.length && g.existing.length < 2) continue;
        let result;
        try { result = await judge(consolidatePrompt(scope, g.proposals, g.existing), { tier: 'hard', json: true, timeoutMs: CONSOLIDATE_TIMEOUT_MS }); }
        catch (e) { console.error(`reconcile: consolidate failed for scope ${scope} (${e.message}); skipping group.`); continue; }
        await applyConsolidation(result, g.proposals, g.existing, scope, pool, takenIds, audit);
      }
    }

    // ---- audit summary ----
    printAudit(audit, dryRun, bootstrapMode);

    if (dryRun) {
      printProjection(await project(pool, { dryRun: true }), true);   // preview the CLAUDE.md projection too
      console.log('\n(--dry-run: no writes, no commits, staging not advanced.)');
      return;
    }

    // ---- PHASE 1: write touched nodes + INDEX, refresh retrieval cache, commit ----
    const touched = [...new Set([...audit.added, ...audit.modified, ...audit.superseded].map((x) => x.id))];
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
    for (const scope of Object.keys(workByScope)) for (const w of workByScope[scope]) state.consumed[w.file] = w.totalTurns;
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
function mergeEntities(a, b) {
  const u = (x, y) => [...new Set([...arr(x), ...arr(y)])];
  return { concepts: u(a?.concepts, b?.concepts), people: u(a?.people, b?.people), products: u(a?.products, b?.products) };
}
// node-assembly helpers (MEM-27 compact amendment): fold a node's metadata from its backing distill candidates.
const unionTags = (props) => [...new Set(props.flatMap((p) => arr(p.tags)))];
const unionEntities = (props) => props.reduce((acc, p) => mergeEntities(acc, p.entities), {});
// primary backing candidate = highest centrality, tie → lowest idx; sources the new node's title/type/prose.
const primaryOf = (props) => [...props].sort((a, b) => (clamp01(b.centrality) - clamp01(a.centrality)) || (a.idx - b.idx))[0];
function bodyWithLinks(prose, links) {
  // strip any [[ ]] the model already added, dedup, then wrap once.
  const l = [...new Set(arr(links).map((x) => String(x).replace(/[[\]]/g, '').trim()).filter(Boolean))];
  return l.length ? `${prose.trim()}\n\nLinks: ${l.map((x) => `[[${x}]]`).join(', ')}` : prose.trim();
}

function printAudit(a, dryRun, bootstrapMode) {
  console.log(`\n=== reconcile audit ${dryRun ? '(dry-run)' : ''} ===`);
  console.log(`mode: ${bootstrapMode ? 'bootstrap (append-only floor)' : 'steady'}`);
  for (const [s, c] of Object.entries(a.scopes)) console.log(`scope ${s}: ${c.distilled} distilled candidate(s) vs ${c.existing} existing node(s)`);
  console.log(`added: ${a.added.length}  modified: ${a.modified.length}  superseded: ${a.superseded.length}  auto-applied(risky): ${a.autoApplied.length}  escalated: ${a.held.length}  kept-untouched: ${a.unmentioned.length}`);
  for (const x of a.added) console.log(`  + [${x.type}/${x.claim}] ${x.id} — ${x.title}`);
  for (const x of a.modified) console.log(`  ~ ${x.id} — ${x.title}`);
  for (const x of a.superseded) console.log(`  » ${x.id} — ${x.title}`);
  for (const x of a.autoApplied) console.log(`  ✓ auto-applied ${x.kind} ${x.id} — ${x.reasons.join(', ')} [${x.via}]`);
  for (const x of a.held) console.log(`  ⚠ ESCALATED ${x.id} — ${x.reasons.join(', ')}${x.reason ? ` (${x.reason})` : ''}`);
}
function auditMarkdown(a) {
  const sec = (t, xs, f) => `## ${t} (${xs.length})\n${xs.map(f).join('\n') || '_none_'}\n\n`;
  return `# Reconcile audit — ${nowISO()}\n\n`
    + sec('Added', a.added, (x) => `- [${x.type}/${x.claim}] [[${x.id}]] — ${x.title}`)
    + sec('Modified', a.modified, (x) => `- [[${x.id}]] — ${x.title}`)
    + sec('Superseded', a.superseded, (x) => `- [[${x.id}]] — ${x.title}`)
    + sec('Auto-applied risky changes (MEM-28: not-always-load or LLM-approved)', a.autoApplied, (x) => `- ${x.kind} [[${x.id}]] — ${x.reasons.join(', ')} [${x.via}]`)
    + sec('Escalated to pending-review (always-load contradiction / evidence-loss)', a.held, (x) => `- ${x.id} — ${x.reasons.join(', ')}${x.reason ? ` — ${x.reason}` : ''}`)
    + sec('Kept untouched (not mentioned by consolidator)', a.unmentioned, (x) => `- [[${x.id}]] (${x.scope})`);
}

// Run ONLY when invoked directly — importing this module must never trigger a real reconcile run.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error('reconcile failed:', e); releaseLock().finally(() => process.exit(1)); });
}
