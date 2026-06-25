#!/usr/bin/env node
// judge-claude.mjs — Claude Code CLI adapter for the reconciler's judge() (MEM-25).
// Uses `claude -p` (subscription-based, no per-token billing; mirrors judge-hermes.mjs's hermes -z pattern).
// Tiered models, both subscription Claude:
//   tier 'hard' -> claude-opus-4-8   (distill->node, conflict resolution, centrality)
//   tier 'bulk' -> claude-sonnet-4-6 (triage, classify, summarize)
//
// BRAIN-NEUTRALITY: --system-prompt replaces the entire Claude Code default system prompt with the neutral
// reconciler identity (no Claude Code persona, no CLAUDE.md content). Belt-and-suspenders: cwd =
// ~/.cache/cockpit-reconciler (its own git root, no CLAUDE.md in ancestry → CLAUDE.md auto-discovery
// finds nothing). --no-session-persistence: no disk save, no resume. Each call is independent.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { mkdir, stat } from 'node:fs/promises';

const execFileP = promisify(execFile);

const MODEL_BY_TIER = { hard: 'claude-opus-4-8', bulk: 'claude-sonnet-4-6' };

// Neutral cwd: no CLAUDE.md in ancestry, own git root — CLAUDE.md auto-discovery stops here.
// Same dir the Hermes adapter already provisions; re-used without its Hermes-specific scaffolding.
const RECON_HOME = resolve(homedir(), '.cache', 'cockpit-reconciler');

// Replaces the entire Claude Code default system prompt via --system-prompt.
const NEUTRAL_SOUL = `You are the cockpit memory reconciler: a brain-neutral text-distillation function.
You are owned by NEITHER the operator (Hermes) NOR the builder (Claude Code); you serve the shared memory graph, not either agent.
Carry no persona, no doctrine, no standing preferences of your own. Follow each request's instructions exactly and literally, and output only what it asks for (usually strict JSON) — no added identity, commentary, or opinions.
`;

let _homeReady;
function ensureReconcilerHome() {
  return (_homeReady ||= (async () => {
    await mkdir(RECON_HOME, { recursive: true });
    try { await stat(resolve(RECON_HOME, '.git')); }
    catch { await execFileP('git', ['init', '-q', RECON_HOME]).catch(() => {}); }
    return RECON_HOME;
  })());
}

// judge(prompt, { tier, json, retries, timeoutMs }) -> parsed object (json) | string (text)
export async function judge(prompt, opts = {}) {
  const { tier = 'hard', json = true, retries = 1, timeoutMs = 120_000 } = opts;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('judge: empty prompt');
  if (!(tier in MODEL_BY_TIER)) throw new Error(`judge: unknown tier "${tier}"`);

  let attempt = 0;
  let p = prompt;
  let lastRaw = '';
  while (attempt <= retries) {
    lastRaw = await callClaude(p, tier, timeoutMs);
    if (!json) return lastRaw;
    const parsed = tryParseJson(lastRaw);
    if (parsed !== undefined) return parsed;
    attempt++;
    p = `${prompt}\n\nYour previous reply was NOT valid JSON. Reply with ONLY the JSON value, `
      + `starting with "{" or "[" and nothing else — no prose, no markdown fences.`;
  }
  const err = new Error('judge: model did not return parseable JSON after retries');
  err.raw = lastRaw;
  throw err;
}

async function callClaude(prompt, tier, timeoutMs) {
  const home = await ensureReconcilerHome();
  const args = [
    '-p', prompt,
    '--system-prompt', NEUTRAL_SOUL,
    '--model', MODEL_BY_TIER[tier],
    '--no-session-persistence',
    '--output-format', 'text',
  ];
  const { stdout } = await execFileP('claude', args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    cwd: home,
  });
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

// Direct-run helper for manual testing:  node judge-claude.mjs "<prompt>" [tier]   (prints raw text)
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const prompt = process.argv[2];
  const tier = process.argv[3] || 'hard';
  judge(prompt, { tier, json: false })
    .then((r) => { process.stdout.write(r + '\n'); })
    .catch((e) => { console.error('judge failed:', e.message); process.exit(1); });
}
