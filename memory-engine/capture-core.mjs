#!/usr/bin/env node
// capture-core.mjs — shared, brain-neutral capture pipeline (DESIGN §9, B1 / TOOL-6).
//
// The brain-agnostic core of session capture. Each brain has a thin reader that turns its
// own session record into a normalized entries[] and calls capture(); everything after that
// — scope gating, salience, cursor idempotency, staging frontmatter (incl. the brain stamp),
// append, and the fail-safe error log — lives here, identical for both brains:
//   capture.mjs         (Claude)  Stop/PreCompact/SessionEnd hook -> transcript JSONL
//   hermes-capture.mjs  (Hermes)  on_session_end hook -> state.db messages by session_id
//
// Input contract — capture({ entries, cwd, sessionId, event, provenance, brain }):
//   entries    normalized [{ role, text, errored, ts }] — the FULL ordered set, PRE-noise-filter.
//              The reader MUST emit one entry per source record (even empty ones) so the cursor
//              count stays stable across the per-turn re-fires; the noise filter here only decides
//              what gets WRITTEN, never what gets COUNTED.
//   cwd        session cwd — drives the scope gate.
//   sessionId  raw session id (sanitized here).
//   event      hook event name (cursor metadata only).
//   provenance value for the staging `transcript:` field (Claude: transcript path; Hermes: state.db ref).
//   brain      'claude' | 'hermes' — stamped in the staging frontmatter; B4's audience mint reads it.
//
// CAPTURE_DRY_RUN=1 -> compute + report to stdout, write nothing (proves a reader before wiring).

import {
  readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ensureScope, MEMORY_ROOT } from './bootstrap.mjs';

const DRY = process.env.CAPTURE_DRY_RUN === '1';

// ---------- scope decision (DESIGN §9; unmapped = opt-in only, 2026-06-23) ----------
// A session is captured ONLY if it resolves to a REAL scope. Priority:
//   1. COCKPIT_SCOPE env  — explicit pre-launch override
//   2. mapped cwd         — ~/projects/<x> -> <x>;  ~/.cockpit -> cockpit
//   3. #capture opt-in    — the user typed #capture / #capture:<scope> in the session
//   else -> null = DO NOT CAPTURE. Unmapped cwds no longer fabricate a `global` scope, so
//   autonomous agents (Hermes, ex-paperclip) and incidental sessions never auto-enroll. The
//   same gate now fences the Hermes reader structurally (this is the paperclip protection).
function mappedScope(cwd) {
  const home = homedir();
  const projects = resolve(home, 'projects');
  if (cwd === projects || cwd.startsWith(projects + sep)) {
    const top = relative(projects, cwd).split(sep)[0];
    if (top) return top;                       // ~/projects/<x> -> <x>
  }
  const cockpit = resolve(home, '.cockpit');
  if (cwd === cockpit || cwd.startsWith(cockpit + sep)) return 'cockpit';
  return null;                                 // unmapped — no fabricated scope
}

// #capture / #capture:<scope> in the user's text opts an otherwise-unmapped session in.
// Collision-free like #good/#bad (MEM-22); bare #capture -> global, #capture:<scope> -> that scope.
const RE_CAPTURE = /(?:^|\s)#capture(?::([a-z0-9][a-z0-9-]*))?\b/i;
function captureOptIn(userText) {
  const m = userText.match(RE_CAPTURE);
  return m ? (m[1] || 'global').toLowerCase() : null;
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

// ---------- error log (silent toward the session, traceable for us) ----------
export function logError(err) {
  try {
    const p = resolve(MEMORY_ROOT, 'scopes', 'global', 'staging', '.capture-errors.log');
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`, 'utf8');
  } catch { /* truly nothing we can do — stay silent */ }
}

// ---------- the shared pipeline ----------
export async function capture({ entries, cwd, sessionId, event, provenance, brain } = {}) {
  sessionId = String(sessionId || 'unknown-session').replace(/[^a-zA-Z0-9_-]/g, '');
  cwd = cwd || process.cwd();
  event = event || 'Unknown';
  brain = brain || 'unknown';
  provenance = provenance || '(none)';
  if (!Array.isArray(entries)) entries = [];

  // Decide scope. Unmapped + no #capture opt-in -> skip entirely (no fabricated `global`).
  let scope = process.env.COCKPIT_SCOPE ? process.env.COCKPIT_SCOPE.trim() : mappedScope(cwd);
  if (!scope) {
    const userText = entries.filter((e) => e && e.role === 'user').map((e) => e.text || '').join('\n');
    scope = captureOptIn(userText);
    if (!scope) return { scope: null, skipped: 'no-scope' };
  }

  await ensureScope(scope);                            // lazily materializes dormant scopes (OPEN-7)

  const stagingDir = resolve(MEMORY_ROOT, 'scopes', scope, 'staging');
  const cursorDir = resolve(stagingDir, '.cursors');
  const cursorFile = resolve(cursorDir, `${sessionId}.json`);

  // how many source records have we already captured for this session?
  let cursor = 0;
  try { cursor = JSON.parse(readFileSync(cursorFile, 'utf8')).count || 0; } catch { /* fresh */ }

  if (entries.length <= cursor) return { scope, skipped: 'nothing-new', cursor };

  const fresh = entries.slice(cursor);
  const date = new Date().toISOString().slice(0, 10);
  const outFile = resolve(stagingDir, `${date}__${sessionId}.md`);
  const isNew = !existsSync(outFile);

  let out = '';
  if (isNew) {
    out += `---\ntype: staging\nscope: ${scope}\nbrain: ${brain}\nsession_anchor: ${sessionId}\n`
        +  `transcript: ${provenance}\nstarted: ${new Date().toISOString()}\nschema_version: 1\n---\n\n`
        +  `_Near-raw capture (MEM-16). Raw record is the source of truth (\`transcript:\` above);\n`
        +  `huge tool outputs are not duplicated here. Salience tags are mechanical (MEM-22), not judgments._\n\n`;
  }

  let appended = 0;
  for (const e of fresh) {
    const role = (e && e.role) || 'unknown';
    const text = (e && e.text) || '';
    const errored = !!(e && e.errored);
    if (!text && !errored) continue;                   // mechanical noise filter (tool plumbing)

    const tags = [];
    if (role === 'user') tags.push(...userSalience(text));
    if (errored) tags.push('error');
    const tagStr = tags.length ? `  [${[...new Set(tags)].join(', ')}]` : '';

    out += `#### ${role} · ${(e && e.ts) || ''}${tagStr}\n${text || '(tool error — see transcript)'}\n\n`;
    appended++;
  }

  const result = { scope, brain, outFile: relative(MEMORY_ROOT, outFile), isNew, cursor, newCursor: entries.length, appended };

  if (DRY) {
    console.log('[capture dry-run] ' + JSON.stringify(result, null, 2));
    console.log('--- would append (first 800 chars) ---\n' + out.slice(0, 800) + (out.length > 800 ? '\n…[truncated]' : ''));
    return result;
  }

  if (appended > 0 || isNew) appendFileSync(outFile, out, 'utf8');
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(cursorFile, JSON.stringify({ count: entries.length, event, updated: new Date().toISOString() }), 'utf8');
  return result;
}
