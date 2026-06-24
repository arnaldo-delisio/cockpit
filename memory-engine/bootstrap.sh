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
# (Other out-of-repo wiring — settings.json capture hooks, ~/.hermes config + SOUL symlink, autoMemory
# off, the skills bridge — is tracked separately in STATE/log and not yet folded in here. Add it as its
# own section when those are reconciled clone-clean.)
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
