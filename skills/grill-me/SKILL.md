---
name: grill-me
description: Active knowledge elicitation — interview the human one question at a time to pull tacit knowledge that no log or doc contains into a scope's identity/knowledge layer. Use to fill an empty/thin scope (e.g. a new venture, content, job-search), or when the human says "grill me", "interview me", or "fill the <scope> identity".
version: 1.0.0
model: opus
triggers: [grill me, grill-me, interview me, elicit, fill the identity, fill the scope]
tags: [elicitation, identity, knowledge, ingestion, interview]
allowed-tools: Bash Read Write Edit
metadata:
  hermes:
    tags: [elicitation, identity, interview]
    platforms: [linux, macos]
---

## Purpose
Pull **tacit** knowledge *out of the human* — the things no session log, source, or doc ever recorded —
into a scope's identity/knowledge layer, by relentless **one-question-at-a-time** interviewing. This is the
one input path for knowledge that capture can never observe (DESIGN §8 mode 3).

**Single-writer (MEM-8/9):** grill-me NEVER writes canonical nodes. It writes ONLY to the scope's
`staging/`, through the shared `capture()` pipeline (`grill.mjs flush`). The reconciler stays the sole
graph writer and distills the staging into discovery nodes — exactly like any other capture.

## Inputs
- **scope** (required arg) — a real, live scope (`boringscale`, `content`, `job-search`, `cockpit`, …).
  Targets the empty/thin identity stubs. Refuse an unmapped/fake scope (scope-gating, MEM-14).

## Procedure
1. **Look first — never ask what the graph already knows.** Before the interview, and again whenever you
   open a new topic, run the helper and read the output:
   ```
   node ~/.cockpit/skills/grill-me/grill.mjs look --scope <scope> ["topic"]
   ```
   - No topic → it prints the scope's current nodes (by centrality) so you see what already exists.
   - With a topic → it prints the semantically-closest known nodes + any scope docs that mention it.
   Treat everything it returns as **answered** — do not re-ask it. Ask only the gaps.
2. **Open a checkpoint** (resume anchor) and append to it after *every* answer, so a long interview
   survives interruption:
   `~/.cockpit/memory/scopes/<scope>/staging/.grill/<session>.md`
   (the `.grill/` dot-dir is ignored by the reconciler — it only flushes via step 5). Pick a stable
   `<session>` anchor once, e.g. `grill-<scope>-YYYYMMDD`. Seed it with the format in **Checkpoint format**
   below. If a checkpoint for this scope already exists, READ it and resume — don't restart.
3. **Interview — one question at a time.** Strictly one question per turn; wait for the answer before the
   next. Each question:
   - **Recommend an answer.** Don't ask open-ended into the void — propose your best guess / a default and
     let the human confirm, correct, or replace it ("My read is X — right?"). This is faster and surfaces
     disagreement.
   - **Go where the value is**: identity/mission, who the scope serves, voice, durable preferences,
     non-obvious constraints, decisions-not-yet-written. Follow the thread; drill into vague answers.
   - If the human **can't answer**, record it as an **open-flag** (step 4) and move on — don't stall.
4. **Checkpoint each answer immediately.** Append the Q and the human's answer to the checkpoint in the
   format below. A "couldn't answer" becomes `**A:** [open-flag] <what's unresolved / why>` and ALSO goes
   under the `## Open flags` section. Open-flags are the deliberate human-facing output (MEM-28): they are
   NOT staged as knowledge, but the reconciler sweeps the `## Open flags` section into its
   `pending-review/open-flags-<scope>.md` escalation queue on the next run (resolve one by deleting its
   bullet from the checkpoint — the next reconcile drops it from the queue).
5. **Flush to staging** (periodically for safety, and at the end). Idempotent — re-running only appends new
   pairs (capture's cursor):
   ```
   node ~/.cockpit/skills/grill-me/grill.mjs flush --scope <scope> --session <anchor> \
        --checkpoint ~/.cockpit/memory/scopes/<scope>/staging/.grill/<session>.md
   ```
   (Add `--brain hermes` when Hermes runs it; default is `claude`. `--dry-run` previews with zero writes.)
6. **Report, then STOP (reviewer-gated).** Summarize: the checkpoint path, the staging file written, and
   the **open-flags list** inline. Do NOT run the reconciler yourself — say that the nightly dreaming pass
   (or a human-run `node ~/.cockpit/memory-engine/reconcile.mjs --scope <scope>`) will mint the discovery
   nodes from the staging. The human reviews before anything becomes canonical.

## Checkpoint format
```markdown
# grill-me — <scope> — <date>
session: <anchor>

## <topic / Q1>
**Q:** <the question you asked>
**A:** <the human's answer>

## <topic / Q2>
**Q:** <question>
**A:** [open-flag] <what the human couldn't resolve>

## Open flags
- <flag 1 — restate the unresolved question>
- <flag 2>
```
`flush` stages every `**Q:** / **A:**` pair whose answer is real knowledge; it skips `[open-flag]` answers.

## Rules
1. **Staging only.** Never write to `knowledge/nodes/` or any canonical file. The reconciler is the sole
   graph writer (MEM-8/9). Your only writes: the checkpoint + `grill.mjs flush` (→ staging).
2. **Real scope only.** Interview into a live scope (MEM-14); refuse unmapped/fabricated scopes.
3. **Look before you ask.** Run `look` and skip anything the graph or scope docs already answer.
4. **One question per turn.** No multi-part question dumps. Recommend an answer; don't interrogate.
5. **Checkpoint as you go.** Append after every answer — the interview must be resumable mid-flight.
6. **Open-flags are human-facing, not knowledge.** Record gaps; never stage them as facts.
7. **Confidential data is VM-walled (MEM-23).** The main cockpit is non-confidential only. Do NOT elicit a
   customer's real operational/confidential data into a main-cockpit scope — that's the trigger to stand up
   that customer's VM clone, not to capture here.
8. **Don't run the reconciler.** Elicit → stage → report → stop. Minting nodes is the reconciler's job.
