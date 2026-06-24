---
topic: Operating model — the foundational shape of the whole system
decisions: [OM-1, OM-2, OM-3, OM-4, OM-6]
status: locked
date: 2026-06-18
---

# Operating Model

## TL;DR

This system is two distinct agents — a singular builder (Claude Code) and a fleet of operator/capability-agents (Hermes) — coordinating through shared memory, a shared board, and the human, with no master conductor. Each has a thin global shell at `~`; all real identities live inside scoped projects. Skills carry their own doctrine; no separate architecture docs per capability. Model routing is a sibling concern (OM-5, its own file).

---

## Context

### What this system is

A personal cockpit OS running on a laptop. It spans the full range of knowledge work: building software (ventures, client projects), operating domains of life and work (content, job-apps, ops), and managing memory + knowledge across everything.

### The two-substrate reality

Two fundamentally different kinds of work need to coexist:

- **Build substrate:** codebase reasoning, multi-file edits, planning, architectural judgment. Requires deep context, long sessions, access to every project file.
- **Operate substrate:** domain automation at cadence — publishing content, filing applications, generating bills, surfacing follow-ups. Requires identity, voice, primed skills, and fast time-to-action.

These aren't just different tasks — they run on different mental models, different toolsets, different invocation patterns. Conflating them produces a system that does both badly. The operating model follows from this split.

---

## Builder + operator fleet

### The two roles

**Claude Code = the singular builder/engineer.** One role, one instance: codebase reasoning, multi-file edits, planning, and synthesis. Loaded via `~/CLAUDE.md`. Its value is deep technical context over a project; there is and should be only one of it at a time.

**Hermes = a class of operator/capability-agents, not one agent.** Each Hermes instance automates a specific domain of life/work — content, job-apps, ops, billing, outreach. Hermes is the product (Jack Roberts framing: `soul.md`, primes, skills-with-model-binding, levels 1–7). `~/SOUL.md` is its identity substrate. Different Hermes instances may run in parallel, each domain-scoped.

The earlier framing was "two brains." That was superseded: Hermes is not one brain but a class of agents. This distinction matters for coordination (see below).

### Why a fleet, not one agent

A single omnibus Hermes agent would collapse everything into one context, one set of primes, one risk surface. Different domains need different voice, different skills, different model bindings. A fleet of capability-agents each runs tight and domain-specific. Failures stay contained; agents compose rather than collide.

### Coordination: no master conductor — why

Coordination between Claude Code and the Hermes fleet runs through three channels: **shared memory** (both read and write the same canonical knowledge graph), a **shared board** (Kanban-style task list, substrate TBD — see OPEN-3), and **the human** (ultimate routing, prioritization, and handoff decisions).

There is no master conductor agent — no orchestrator that routes between builder and operator. This is deliberate.

**Why peers over a master conductor:**

| concern | master-conductor design | peers / stigmergic |
|---|---|---|
| single point of failure | yes — master crashes, nothing moves | no — each agent operates independently |
| coordination overhead | every task flows through one bottleneck | agents read shared state directly |
| scope creep | master grows into a meta-agent knowing everything | each agent stays domain-scoped |
| two-substrate mismatch | master must speak both build and operate fluently — hard | builder and operator each speak their substrate |
| cost | master inference runs even for trivial handoffs | human routes; inference fires only when needed |

Stigmergic coordination — agents leaving traces in shared state that other agents read and act on — is sufficient for the current scale. The human handles ambiguous routing calls. This works because the fleet is small, the domains are distinct, and the memory substrate is shared.

**What remains open:** the specific delegation/result contract between Hermes and Claude Code when Hermes needs something built. The handoff interface — what Hermes sends, what Claude returns, and how state is threaded — is undesigned as of 2026-06-18 (OPEN-4). This is the one coordination seam not yet specified.

---

## Thin global shells + the owned-not-avoided `~/CLAUDE.md`

Two files live at `~`, one per agent class:

- `~/CLAUDE.md` — builder shell (Claude Code)
- `~/SOUL.md` — operator shell (Hermes)

Both are **infra only, not "personal."** They do not contain any real identity (no client voice, no project-specific behavior, no venture primes). Those live inside scoped projects.

### Why thin is non-negotiable for `~/CLAUDE.md`

Claude Code merges every `CLAUDE.md` from the current working directory up to `/`, loading all of them in every session. There is no opting out. The global `~/CLAUDE.md` therefore loads in every project session — a venture session, a client session, any session anywhere. If it were fat (personal opinions, stale context, project-specific rules), it would corrupt every session it touched.

The response is not to avoid the file (you cannot avoid it) — it is to **own it and keep it thin.** The current skeleton is ~47 lines: Identity pointer, one Orientation pointer to `STATE.md`, Build doctrine, Model routing policy, hard Guardrails. Nothing that could contaminate a project session.

`@`-imports (eager-load, inline the full referenced file every session, recursive to 4 hops) are excluded from the global root for the same reason: they would inflate context on every invocation regardless of relevance. Deep-dive files are referenced as backtick paths (lazy, not loaded unless requested).

---

## Identity is per-context, never global

Every real identity — each venture, each client engagement, the personal self — lives as a **scoped project** under `~/projects/` (or its per-venture/per-client subdirectory). The global files carry the operator's meta-identity (`soul.md` = Hermes/Arn at global scope), not any context's identity.

This follows from the two-axis memory model (TYPE × SCOPE). The global scope hosts the operator meta-identity; per-venture, per-client, and personal identities each live in their own scope. "Identity is per-context, never global" holds precisely because the global file is the *operator's* — not a context's — identity.

Practical consequence: there is no such thing as a "global venture voice" or "global client style." Those are loaded when the session enters that project's directory, via the project's own `CLAUDE.md` and memory. The global shell knows nothing about them.

---

## Skills, not docs-about-skills

Doctrine for any capability lives **inside** the `SKILL.md` for that capability — in a `## Rules` or equivalent block that is loaded when the skill is invoked. There is no parallel architecture document per skill.

The alternative — a separate architecture doc explaining what a skill does and why — creates two artifacts that diverge. The skill executes; the doc describes. They drift. When they conflict, neither is authoritative. Collapsing doctrine into the skill itself eliminates the drift: the running artifact *is* the specification.

This also keeps the cockpit lean. Skills at `~/.cockpit/skills/` are the live system; no shadow documentation layer needs maintenance alongside them.

---

## Nuances, caveats, open threads

**OM-6 (can't hide from `~/CLAUDE.md`)** is as much a constraint as a decision. The merging behavior is not configurable — Claude Code does it. The decision is to treat the constraint as a design input rather than fighting it: own the file, keep it thin, make it additive not contaminating.

**The Hermes↔Claude handoff is the one undesigned seam (OPEN-4).** When a Hermes agent needs a build task done — a new skill written, a config changed, a script authored — the delegation/result contract does not yet exist. What Hermes sends, what format Claude acknowledges, how the result flows back and how state is updated: all undesigned. This is the most significant coordination gap in the current operating model.

**The shared board substrate is also open (OPEN-3).** GitHub Issues vs local Kanban is not decided. The board is the primary stigmergic coordination surface; its write-locking semantics (preventing two agents from racing on the same task) are noted in DESIGN.md §12 as a backlog item.

**"Two brains" framing is superseded but not wrong at the highest level.** The original framing captured the build/operate split correctly. What it got wrong was treating Hermes as a single agent. The correction is: the operate side is a *class* of agents, not one. The split itself stands.

**Model routing (OM-5) is a sibling concern.** The policy (Opus orchestrates, Sonnet executes, Haiku does mechanical work, skills carry their own binding) is locked and referenced throughout this document but detailed in the model routing decisions file, not here. The mechanism — the actual router, enforcement, model config — is its own deep dive (OPEN-6).

---

## Sources

- `~/.cockpit/STATE.md` — "Operating model (locked)" section (primary)
- `~/.cockpit/DECISIONS.md` — OM-1, OM-2, OM-3, OM-4, OM-6 (locked entries)
- `~/.cockpit/memory-engine/DESIGN.md` — §12 (Multi-agent fleet), §3 (The two axes)
- `~/.cockpit/log/2026-06.md` — "2026-06-18 — Cockpit bootstrap" entry (Key decisions, Open/deferred)
