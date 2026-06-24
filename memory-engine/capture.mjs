#!/usr/bin/env node
// capture.mjs — Claude-side capture reader (B1; was the whole pipeline, now a thin reader).
//
// Registered as a Claude Code Stop / PreCompact / SessionEnd hook. Reads the hook JSON from
// stdin, turns the transcript JSONL into a normalized entries[], and hands it to the shared
// brain-neutral pipeline (capture-core.mjs). All judgment is the reconciler's (dumb capture).
//
// FAIL-SAFE: every error is swallowed (logged to global staging/.capture-errors.log) and the
// process exits 0 — capture must NEVER disrupt the session it observes.

import { readFileSync, existsSync } from 'node:fs';
import { capture, logError } from './capture-core.mjs';

// ---------- Claude transcript shape: content = string | block[] (formats drift — never throw) ----------
function textOf(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text).join('\n').trim();
  }
  return '';
}
function hasToolError(content) {
  return Array.isArray(content)
    && content.some((b) => b && b.type === 'tool_result' && b.is_error === true);
}

async function main() {
  let hook = {};
  try { hook = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/garbled stdin */ }

  const tpath = hook.transcript_path;
  if (!tpath || !existsSync(tpath)) return;            // nothing to capture

  // One normalized entry per parsed transcript line (incl. empties) so the cursor count is stable.
  const lines = readFileSync(tpath, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const ln of lines) {
    let e; try { e = JSON.parse(ln); } catch { continue; }   // skip bad line
    const role = (e.message && e.message.role) || e.type || 'unknown';
    const content = e.message ? e.message.content : undefined;
    entries.push({ role, text: textOf(content), errored: hasToolError(content), ts: e.timestamp || '' });
  }

  await capture({
    entries,
    cwd: hook.cwd || process.cwd(),
    sessionId: hook.session_id,
    event: hook.hook_event_name || 'Unknown',
    provenance: tpath,
    brain: 'claude',
  });
}

main().catch(logError).finally(() => process.exit(0));
