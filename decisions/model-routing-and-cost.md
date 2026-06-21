---
topic: Model routing + cost strategy
decisions: [OM-5, MR-1, TOOL-3]
status: policy locked; mechanism open (OPEN-6)
date: 2026-06-21
---

# Model Routing and Cost Strategy

## TL;DR

Three-tier routing doctrine is locked: Opus orchestrates (inline), Sonnet executes (subagents), Haiku handles mechanical work. Cost follows tier: flat subscription for workhorses, local models for high-volume/offline, OpenRouter only for breadth/fallback. Hardware reality caps local to Gemma 1B–4B. Hermes aux slots have been swapped from DeepSeek (billed via OpenRouter) to `gpt-5.4-mini` on Codex (in-plan). The **policy is live**; the **router mechanism is unbuilt** (OPEN-6).

---

## Context / the problem

Three distinct pressures shaped this:

**Cost at volume.** Metered API calls add up fast when a model does bulk work (research sweeps, file reads, transforms). The right answer differs by tier: flat subscriptions beat metered pricing at sustained volume; local models beat both when the work is high-frequency and the model can handle it. Getting this wrong means either overpaying or under-serving.

**Context hygiene.** The orchestrator (Opus) needs a clean context window. Delegating execution to subagents keeps Opus focused on decisions and synthesis rather than churning through search results or reformatting files.

**Capability per task.** Not every task needs the most capable model. Over-routing to a powerful model is wasteful; under-routing to a weak one produces bad output. The doctrine maps task type to model tier.

---

## The routing doctrine

**OM-5 [Locked 2026-06-19]**

| Tier | Model | Role |
|------|-------|------|
| Orchestrator | Opus | Judgment, planning, synthesis, decisions, conversation — stays inline |
| Execution | Sonnet | Research sweeps, multi-file search, bulk reads, routine edits — subagents |
| Mechanical | Haiku | grep-and-report, formatting, simple transforms, status checks — subagents |

**Mechanism: skill-level model binding.** Each skill carries its own model assignment. There is no runtime router yet — the binding is set at skill definition time (OPEN-6 covers building the actual router).

**Heuristic, not dogma.** The spawn overhead of launching a subagent is real. Trivial edits and tasks that genuinely require Opus-level reasoning stay inline. The doctrine guides default allocation; it does not override common sense in the specific case.

The operating model bullet in STATE.md also makes this explicit: "NOT absolute — trivial edits and Opus-level reasoning stay inline (spawn overhead isn't worth it)."

---

## Cost-tier doctrine

**MR-1 [Locked 2026-06-19]**

Three tiers, in order of preference:

**1. Flat subscription (Claude Max, ChatGPT/Codex plan)**
Primary workhorses live here. At sustained volume, a flat subscription is cheaper than metered API calls. This is where Opus/Sonnet/Haiku (Claude side) and the Hermes primary (`gpt-5.5` via Codex OAuth) live.

**2. Local models (Ollama)**
High-volume, mechanical, offline, or privacy-sensitive work. Truly free, off-meter, no rate limits (beyond hardware), no data leaving the machine. The catch: hardware gates this hard (see below). Not a workhorse substitute — a niche.

**3. OpenRouter — breadth/fallback only**
OpenRouter gives access to a wide model catalog. It is NOT a cost play. Metered pricing on OpenRouter beats subscription only when you need a model you don't otherwise have access to. Using OpenRouter for routine work is strictly worse than subscription. This was user-corrected during the 2026-06-19 pm ingestion session.

---

## Hardware reality

**The gate (checked 2026-06-19):**
- 13 GB RAM, ~3.6 GB free
- RTX 3050, 4 GB VRAM

What this means for local models: small quantized models only. **Gemma 3 1B/4B or Gemma 2 2B (Q4 ≈ 1–3 GB)** fit and run reliably. 9B+ does not fit in VRAM. GPT-OSS-20B, large DeepSeek variants — out of reach on this hardware.

**Practical consequence:** local = a Haiku-class niche on this machine. It can absorb the highest-volume trivial tasks (triage, title generation, session search) if rate limits bite elsewhere. It is not a substitute for Sonnet-tier work. Candidates to benchmark when the router is built: small Gemma (lead), then GPT-OSS/DeepSeek distills if hardware improves.

---

## Hermes aux models

**TOOL-3 [Locked 2026-06-21]**

**What changed:** All 8 Hermes `auxiliary.*` slots (web_extract, compression, approval, mcp, title_generation, triage_specifier, kanban_decomposer, session_search) were previously set to DeepSeek V4 Flash.

**Why DeepSeek is out:** DeepSeek routes through OpenRouter. OpenRouter is metered. "Free" was the assumption; it was wrong. This violates the cost-tier doctrine (OpenRouter = breadth/fallback, not workhorse).

**What replaced it:** `gpt-5.4-mini` on `provider: openai-codex` — in-plan via the ChatGPT/Codex OAuth, no metered cost.

**Why mini fits:** Its 400K context window matches the `gpt-5.5` primary's 400K Codex window, so it can handle compression tasks (compression is one-shot, not iterative). Spark (`gpt-5.3-codex-spark`) was evaluated and rejected: 128K context (too small for compression), Pro-only research preview, broken separate-quota.

**The caveat:** Aux shares the primary's Codex rate-limit window (5h/week). High-frequency background slots (triage, title generation, session search) can throttle the `gpt-5.5` primary. If rate limits bite: offload those slots to local Gemma (4GB-VRAM tier) — free, off-meter, not metered API. NOT to OpenRouter.

Config backup: `~/.hermes/config.yaml.bak.pre-aux-swap`. Verified live with `hermes -z "..." -m gpt-5.4-mini --provider openai-codex` → exit 0.

**Current Hermes model map (post-swap):**
- Main: `gpt-5.5` (OpenAI Codex, in-plan)
- All 8 auxiliary slots: `gpt-5.4-mini` (OpenAI Codex, in-plan)
- Vision: Gemini 2.5 Flash
- Fallback chain: Claude Sonnet 4.5 → GLM 5.1

---

## Beyond cost

Two routing drivers that are not purely about money:

**Cross-family adversarial review.** Using a different model family to review another model's work catches blind spots that same-model self-grading cannot. (A concrete example from research: Codex reviewing Claude output, up to 5 rounds until both sign off.) The router must support dispatching a cross-family reviewer on demand, not just routing for cost/latency. This connects routing to the verify-before-freeze doctrine.

**Re-audit harness on model swap.** A harness (tool restrictions, prompts, rules) tuned for one model can trap or confuse a stronger one — agents break *because the model improved*, not because anything else changed. So every model swap triggered by the router carries a maintenance obligation: the harness must be re-audited after the swap, not just before. Routing is not only forward-selection; it implies an ongoing calibration loop. (Source: Nate B Jones video BOXK2XFLA-E, routed to STATE Model Routing dive 2026-06-19.)

---

## What's still open

**OPEN-6 · Model Routing mechanism [unbuilt]**

The policy (OM-5, MR-1) is live and enforced by convention. The *router itself* — the software mechanism that enforces the policy — has not been built. Its own deep dive is pending.

What the dive must cover:

- **WHERE the router lives** — config/env binding vs proxy vs hook vs skill-level (likely layered). The Claude Code surface uses `.claude/settings.local.json` env-var binding (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, model fields), project-scoped. The Hermes surface uses per-agent/per-skill model binding (already live). One doctrine, two enforcement points.
- **Non-Anthropic models inside Claude Code** — routing mechanical/cheap work to Codex models (via CCR — Claude Code Router — or direct config) instead of Haiku/Sonnet is in scope. "Native Anthropic bindings only" was explicitly rejected as too narrow.
- **WHAT signals drive routing** — task reasoning depth (~80% cheap tier / 10–20% top tier as a rough heuristic), cost budget, context size, latency requirements.
- **GLM 5.2 / Z.ai as cheap-tier candidate** — flagged from video 2OD14-0cot4 as potentially ~5× cheaper than Opus. Numbers are UNVERIFIED (presenter hedges). Parked as a benchmark candidate for the dive, not a decision.
- **Token Optimizer's CLAUDE.md routing-injection** (video bhB57Meachc) — a candidate tool for the Claude Code router mechanism. Evaluate during the dive.

The Hermes side is partially done (aux models live, primary wired). The Claude Code side is the open work.

---

## Sources

| Source | Role |
|--------|------|
| `STATE.md` HEAD — Operating model bullet (line 17) | Routing doctrine, canonical wording |
| `STATE.md` HEAD — Model Routing deep dive pending item (lines 185–196) | Full sub-bullets: re-audit, adversarial review, cost-tier, GLM parked, Hermes live, routing inputs locked |
| `DECISIONS.md` — OM-5 | Routing policy, locked 2026-06-19 |
| `DECISIONS.md` — MR-1 | Cost-tier doctrine + hardware gate, locked 2026-06-19 |
| `DECISIONS.md` — TOOL-3 | Hermes aux swap, locked 2026-06-21 |
| `DECISIONS.md` — OPEN-6 | Router mechanism, unbuilt |
| `log/2026-06.md` — 2026-06-19 pm entry (line 157) | Model Routing elevated; cost-tier doctrine first stated; hardware gate checked |
| `log/2026-06.md` — 2026-06-21 cont entry (lines 26–35) | DeepSeek→gpt-5.4-mini swap, verification, caveat |
