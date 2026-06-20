# Memory — PLACEHOLDER

Shared memory substrate for both Hermes and Claude. Structure TBD.

> Do not build structure here yet. Designed during the memory deep dive after the
> user's videos/resources are analyzed. See `~/.cockpit/STATE.md`.

Requirements to satisfy:
- Scopes: global/personal, per-project, per-client (no cross-client leak).
- Readable AND writable by both brains, one substrate, no drift.
- Reconcile with Claude Code file memory, Hermes memory, context-mode MCP KB.
