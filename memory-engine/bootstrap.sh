#!/usr/bin/env bash
# bootstrap.sh — clone-clean installer for the memory engine's OUT-OF-REPO wiring.
#
# Sibling of bootstrap.mjs: that script reproduces the DATA TREE (memory/ dirs); this one reproduces the
# wiring that lives OUTSIDE any repo and so can't be version-controlled directly. On a fresh clone you run
# both to recreate the working setup.
#
# THIS iteration installs the "dreaming" pass (STATE: Memory — NEXT): a systemd USER timer that runs
#   node memory-engine/reconcile.mjs --reflect
# nightly, off-peak, unattended (DESIGN §5/§8; MEM-16 two-tempo; MEM-25 runtime). The lockfile already
# fences it against a manual run; judge() is already brain-neutral.
#
# It ALSO reproduces the OM-2 home shell wiring (clone-clean): the ~/.hermes/SOUL.md → shells/SOUL.md
# symlink (how `hermes -z` loads the operator shell as identity slot #1) + the ~/CLAUDE.md @-import loader
# and the ~/SOUL.md signpost; AND the Claude Code memory hooks in ~/.claude/settings.json (capture write
# hooks + the OPEN-9 recall read hook + autoMemoryEnabled:false). (Still tracked separately, NOT yet folded
# in: the ~/.hermes config capture hook, the skills bridge — add them here once reconciled.)
#
# Idempotent + clone-clean: unit files use systemd's %h specifier (no hardcoded home), every path resolves
# relative to this script, no secrets. Safe to re-run.
#
# Usage:
#   bootstrap.sh                 install units + enable-linger + enable --now the nightly timer (full setup)
#   bootstrap.sh --install-only  install unit files + daemon-reload ONLY (no linger, no enable) — for review

set -euo pipefail

INSTALL_ONLY=0
[ "${1:-}" = "--install-only" ] && INSTALL_ONLY=1

ENGINE_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"   # ~/.cockpit/memory-engine
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE="cockpit-reconcile.service"
TIMER="cockpit-reconcile.timer"

# ── OM-2 home shell wiring (clone-clean; installed regardless of systemd) ─────────────────────────
# The operator shell loads via a symlink ~/.hermes/SOUL.md → shells/SOUL.md (`hermes -z` injects it as
# identity slot #1; SOUL.md can't @-import — that is builder-only). The two home files are thin loaders/
# signposts over the canonical in-repo shells. Idempotent: symlink replaced in place; files written only
# when their content drifts (no mtime churn).
COCKPIT_ROOT="$(dirname "$ENGINE_DIR")"
SHELLS_DIR="$COCKPIT_ROOT/shells"

install_file() {  # $1=path  $2=content — write only if missing or changed
  if [ ! -e "$1" ] || [ "$(cat "$1" 2>/dev/null)" != "$2" ]; then
    printf '%s\n' "$2" > "$1"
    echo "bootstrap: wrote $1"
  else
    echo "bootstrap: $1 already current"
  fi
}

mkdir -p "$HOME/.hermes"
ln -sfn "$SHELLS_DIR/SOUL.md" "$HOME/.hermes/SOUL.md"   # operator load wiring (OM-2 resolved 2026-06-24)
echo "bootstrap: linked ~/.hermes/SOUL.md → $SHELLS_DIR/SOUL.md"

install_file "$HOME/CLAUDE.md" '<!-- Loader. The canonical builder shell is version-controlled at ~/.cockpit/shells/CLAUDE.md and imported below — edit it there, not here. -->

@.cockpit/shells/CLAUDE.md'

install_file "$HOME/SOUL.md" '<!-- Pointer only — nothing loads this file. Hermes loads the operator shell via the symlink
     ~/.hermes/SOUL.md → ~/.cockpit/shells/SOUL.md (`hermes -z` injects it as identity slot #1).
     SOUL.md cannot use the Claude Code @-import (builder-only); the symlink is the wiring.
     Edit the canonical shell at ~/.cockpit/shells/SOUL.md, not here. -->

# Global Hermes Operator Shell — pointer

Canonical: ~/.cockpit/shells/SOUL.md  (loaded by Hermes via ~/.hermes/SOUL.md → it).'

# ── Claude Code memory hooks in ~/.claude/settings.json (clone-clean) ──────────────────────────────
# settings.json lives outside any repo, so a clone has none of the memory wiring. Reproduce it here,
# idempotently: the WRITE hooks (capture: Stop/PreCompact/SessionEnd → capture.mjs) and the READ hook
# (recall: UserPromptSubmit → recall-hook.mjs, OPEN-9), plus autoMemoryEnabled:false (TOOL-6 — our
# capture.mjs is the writer, not native auto-memory). A node merge preserves every other setting and
# only appends a hook when its exact command is absent (re-run = no-op). Absolute paths (the
# settings.json convention; ~/ would not expand inside a hook command).
ENGINE_DIR="$ENGINE_DIR" SETTINGS="$HOME/.claude/settings.json" node <<'NODE'
const fs = require('fs'), path = require('path');
const engine = process.env.ENGINE_DIR, file = process.env.SETTINGS;
let s = {};
try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh */ }
s.hooks ||= {};
const cmd = (script) => `node "${engine}/${script}"`;
const ensure = (event, command) => {
  s.hooks[event] ||= [];
  if (s.hooks[event].some((g) => (g.hooks || []).some((h) => h.command === command))) return false;
  s.hooks[event].push({ hooks: [{ type: 'command', command }] });
  return true;
};
let changed = false;
for (const ev of ['Stop', 'PreCompact', 'SessionEnd']) changed = ensure(ev, cmd('capture.mjs')) || changed;
changed = ensure('UserPromptSubmit', cmd('recall-hook.mjs')) || changed;      // OPEN-9 read-path
if (s.autoMemoryEnabled !== false) { s.autoMemoryEnabled = false; changed = true; }
if (changed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  console.log('bootstrap: settings.json memory hooks ensured (' + file + ')');
} else {
  console.log('bootstrap: settings.json memory hooks already current');
}
NODE

if ! command -v systemctl >/dev/null 2>&1; then
  echo "bootstrap: systemctl not found — this host has no systemd; install a cron line by hand instead." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"

# --- the service: a oneshot that runs the dreaming reflect via the dream.sh wrapper (PATH + logging) ---
# %h = the user's home (systemd-expanded) → clone-clean, no baked absolute path.
cat > "$UNIT_DIR/$SERVICE" <<'UNIT'
[Unit]
Description=Cockpit memory reconciler — nightly "dreaming" reflect pass (DESIGN §5/§8)
Documentation=file:%h/.cockpit/memory-engine/DESIGN.md

[Service]
Type=oneshot
# dream.sh sets PATH (hermes is in ~/.local/bin), tees output to memory/.reconciler/dreaming.log,
# and exits with the reconciler's status so a failed run shows up as failed.
ExecStart=%h/.cockpit/memory-engine/dream.sh
# A reflect pass makes a few Codex calls; cap so a hung run can't wedge the timer forever.
TimeoutStartSec=1800
Nice=10
UNIT

# --- the timer: 04:00 local, off-peak (away from daytime Codex 5h-window use); Persistent for a laptop ---
cat > "$UNIT_DIR/$TIMER" <<'UNIT'
[Unit]
Description=Nightly trigger for the Cockpit memory "dreaming" reflect pass
Documentation=file:%h/.cockpit/memory-engine/DESIGN.md

[Timer]
OnCalendar=*-*-* 04:00:00
# Spread the fire time so it never lands on a fixed second; harmless on a single host, tidy in logs.
RandomizedDelaySec=30min
# Laptop is often asleep at 04:00 — run once on the next wake/boot if the scheduled time was missed.
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
echo "bootstrap: installed $SERVICE + $TIMER to $UNIT_DIR (daemon reloaded)."

if [ "$INSTALL_ONLY" -eq 1 ]; then
  cat <<EOF
bootstrap: --install-only — units written, NOT enabled. To finish (the reviewer-gated step):
    loginctl enable-linger "$USER"
    systemctl --user enable --now $TIMER
    systemctl --user list-timers $TIMER
EOF
  exit 0
fi

# --- full setup: linger so the timer fires while logged out, then enable the timer ---
loginctl enable-linger "$USER"
echo "bootstrap: enabled linger for $USER (timer fires while logged out)."
systemctl --user enable --now "$TIMER"
echo "bootstrap: enabled + started $TIMER. Next runs:"
systemctl --user list-timers "$TIMER" --no-pager || true
