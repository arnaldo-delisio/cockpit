#!/usr/bin/env node
// judge.mjs — the reconciler's single model-access adapter (MEM-25, endpoint revised 2026-06-23).
//
// Shells to `hermes -z` riding in-plan Codex OAuth (no metered billing, MR-1). Tiered per TOOL-3,
// both in-plan Codex — pinned explicitly so judge() does NOT depend on the user's mutable hermes
// default provider/model:
//   tier 'hard' -> gpt-5.5        (distill->node, conflict resolution, centrality)
//   tier 'bulk' -> gpt-5.4-mini   (triage, classify, summarize)
// Throttle-fallback to local Gemma (MR-1 tier 2) is deferred — only if the shared Codex 5h/week
// window bites. Swappable by design: a Claude adapter (`claude -p`) is a one-file replacement here.
//
// `--ignore-rules` keeps session memory/rules/AGENTS.md out of the call; `-t ''` disables toolsets
// (pure text completion). Verified: `-z` prints ONLY the completion text to stdout (no banner).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const PROVIDER = 'openai-codex';                 // in-plan; pinned, not the user's mutable default
const MODEL_BY_TIER = { hard: 'gpt-5.5', bulk: 'gpt-5.4-mini' };

// judge(prompt, { tier, json, retries, timeoutMs }) -> parsed object (json) | string (text)
export async function judge(prompt, opts = {}) {
  const { tier = 'hard', json = true, retries = 1, timeoutMs = 120_000 } = opts;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('judge: empty prompt');
  if (!(tier in MODEL_BY_TIER)) throw new Error(`judge: unknown tier "${tier}"`);

  let attempt = 0;
  let p = prompt;
  let lastRaw = '';
  while (attempt <= retries) {
    lastRaw = await callHermes(p, tier, timeoutMs);
    if (!json) return lastRaw;
    const parsed = tryParseJson(lastRaw);
    if (parsed !== undefined) return parsed;          // undefined = parse failure (valid `null` is kept)
    attempt++;
    p = `${prompt}\n\nYour previous reply was NOT valid JSON. Reply with ONLY the JSON value, `
      + `starting with "{" or "[" and nothing else — no prose, no markdown fences.`;
  }
  const err = new Error('judge: model did not return parseable JSON after retries');
  err.raw = lastRaw;
  throw err;
}

async function callHermes(prompt, tier, timeoutMs) {
  const args = ['-z', prompt, '-m', MODEL_BY_TIER[tier], '--provider', PROVIDER, '--ignore-rules', '-t', ''];
  const { stdout } = await execFileP('hermes', args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

// Tolerant JSON extraction: whole string -> fenced block -> first {...}/[...]. Returns undefined on failure.
function tryParseJson(text) {
  try { return JSON.parse(text); } catch { /* not bare JSON */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fenced but not JSON */ } }
  const span = text.match(/[{[][\s\S]*[}\]]/);
  if (span) { try { return JSON.parse(span[0]); } catch { /* not a JSON span */ } }
  return undefined;
}

// Direct-run helper for manual testing:  node judge.mjs "<prompt>" [tier]   (prints raw text)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const prompt = process.argv[2];
  const tier = process.argv[3] || 'hard';
  judge(prompt, { tier, json: false })
    .then((r) => { process.stdout.write(r + '\n'); })
    .catch((e) => { console.error('judge failed:', e.message); process.exit(1); });
}
