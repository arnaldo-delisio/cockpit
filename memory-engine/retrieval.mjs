#!/usr/bin/env node
// retrieval.mjs — the MEM-24 in-process retrieval engine (DESIGN §7).
//
// A minimal, swappable stack the reconciler `require`s in-process — no daemon, no vector DB:
//   embeddings : @huggingface/transformers running all-MiniLM-L6-v2 (ONNX, local/zero-network
//                after the first ~23 MB model fetch into ~/.cache/huggingface)
//   cache      : id -> { hash, vec } JSON sidecar; re-embed ONLY on content-hash change
//   semantic   : brute-force cosine (vectors are mean-pooled + normalized -> cosine == dot)
//   keyword    : ripgrep over the node pool (L1-L2)
//   fusion     : reciprocal rank fusion, k=60 (MEM-19)
//
// The owned markdown is the store of record; this cache is disposable (losing it = lose
// convenience, not knowledge — re-embed rebuilds it). Brute-force stays interactive to
// ~50k-100k nodes (MEM-24), far above our ceiling; an ANN index is a later drop-in swap.

import { pipeline } from '@huggingface/transformers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;
const RRF_K = 60;
const EMBED_BATCH = 8;   // MEM-24: batch of 8 avoids the single-padded-batch RAM spike

export function contentHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

// ---------- embeddings (lazy singleton; model loads/downloads once) ----------
let _extractor = null;
async function extractor() {
  if (!_extractor) _extractor = await pipeline('feature-extraction', MODEL);
  return _extractor;
}

// embed(texts) -> Array<Float32Array(384)>, mean-pooled + L2-normalized (so cosine == dot).
export async function embed(texts) {
  if (!texts.length) return [];
  const ex = await extractor();
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const t = await ex(batch, { pooling: 'mean', normalize: true });
    for (let b = 0; b < batch.length; b++) {
      out.push(Float32Array.from(t.data.slice(b * DIM, (b + 1) * DIM)));
    }
  }
  return out;
}

// ---------- cache: id -> { hash, vec[] } ; disposable JSON sidecar ----------
export class EmbeddingCache {
  constructor(path) { this.path = path; this.map = new Map(); }
  async load() {
    try {
      const j = JSON.parse(await readFile(this.path, 'utf8'));
      for (const [id, v] of Object.entries(j)) this.map.set(id, v);
    } catch { /* fresh cache */ }
    return this;
  }
  async save() {
    const obj = {};
    for (const [id, v] of this.map) obj[id] = v;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(obj), 'utf8');
  }
  get(id, hash) {
    const e = this.map.get(id);
    return e && e.hash === hash ? Float32Array.from(e.vec) : null;
  }
  set(id, hash, vec) { this.map.set(id, { hash, vec: Array.from(vec) }); }
  delete(id) { this.map.delete(id); }
  prune(liveIds) { const live = new Set(liveIds); for (const id of this.map.keys()) if (!live.has(id)) this.map.delete(id); }
}

// Ensure every node's current prose is embedded in the cache (re-embed only changed/missing).
// nodes: Array<{ id, prose }>. Mutates + returns the cache. Caller persists via cache.save().
export async function syncCache(nodes, cache) {
  const stale = nodes.filter(n => !cache.get(n.id, contentHash(n.prose)));
  if (stale.length) {
    const vecs = await embed(stale.map(n => n.prose));
    stale.forEach((n, i) => cache.set(n.id, contentHash(n.prose), vecs[i]));
  }
  cache.prune(nodes.map(n => n.id));
  return cache;
}

// ---------- brute-force cosine ----------
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// queryVec vs entries:[{id,vec}] -> [{id,score}] desc, top-k.
export function cosineTopK(queryVec, entries, k) {
  return entries
    .map(e => ({ id: e.id, score: dot(queryVec, e.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- keyword (ripgrep over the node pool) ----------
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Returns node ids (filename minus .md) ranked by match count, best first.
export async function ripgrepSearch(query, dir, limit = 20) {
  const terms = (query.match(/[\p{L}\p{N}]{3,}/gu) || []).map(escapeRe);
  if (!terms.length) return [];
  const pattern = terms.join('|');
  try {
    const { stdout } = await execFileP('rg', ['-c', '-i', '--no-messages', '-e', pattern, '--glob', '*.md', dir]);
    return stdout.trim().split('\n').filter(Boolean)
      .map(line => { const i = line.lastIndexOf(':'); return { id: basename(line.slice(0, i), '.md'), n: +line.slice(i + 1) }; })
      .sort((a, b) => b.n - a.n).slice(0, limit).map(r => r.id);
  } catch { return []; }   // rg exits 1 on zero matches
}

// ---------- RRF fusion (MEM-19, k=60) ----------
export function rrfFuse(lists, k = RRF_K) {
  const score = new Map();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) || 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// ---------- top-level hybrid search ----------
// nodes:[{id,prose}], cache synced by caller. Returns ranked node ids (semantic x keyword, RRF).
export async function search(query, nodes, cache, dir, k = 10) {
  const [qv] = await embed([query]);
  const entries = nodes
    .map(n => ({ id: n.id, vec: cache.get(n.id, contentHash(n.prose)) }))
    .filter(e => e.vec);
  const sem = cosineTopK(qv, entries, k * 2).map(r => r.id);
  const kw = await ripgrepSearch(query, dir, k * 2);
  return rrfFuse([sem, kw]).slice(0, k);
}

// semantic-only SCORED retrieval — for callers that need a relevance FLOOR (an absolute cosine
// cutoff), which the RRF rank-fusion in search() discards. Returns [{id, score}] desc, top-k.
// Cache-only, exactly like search(): a node whose cached vec is missing/stale is skipped (the
// reconciler keeps the cache warm; §7 freshness). Pure reader — never mutates/saves the cache.
export async function searchScored(query, nodes, cache, k = 10) {
  const [qv] = await embed([query]);
  const entries = nodes
    .map(n => ({ id: n.id, vec: cache.get(n.id, contentHash(n.prose)) }))
    .filter(e => e.vec);
  return cosineTopK(qv, entries, k);
}

// Direct-run smoke test:  node retrieval.mjs            (self-contained, no corpus needed)
//                         node retrieval.mjs "<query>"  (search the live node pool)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const arg = process.argv[2];
  if (!arg) {
    const docs = [
      'The reconciler is the single writer of canonical memory nodes.',
      'Cats are small domesticated carnivorous mammals.',
      'Brute-force cosine similarity stays fast below fifty thousand vectors.',
    ];
    const t0 = Date.now();
    const vecs = await embed(docs);
    const [q] = await embed(['who writes the memory graph?']);
    const ranked = cosineTopK(q, vecs.map((vec, i) => ({ id: String(i), vec })), 3);
    console.log(`embedded ${docs.length} docs + query in ${Date.now() - t0} ms; dim=${vecs[0].length}`);
    console.log('cosine ranking (expect doc 0 first):', ranked.map(r => `${r.id}:${r.score.toFixed(3)}`).join('  '));
  } else {
    const { loadPool, NODES_DIR } = await import('./nodes.mjs');
    const { resolve: r } = await import('node:path');
    const nodes = await loadPool();
    const cache = await new EmbeddingCache(r(NODES_DIR, '..', '..', '.cache', 'embeddings.json')).load();
    await syncCache(nodes, cache);
    const ids = await search(arg, nodes, cache, NODES_DIR);
    console.log(ids.length ? ids.join('\n') : '(no matches — pool may be empty)');
  }
}
