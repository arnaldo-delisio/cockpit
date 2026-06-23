# Cockpit — Build Context

Loads only when working under `~/.cockpit` (building the cockpit itself). The global builder
shell (`shells/CLAUDE.md`) already loads here too — this file adds only what's specific to
building the cockpit. Keep it thin: it points, it doesn't contain.

## Orient before building
1. `STATE.md` — roadmap + status; its head carries the resume packet + document map.
2. Newest `log/YYYY-MM.md` — what just happened (entries newest-first).
3. `DECISIONS.md` (+ `decisions/<topic>.md`) — locked decisions and why; build *on* them.
4. Specs → `memory-engine/DESIGN.md`.
5. **A mid-flight build's transient tracker is the resume anchor** — currently `MEMORY-BUILD.md`.

## Write to the home, not here
One fact, one home (DOC-1): STATE = roadmap · DECISIONS = ledger · decisions/ = deep dives ·
DESIGN = specs · log/ = chronology. Record in the home first, then add a pointer.
