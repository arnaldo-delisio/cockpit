#!/usr/bin/env node
// capture.mjs — dumb, fail-safe session capture (MEM-16 / MEM-22 / DESIGN §9).
//
// Registered as a Claude Code Stop / PreCompact / SessionEnd hook. Reads the hook JSON
// from stdin, appends NEAR-RAW, judgment-free turns to the scope's staging/, with cheap
// MECHANICAL salience markers for the reconciler. Makes NO model call — all judgment is
// the reconciler's (capture is dumb + comprehensive; raw is the source of truth).
//
// FAIL-SAFE: every error is swallowed (logged to global staging/.capture-errors.log) and
// the process exits 0 — capture must NEVER disrupt the session it observes (silent toward
// the session, but it leaves a paper trail for us). See log 2026-06-23 for the rationale.
//
// Incremental + idempotent: a per-session cursor records how many transcript entries are
// already captured, so Stop firing per-turn only appends what's new.

import {
  readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ensureScope, MEMORY_ROOT } from './bootstrap.mjs';

// ---------- scope from cwd (folder map) + optional manual override ----------
function scopeFromCwd(cwd) {
  if (process.env.COCKPIT_SCOPE) return process.env.COCKPIT_SCOPE.trim();   // manual override
  const home = homedir();
  const projects = resolve(home, 'projects');
  if (cwd === projects || cwd.startsWith(projects + sep)) {
    const top = relative(projects, cwd).split(sep)[0];
    if (top) return top;                       // ~/projects/<x> -> <x>
  }
  const cockpit = resolve(home, '.cockpit');
  if (cwd === cockpit || cwd.startsWith(cockpit + sep)) return 'cockpit';
  return 'global';                             // fallback
}

// ---------- salience (MEM-22): tier-1 sentinels + tier-2 regex over user text ----------
const SENTINEL = /(^|\s)#(good|bad)\b/i;
const RE_KEEP = /\b(remember|note this|important|keep this|don'?t forget)\b/i;
const RE_CORRECTION = /\b(wrong|incorrect|actually|revert|undo|misunderstood|that'?s not|not what i)\b/i;
const RE_LEADING_NO = /^\s*(no\b|nope\b|don'?t\b|stop\b)/i;
const RE_DECISION = /\b(decided|approved|let'?s go with|green ?light|ship it|go ahead|confirmed|locked)\b/i;

function userSalience(text) {
  const f = [];
  const m = text.match(SENTINEL); if (m) f.push('#' + m[2].toLowerCase());
  if (RE_KEEP.test(text)) f.push('keep');
  if (RE_CORRECTION.test(text) || RE_LEADING_NO.test(text)) f.push('correction');
  if (RE_DECISION.test(text)) f.push('decision');
  return f;
}

// ---------- defensive transcript parsing (formats drift — never throw) ----------
function textOf(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text).join('\n').trim();
  }
  return '';
}
function hasToolError(content) {
  return Array.isArray(content)
    && content.some(b => b && b.type === 'tool_result' && b.is_error === true);
}

// ---------- error log (silent toward the session, traceable for us) ----------
function logError(err) {
  try {
    const p = resolve(MEMORY_ROOT, 'scopes', 'global', 'staging', '.capture-errors.log');
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`, 'utf8');
  } catch { /* truly nothing we can do — stay silent */ }
}

async function main() {
  let hook = {};
  try { hook = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/garbled stdin */ }

  const cwd = hook.cwd || process.cwd();
  const sessionId = (hook.session_id || 'unknown-session').replace(/[^a-zA-Z0-9_-]/g, '');
  const event = hook.hook_event_name || 'Unknown';
  const tpath = hook.transcript_path;
  if (!tpath || !existsSync(tpath)) return;            // nothing to capture

  const scope = scopeFromCwd(cwd);
  await ensureScope(scope);                            // lazily materializes dormant scopes (OPEN-7)

  const stagingDir = resolve(MEMORY_ROOT, 'scopes', scope, 'staging');
  const cursorDir = resolve(stagingDir, '.cursors');
  const cursorFile = resolve(cursorDir, `${sessionId}.json`);

  // how many transcript entries have we already captured for this session?
  let cursor = 0;
  try { cursor = JSON.parse(readFileSync(cursorFile, 'utf8')).count || 0; } catch { /* fresh */ }

  const lines = readFileSync(tpath, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const ln of lines) { try { entries.push(JSON.parse(ln)); } catch { /* skip bad line */ } }
  if (entries.length <= cursor) return;                // nothing new

  const fresh = entries.slice(cursor);
  const date = new Date().toISOString().slice(0, 10);
  const outFile = resolve(stagingDir, `${date}__${sessionId}.md`);

  let out = '';
  if (!existsSync(outFile)) {
    out += `---\ntype: staging\nscope: ${scope}\nsession_anchor: ${sessionId}\n`
        +  `transcript: ${tpath}\nstarted: ${new Date().toISOString()}\nschema_version: 1\n---\n\n`
        +  `_Near-raw capture (MEM-16). Raw transcript is the source of truth (\`transcript:\` above);\n`
        +  `huge tool outputs are not duplicated here. Salience tags are mechanical (MEM-22), not judgments._\n\n`;
  }

  let appended = 0;
  for (const e of fresh) {
    const role = (e.message && e.message.role) || e.type || 'unknown';
    const content = e.message ? e.message.content : undefined;
    const ts = e.timestamp || '';
    const text = textOf(content);
    const errored = hasToolError(content);
    if (!text && !errored) continue;                   // mechanical noise filter (tool plumbing)

    const tags = [];
    if (role === 'user') tags.push(...userSalience(text));
    if (errored) tags.push('error');
    const tagStr = tags.length ? `  [${[...new Set(tags)].join(', ')}]` : '';

    out += `#### ${role} · ${ts}${tagStr}\n${text || '(tool error — see transcript)'}\n\n`;
    appended++;
  }

  if (appended > 0 || !existsSync(outFile)) appendFileSync(outFile, out, 'utf8');

  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(cursorFile, JSON.stringify({ count: entries.length, event, updated: new Date().toISOString() }), 'utf8');
}

main().catch(logError).finally(() => process.exit(0));
