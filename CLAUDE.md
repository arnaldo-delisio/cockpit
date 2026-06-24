# Cockpit — Build Context

Loads only when working under `~/.cockpit` (building the cockpit itself). The global builder
shell (`shells/CLAUDE.md`) already loads here too — this file adds only what's specific to
building the cockpit. Keep it thin: it points, it doesn't contain.

## Orient before building
1. `STATE.md` — roadmap + status; its head carries the resume packet + document map.
2. Newest `log/YYYY-MM.md` — what just happened (entries newest-first).
3. `DECISIONS.md` (+ `decisions/<topic>.md`) — locked decisions and why; build *on* them.
4. Specs → `memory-engine/DESIGN.md`.
5. **A mid-flight build's transient tracker, if one exists, is the resume anchor** — none currently (the Memory build's `MEMORY-BUILD.md` was deleted at close-out 2026-06-24; its content is homed in STATE/DECISIONS/DESIGN/log).

## Write to the home, not here
One fact, one home (DOC-1): STATE = roadmap · DECISIONS = ledger · decisions/ = deep dives ·
DESIGN = specs · log/ = chronology. Record in the home first, then add a pointer.

<!-- managed:reconciler:begin schema=2 inputs=96c9c5d5 -->
## Rules (projected from memory — do not edit; edit the source node)
### Emerging (volatile — promotes to Durable after 3 consecutive reconciles)
- Verify source and subagent claims before freezing them into memory, code, or decisions. [[cockpit-reviewer-workflow]]
- Recommend a path and adversarially double-check important decisions before locking them in. [[global-working-rhythm-rules]]
- Inspect live cockpit wiring before changing it; make the smallest reversible change and verify both brains when relevant. [[prefer-grounded-verification-before-changing-cockpit-wiring]]
- Dry-run first executions that could write, commit, or trigger side effects by import. [[first-executions-must-be-dry-run-safe]]
- Confirm cleanup scope before deleting any workspace that may contain user-created work. [[do-not-delete-real-workspaces-just-because-an-agent-touched-]]
- Apply prior decisions by preserving their intent, not overfitting to literal wording. [[build-2-import-ban-targets-bulky-deep-dives-not-thin-shell-r]]
<!-- managed:reconciler:end -->
