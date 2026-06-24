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

<!-- managed:reconciler:begin schema=1 inputs=ebf6db76 -->
## Rules (projected from memory — do not edit; edit the source node)
- Inspect canonical docs and live wiring before changing shell, skills, memory, or bridge infrastructure. [[prefer-grounded-verification-before-changing-cockpit-wiring]]
- Apply locked decisions by intent, not literal wording; avoid bulky eager loads, not thin shell pointers. [[build-2-import-ban-targets-bulky-deep-dives-not-thin-shell-r]]
<!-- managed:reconciler:end -->
