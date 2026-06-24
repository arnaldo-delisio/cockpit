#!/usr/bin/env node
// hermes-capture.mjs — Hermes-side capture reader (B1; counterpart to capture.mjs, TOOL-6).
//
// Registered as a Hermes `on_session_end` shell hook (config.yaml). Reads the hook JSON from
// stdin (session_id + cwd; NO transcript_path — Hermes keeps conversations in state.db), pulls
// the session's turns from ~/.hermes/state.db via the built-in node:sqlite (read-only, no new
// dependency), normalizes them to entries[], and hands them to the shared brain-neutral pipeline.
//
// `on_session_end` fires per-turn (turn_finalizer.py) — like Claude's Stop — so capture is
// incremental via the same per-session cursor. Same §9 scope gate as the Claude path: an
// unmapped cwd with no #capture opt-in SKIPS, so autonomous/gateway Hermes sessions never
// auto-enroll (paperclip protection, structural).
//
// Rows are read WITHOUT the `active=1` filter (ORDER BY timestamp, id): the cursor is a count,
// and `active` flips to 0 on compaction, which would shrink the count and strand later turns
// behind a stale cursor. All-rows is append-monotonic (stable cursor) and compacted turns are
// still real memory. The reconciler dedups any compaction-summary rows downstream.
//
// FAIL-SAFE: errors swallowed to the shared error log; always exit 0 — never disrupt Hermes.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { capture, logError } from './capture-core.mjs';

const STATE_DB = resolve(homedir(), '.hermes', 'state.db');

// Hermes tool results are JSON ({"success":bool,...} | {"output":...} | {"content":...}). A tool
// error is STRUCTURAL: top-level success===false, a truthy `error` key, or is_error===true.
// (Substring scanning false-fires on legit output — verified against the live store.)
function toolErrored(content) {
  if (typeof content !== 'string' || !content) return false;
  let j; try { j = JSON.parse(content); } catch { return false; }
  if (!j || typeof j !== 'object') return false;
  return j.success === false || j.is_error === true || ('error' in j && !!j.error);
}

async function main() {
  let hook = {};
  try { hook = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/garbled stdin */ }

  const sessionId = hook.session_id;
  if (!sessionId) return;                              // nothing to locate

  const db = new DatabaseSync(STATE_DB, { readOnly: true });
  let rows;
  try {
    rows = db.prepare(
      'SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp, id'
    ).all(sessionId);
  } finally {
    db.close();
  }

  // One normalized entry per row (incl. empties / tool plumbing) so the cursor count stays stable.
  const entries = rows.map((r) => {
    const role = r.role || 'unknown';
    const isTool = role === 'tool';
    return {
      role,
      // Don't duplicate large tool outputs in staging (raw lives in state.db) — mirror the Claude
      // path, which surfaces tool ERRORS but drops tool plumbing. User/assistant text is verbatim.
      text: isTool ? '' : (typeof r.content === 'string' ? r.content.trim() : ''),
      errored: isTool ? toolErrored(r.content) : false,
      ts: typeof r.timestamp === 'number' ? new Date(r.timestamp * 1000).toISOString() : '',
    };
  });

  await capture({
    entries,
    cwd: hook.cwd || process.cwd(),
    sessionId,
    event: hook.hook_event_name || 'on_session_end',
    provenance: `hermes:state.db#${sessionId}`,
    brain: 'hermes',
  });
}

main().catch(logError).finally(() => process.exit(0));
