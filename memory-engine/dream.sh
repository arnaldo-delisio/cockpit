#!/usr/bin/env bash
# dream.sh — the "dreaming" pass runner; the systemd user service's ExecStart (DESIGN §5/§8; STATE dreaming).
#
# Thin wrapper around `node reconcile.mjs --reflect`. It exists for three unattended-run concerns the bare
# `node` invocation can't cover (minimalism rung 6 — the minimum that actually works):
#   1. PATH — judge() shells to `hermes`, which lives in ~/.local/bin; a systemd USER service's default PATH
#      does NOT include it, so an un-wrapped run would fail every night with "hermes: not found".
#   2. Observability — tee stdout+stderr to a rolling log beside the audit diffs (memory/.reconciler/), so a
#      human has one place to read the last run; systemd's journal captures the same stream independently.
#   3. Failure visibility — exit with the reconciler's own status so a bad run shows `failed` in
#      `systemctl --user status cockpit-reconcile.service` (and the journal), instead of silently "succeeding".
#
# In-repo + path-relative (resolves its own dir) => clone-clean. No secrets, no hardcoded absolute paths.

set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"   # ~/.cockpit/memory-engine
LOG="$ENGINE_DIR/../memory/.reconciler/dreaming.log"           # gitignored; sits beside .reconciler/audit/

# hermes (judge()'s model access) is in ~/.local/bin; node is in /usr/bin (or a version manager on PATH).
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

mkdir -p "$(dirname "$LOG")"

# keep the log bounded (last ~2000 lines) so an unattended nightly run can't grow it without limit.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

ts() { date -Is; }

# Run inside a pipeline to tee; capture node's status via the explicit exit + PIPESTATUS.
{
  echo "===== dreaming reflect START $(ts) (host $(hostname)) ====="
  node "$ENGINE_DIR/reconcile.mjs" --reflect
  rc=$?
  echo "===== dreaming reflect END   $(ts) exit=$rc ====="
  exit $rc
} 2>&1 | tee -a "$LOG"

exit "${PIPESTATUS[0]}"
