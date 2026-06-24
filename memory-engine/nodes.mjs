#!/usr/bin/env node
// nodes.mjs — canonical node I/O + frontmatter (DESIGN §6a.1). Shared by retrieval + reconciler.
//
// One markdown file per node in the flat pool knowledge/nodes/<id>.md; filename == id == the
// [[wikilink]] target. YAML frontmatter (the schema) + distilled-prose body (what the engine
// embeds). This module only reads/writes the format — it holds NO judgment (that's the reconciler).

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { MEMORY_ROOT } from './bootstrap.mjs';

export { MEMORY_ROOT };
export const NODES_DIR = resolve(MEMORY_ROOT, 'knowledge', 'nodes');
export const INDEX_FILE = resolve(MEMORY_ROOT, 'knowledge', 'INDEX.md');

// Canonical frontmatter field order (DESIGN §6a.1). Built in this order so serialized nodes
// stay diff-stable across runs. `citation` is present iff claim==fact.
export const FIELD_ORDER = [
  'id', 'title', 'type', 'claim', 'scope', 'audience', 'centrality', 'cluster',
  'tags', 'entities', 'citation', 'superseded', 'schema_version',
  'created', 'updated', 'last_synced',
];

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// parse frontmatter + body. Tolerant: malformed YAML -> empty frontmatter, whole text as body.
export function parseNode(text, id) {
  const m = text.match(FM_RE);
  if (!m) return { id, frontmatter: {}, body: text.trim() };
  let frontmatter = {};
  try { frontmatter = yamlLoad(m[1]) || {}; } catch { frontmatter = {}; }
  return { id: id ?? frontmatter.id, frontmatter, body: (m[2] || '').trim() };
}

// serialize {frontmatter, body} -> markdown, fields in canonical order, undefined keys dropped.
export function serializeNode(node) {
  const fm = {};
  for (const k of FIELD_ORDER) if (node.frontmatter[k] !== undefined && node.frontmatter[k] !== null) fm[k] = node.frontmatter[k];
  for (const k of Object.keys(node.frontmatter)) if (!(k in fm) && node.frontmatter[k] != null) fm[k] = node.frontmatter[k];
  const dumped = yamlDump(fm, { lineWidth: -1, sortKeys: false, noRefs: true }).trimEnd();
  return `---\n${dumped}\n---\n\n${(node.body || '').trim()}\n`;
}

export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'node';
}

// load the whole pool -> [{ id, frontmatter, body, prose }] (prose == body, what retrieval embeds).
export async function loadPool() {
  let files = [];
  try { files = (await readdir(NODES_DIR)).filter(f => f.endsWith('.md')); } catch { return []; }
  const nodes = [];
  for (const f of files) {
    const id = basename(f, '.md');
    const n = parseNode(await readFile(resolve(NODES_DIR, f), 'utf8'), id);
    n.prose = n.body;
    nodes.push(n);
  }
  return nodes;
}

export async function writeNode(node) {
  await mkdir(NODES_DIR, { recursive: true });
  await writeFile(resolve(NODES_DIR, `${node.id}.md`), serializeNode(node), 'utf8');
}

export async function deleteNode(id) {
  try { await unlink(resolve(NODES_DIR, `${id}.md`)); } catch { /* already gone */ }
}

// a unique id from a title, avoiding collisions with `taken` (a Set of existing ids).
export function uniqueId(title, taken) {
  const base = slugify(title);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}
