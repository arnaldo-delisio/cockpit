#!/usr/bin/env node
// links.mjs — the associations sidecar (DESIGN §6a.5; MEM-31 v1 link-only). Pure helpers + I/O.
//
// Associations between nodes live in a reconciler-owned edge-list knowledge/links.json — NOT in
// node bodies/frontmatter (a link in a node would bump its `updated`, churn prose, and re-fire the
// MEM-29/31 cost guard every night). Undirected: each edge stores its endpoint pair sorted (a<b)
// so the canonical key is trivial and dedup is exact. This module only reads/writes + maintains the
// edge set — it holds NO judgment (that's visionary.mjs / the reconciler, the sole writer MEM-8).
//
//   edge := { a, b, source, note, created }   // a<b (sorted); source ∈ dreaming|ported|manual|distiller
//
// Importing this module must never trigger a run.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { MEMORY_ROOT } from './nodes.mjs';

export const LINKS_FILE = resolve(MEMORY_ROOT, 'knowledge', 'links.json');

const nowISO = () => new Date().toISOString();

// canonical undirected key for a pair (order-independent).
export function edgeKey(a, b) {
  return a < b ? `${a}\t${b}` : `${b}\t${a}`;
}

// load the edge list -> Array<edge>; [] if the sidecar doesn't exist yet or is unreadable.
export async function loadLinks() {
  try {
    const j = JSON.parse(await readFile(LINKS_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

// persist the edge list, sorted by canonical key for a diff-stable commit (it rides knowledge/).
export async function saveLinks(edges) {
  const sorted = [...edges].sort((x, y) => edgeKey(x.a, x.b).localeCompare(edgeKey(y.a, y.b)));
  await mkdir(dirname(LINKS_FILE), { recursive: true });
  await writeFile(LINKS_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

// add an undirected edge if new. Mutates `edges`. Skips self-pairs and exact-key duplicates.
// Returns true iff an edge was appended (so callers can enforce a budget on real additions).
export function addEdge(edges, a, b, { source, note } = {}) {
  if (!a || !b || a === b) return false;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const key = edgeKey(lo, hi);
  if (edges.some((e) => edgeKey(e.a, e.b) === key)) return false;
  edges.push({ a: lo, b: hi, source: source || 'dreaming', note: note || '', created: nowISO() });
  return true;
}

// drop any edge whose endpoint is missing from / superseded in the live pool. Mutates `edges`
// in place (keeps the reference the reconciler/sidecar share); returns the removed edges for audit.
export function prune(edges, liveIds) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
  const removed = [];
  for (let i = edges.length - 1; i >= 0; i--) {
    if (!live.has(edges[i].a) || !live.has(edges[i].b)) removed.push(...edges.splice(i, 1));
  }
  return removed;
}

// degree of a node id in the edge set (how many edges touch it) — used for under-linked anchor bias.
export function degreeOf(edges, id) {
  let d = 0;
  for (const e of edges) if (e.a === id || e.b === id) d++;
  return d;
}

// the live neighbor ids already linked to `id` (so the judge never re-proposes an existing edge).
export function neighborsOf(edges, id) {
  const out = [];
  for (const e of edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}
