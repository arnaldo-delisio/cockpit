---
name: session-handoff
description: Create a compact, reusable next-session handoff for Hermes, Claude Code, or the human before /new, /clear, model switch, brain switch, or a long/tool-heavy session reset. Use when Arnaldo asks for a handoff prompt, next-session prompt, context reset summary, or asks what to tell Hermes/Claude next.
version: 1.0.0
model: sonnet
triggers: [handoff, session handoff, next session prompt, context reset, prepare next session, what should I tell claude, what should I tell hermes, before clear, before new]
tags: [handoff, context-hygiene, session-reset, coordination, prompt]
allowed-tools: Bash Read Grep
metadata:
  hermes:
    tags: [handoff, context-hygiene, coordination]
    platforms: [linux, macos]
---

## Purpose

Produce a **manual handoff packet** that lets Arnaldo restart context cleanly or move work between
Hermes and Claude Code without losing operational truth. This skill standardizes the ritual Arnaldo
already does by asking both brains for prompts: summarize what happened, what is locked, what is next,
and what must not be redone.

This is context hygiene, not memory writing. It does **not** edit the graph, run the reconciler, or
claim durable memory. The handoff is a user-facing prompt/packet that can be pasted into a fresh
session, `/new`, `/clear`, another model, Hermes, or Claude Code.

## When to Use

Use when any of these are true:

- Arnaldo asks for a "handoff", "next session prompt", "prompt for Claude", or "prompt for Hermes".
- The session is long, tool-heavy, multi-topic, or starting to risk context rot.
- Work is complete and the next unit should begin in a fresh session.
- Work is incomplete and another brain/session must continue safely.
- A commit/push, verification run, generated artifact, or runtime state needs to be preserved in the handoff.

Do **not** use for:

- A normal short status answer where no context reset or brain switch is likely.
- Hiding uncertainty. If something is unverified, say so plainly.
- Creating canonical memory nodes or editing docs. This skill outputs a handoff; docs/memory updates are separate tasks.

## Procedure

1. **Identify the target.** Decide whether the user needs:
   - `short-summary` — 2–3 sentences for the human;
   - `next-session-prompt` — paste-ready prompt for a fresh session;
   - `claude-prompt` — builder-oriented prompt with repo/files/tests;
   - `hermes-prompt` — operator-oriented prompt with orchestration/status/next actions.
   If the target is obvious from the user's wording, do not ask.

2. **Gather live state when tools are available.** For repo work, check real state before writing the handoff:
   - `git status --short --branch`
   - `git log --oneline -3`
   - relevant generated artifact paths, ignored/tracked status, and verification output already run.
   Do not invent commit SHAs, test results, pushed status, or file contents.

3. **Separate committed truth from runtime state.** Explicitly distinguish:
   - committed and pushed files;
   - modified but uncommitted files;
   - ignored/generated runtime outputs;
   - docs updated vs docs still stale;
   - submitted/external side effects vs merely prepared artifacts.

4. **Write the handoff packet using the template below.** Keep it compact but complete. Prefer bullets over prose.

5. **End with an exact pickup instruction.** The next agent should know what to do first, what not to redo,
   and what verification gates matter.

## Handoff Template

```markdown
# Session Handoff — <scope/project> — <date>

## Target
For: <Hermes | Claude Code | either | human>
Mode: <short-summary | next-session-prompt | claude-prompt | hermes-prompt>

## Goal
<What this session was trying to accomplish.>

## Current State
- Done: <facts only>
- Not done: <facts only>
- Current repo/path/branch: `<path>` / `<branch>`
- Latest commit/push: `<sha> <message>` or `not committed`

## Locked Decisions
- <Decision that should not be re-litigated next session.>

## Files / Artifacts Touched
- Tracked: `<path>` — <what changed>
- Runtime/ignored: `<path>` — <what exists, ignored/not committed>

## Verification Actually Run
- `<command>` → <real result>
- `<command>` → <real result>

## Open Questions / Blockers
- <Unknowns or blockers. Say `none` if none.>

## Risks / Unverified Claims
- <Anything not verified. Say `none known` only if true.>

## Do Not Redo / Do Not Touch
- <Avoid duplicate work, unsafe scope, or out-of-scope areas.>

## Exact Pickup Instruction
<One paragraph/prompt the next agent can follow immediately.>
```

## Claude Code Prompt Shape

Use this when handing from Hermes/operator into Claude Code/builder:

```markdown
You are Claude Code working in `<repo path>` on branch `<branch>`.

Read first:
- `<state/doc file>`
- `<relevant source files>`

Committed state:
- Latest pushed commit: `<sha> <message>`
- What it did: <brief>

Runtime/generated state:
- `<ignored artifact path>` exists but is not tracked.

Next task:
<Precise build/debug/doc task.>

Constraints:
- Do not redo <completed work>.
- Do not touch <out-of-scope area>.
- Do not fabricate <claims/artifacts>.

Verification required:
- `<command>`
- `<command>`
```

## Hermes Prompt Shape

Use this when handing into Hermes/operator:

```markdown
You are Hermes operating in `<scope/project>`.

Current state:
- <committed truth>
- <runtime truth>
- <docs state>

Next operation:
<What to orchestrate, inspect, run, or verify.>

Guardrails:
- <side-effect limits>
- <what requires human approval>
- <what not to automate yet>

Evidence to gather before reporting done:
- `<command/path/check>`
```

## Rules

1. **Truth over continuity.** A handoff must preserve what is real, not make the next session feel smoother.
2. **Committed ≠ generated.** Always separate git-tracked state from ignored runtime artifacts.
3. **Done ≠ submitted.** Never imply external action occurred unless there is evidence.
4. **Verification is evidence.** Include actual commands/results, not "should pass" or "likely works".
5. **Unverified stays unverified.** If the current session did not inspect or test something, label it.
6. **Do not dump raw logs.** Compress tool output to the facts the next agent needs; include paths/commands for re-checking.
7. **No stale task resurrection.** The exact pickup instruction must reflect the latest user request, not old context.
8. **Respect brain roles.** Claude prompts should be builder-oriented; Hermes prompts should be operator/orchestration-oriented.
9. **One next unit.** A good handoff narrows the next session to one coherent unit, not a giant backlog.
10. **Stop after handoff unless asked to act.** If the user asked for a handoff, deliver the packet; do not start the next task.

## Quality Checklist

Before finalizing, verify the handoff answers:

- [ ] What was the goal?
- [ ] What is actually done?
- [ ] What remains undone?
- [ ] What commit/branch/status is real?
- [ ] Which artifacts are ignored/generated vs tracked?
- [ ] What verification actually ran?
- [ ] What must not be redone?
- [ ] What should the next agent do first?
- [ ] Are all unverified claims labeled?
