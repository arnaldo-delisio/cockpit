---
topic: Codex inside Claude Code — plugin vs MCP, for research & delegated subtasks
decisions: [TOOL-7]
status: locked (direction); adoption gated on a 30-min trial
date: 2026-06-22
relates: [OPEN-6]
---

# Codex as an integration inside Claude Code

> Scope: Codex evaluated **only as an integration inside Claude Code** (the orchestrator), not as a standalone CLI workflow. Compared **OpenAI's official `codex-plugin-cc`** vs **Codex-as-MCP**. Decision trail for TOOL-7. Doubles as content raw material.

## TL;DR

Add the **official plugin (`codex-plugin-cc`)** now, scoped to **codebase research + cross-family adversarial review** — *not* web research. It's the lowest-setup, official, footgun-free way to get real signal, and a different-model-family second opinion is the real value-add over Claude reviewing its own work. Defer the **MCP route** (and when adopting it, prefer the **official `codex mcp-server`** built-in over community wrappers) until *autonomous* delegation becomes a concrete workflow need (OPEN-6's cross-family dispatch). Adoption is gated on a 30-minute trial.

## Load-bearing shared facts (both options inherit these)

- **Both shell out to the same locally-installed `@openai/codex` CLI**, using whatever auth it has. We already have ChatGPT/Codex OAuth (TOOL-3) → auth is sorted, but **both share the same ChatGPT/Codex rate window Hermes already draws on** (starvation risk under load).
- **Web/external research is OFF by default and config-dependent.** Codex's built-in web tool hits a *pre-cached* index (stale-ish); live fetch needs `--search` / `web_search="live"`, and subprocess network is blocked unless `[sandbox_workspace_write] network_access = true` in `~/.codex/config.toml`. → **Codex is for code, not the web.** Native Claude WebSearch/WebFetch + context-mode `ctx_fetch_and_index` already do web better and keep raw bytes out of context.
- **"codex-as-mcp" is not one project.** There's an *official built-in* — `codex mcp-server`, a subcommand of the Codex CLI (no third-party code, exposes `codex()` / `codex-reply()`) — plus community wrappers (`tuannvm/codex-mcp-server`, 6 tools incl. a `websearch` tool, ~490★; `cexll/codex-mcp-server`, ~176★). Prefer the official built-in for safety posture.

## Dimension comparison

| Dimension | `codex-plugin-cc` (official plugin) | Codex-as-MCP (official `codex mcp-server`) |
|---|---|---|
| Setup | Lowest: `/plugin marketplace add openai/codex-plugin-cc` → install → `/codex:setup` (auto-installs CLI). No config files. | Manual MCP registration to `codex mcp-server` stdio; real tuning (timeout, sandbox) in `~/.codex/config.toml`. |
| Ergonomics | Human types slash commands: `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`. Built-in job mgmt (`--background`, `/codex:status/result/cancel`). | Claude calls it as a normal MCP tool **autonomously** in its loop. `codex()` / `codex-reply()` (session continuation). |
| Controllability | Coarse. `/codex:rescue` *is* agent-drivable (routes through the Agent tool) + takes `--model/--effort/--cwd`; but review cmds are human-only, and **sandbox/approval are config-file-only, not per-call.** | Fine-grained **per-call**: prompt, model, reasoning effort, sandbox mode, approval policy, cwd on every invocation. |
| Repo-local research (core need) | Strong. `read-only` sandbox = read+grep+analyze, no writes — right for tracing/bug-investigation. Review cmds read-only by design. | Strong, same engine; plus explicit per-call `sandboxMode: read-only`. |
| External/web research | Weak by default, config-dependent (see shared facts). Plugin exposes no flag for it. | Same default-off constraint; `tuannvm` adds a `websearch` tool but still needs `network_access=true`. |
| Safety / sandbox / approval | Safe official defaults (`workspace-write` + `on-request`; review read-only). No footguns shipped. | **Headless risk:** `on-request` **deadlocks** (no terminal to confirm) → must use `never`/`on-failure`. Community wrappers document global `danger-full-access`+`approval=never` as the "fix" — a real footgun. Official `mcp-server` is cleaner. |
| Background / parallel | First-class: `--background` + job tracking is the headline feature. | Parallel calls work but are long-running blocking; MCP RPC **timeout** risk on big tasks (`MCP_TOOL_TIMEOUT` workaround in wrappers). No job dashboard. |
| Failure modes | Auth expiry; shared-rate-window exhaustion (silent); sandbox network-off breaks `curl`/`npm i`; **plugin↔CLI version drift** (already had breakage); young repo (243 open issues). | Approval deadlock if misconfigured; long-task timeout kills; auth/rate same; **community-wrapper drift** (stdout parsing) — official `mcp-server` avoids that class. |

## The real tradeoff

- **Plugin = integrated commands/workflows.** Human-ergonomics + curated, officially-maintained workflows (esp. `adversarial-review`) with background-job plumbing. Coarse-grained; no per-call sandbox control. Optimizes for *"I want Codex's take on this, run it in the background."*
- **MCP = callable delegated worker.** Claude itself delegates a scoped task mid-reasoning, per-call sandbox/model/effort, composable in agent loops/workflows. Cost: you own the headless-safety config (`approval=never/on-failure`) + timeout tuning. Optimizes for *"the orchestrator delegates autonomously."*
- One line: **plugin puts Codex behind *your* keystrokes; MCP puts Codex behind *Claude's* tool-use.**

## What each can do that the other can't

- **Only plugin:** curated `/codex:adversarial-review` + `/codex:review` as one-shot workflows; built-in background job lifecycle; official maintenance (lower drift).
- **Only MCP:** autonomous invocation by Claude (no human in loop, composable in workflows); per-call sandbox/approval/model/effort granularity; stateful multi-turn via `codex-reply()`/`sessionId` without a human resuming.

## Recommendation

- **Quick trial → the plugin.** Simplest setup that yields signal; no headless-approval footgun.
- **Long-term → official `codex mcp-server` as MCP**, *only if/when* autonomous delegation is a real workflow need (OPEN-6). Premature until then.
- **Both vs skip:** complementary, not redundant — but for now **run the plugin, skip the MCP**, adopt the official MCP later. **Skip the community MCP wrappers** unless the official one lacks something specific (they add drift + the `danger-full-access` footgun).

### Codebase vs broad web (explicit)
- **Codebase research: yes, strong** — repo investigation / implementation tracing / bug investigation in `read-only`; cross-family second opinion is the value-add.
- **Broad web research: no** — network off by default, pre-cached/stale unless config-overridden, and duplicates better native capability. **External-research quality is explicitly config-dependent; not worth it.**

## 30-minute trial plan

1. **(5m)** Confirm CLI + auth: `codex login status` (OAuth via TOOL-3). If missing: `npm i -g @openai/codex`.
2. **(3m)** Install: `/plugin marketplace add openai/codex-plugin-cc` → `/plugin install codex@openai-codex` → `/reload-plugins` → `/codex:setup`.
3. **(7m)** Repo-local trace on a real bug: `/codex:rescue --model gpt-5.4-mini "trace how X flows through this repo and where Y breaks"`. Judge vs Claude doing it natively.
4. **(7m)** Cross-family review: make a small change, `/codex:adversarial-review` the diff. Did it catch something Claude wouldn't?
5. **(5m)** Background ergonomics: `/codex:review --background` → `/codex:status` → `/codex:result`.
6. **(3m)** Verdict: keep only if step 3 *or* 4 gave signal Claude alone didn't. Do **not** test web research.

## Stop / red flags

- Codex calls fail/hang silently, or Hermes's Codex quota gets starved → shared rate-window exhaustion.
- Plugin commands error with `thread/name/set` / "unsupported" → plugin↔CLI version drift.
- Rescue tasks fail opaquely on `curl`/`npm i`/network → default network-off sandbox; don't paper over with global `danger-full-access`.
- adversarial-review/rescue just restates Claude's own conclusion → no cross-family value; drop it.
- **Any prompt to set `danger-full-access` + `approval=never` globally** (the community-MCP "fix") → hard stop, machine-wide footgun.
- Editing `config.toml` to make Codex browse → stop, use native web tools.

## Sources

- Official plugin: github.com/openai/codex-plugin-cc (OpenAI-official, v1.0.4, ~21k★, created 2026-03-30); community announcement (community.openai.com, 2026-03-30).
- MCP: developers.openai.com/codex/mcp (`codex mcp-server` built-in: `codex()`/`codex-reply()`); github.com/tuannvm/codex-mcp-server (~490★, 6 tools); github.com/cexll/codex-mcp-server (~176★).
- Codex behavior: developers.openai.com/codex/concepts/sandboxing · /agent-approvals-security · /cli/features · /cli/reference (sandbox modes read-only/workspace-write/danger-full-access; approval untrusted/on-request/on-failure/never; web search pre-cached default, network off in workspace-write).
- Two research subagents, this session (2026-06-22), verified against the above; UNVERIFIED items flagged in their briefs (exact web-tool×sandbox interaction; whether plugin rescue spawns parallel subagents; Claude Code MCP host timeout override).
