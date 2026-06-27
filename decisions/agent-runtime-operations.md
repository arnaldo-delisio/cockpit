---
topic: Agent runtime operations — making agents operable, not just functional
decisions: [AR-1]
status: locked
date: 2026-06-27
---

# Agent Runtime Operations

## TL;DR

An agent is not production-ready because it can complete a task once. A durable agent or workflow is production-ready only when it can be operated: its access is bounded, its actions are logged, its behavior is observable, its context and memory rules are explicit, failures escalate, and execution can be verified.

This is a runtime operations doctrine. It is separate from Cockpit's memory layer: memory governs cross-session knowledge; runtime operations govern live agent behavior.

---

## Context

The Cox Automotive / AWS AgentCore case study made explicit a pattern Cockpit already points toward: the hard part is not only building useful agents, but running them with enterprise discipline. Cox emphasized observability, logging, role-based access, memory/context, security/governance, and standard execution patterns as the foundation that allowed many agentic solutions to move into production.

Cockpit should absorb the principle without copying AWS-specific infrastructure. The invariant is vendor-neutral: autonomous or recurring agents need an operating contract.

---

## Decision

Cockpit treats durable agents and workflows as operational systems, not demos.

Any recurring, customer-facing, or materially autonomous agent/workflow should define:

1. **Access boundary** — what systems, files, credentials, APIs, and data it may access.
2. **Role / permission model** — what it may read, write, send, delete, approve, or escalate.
3. **Logs and audit trail** — what actions, inputs, outputs, decisions, and tool calls are recorded.
4. **Observability** — how the operator can see status, progress, failures, drift, costs, and stuck work.
5. **Memory/context policy** — what persists across runs, what is ephemeral, what is forbidden, and where context is stored.
6. **Human approval and escalation** — where judgment, risk, external side effects, or ambiguity require a person.
7. **Standard execution pattern** — repeatable invocation, idempotency expectations, retry behavior, timeout/failure handling, and verification evidence.
8. **Verification contract** — what evidence proves the run succeeded: artifact, log, test, source check, external status, or explicit unverified caveat.

This doctrine does not require all agents to have heavy infrastructure. Small one-off agents can remain lightweight. The trigger is durability/risk: if an agent repeats, touches external systems, handles sensitive/customer data, or can affect money/reputation/operations, it needs an operations contract proportional to the risk.

---

## Placement in Cockpit

This belongs beside the Workflows / board / Hermes↔Claude handoff seams, not inside `memory-engine/DESIGN.md`.

- The memory layer already has its own operational contract: staging, single-writer reconciler, provenance, git, recall, and projection.
- The runtime layer still needs a future spec: how live agents are invoked, monitored, permissioned, retried, escalated, and verified.
- The shared board should eventually expose agent status and evidence, not just task names.
- Skills can carry lightweight local contracts when they are the running artifact; workflows should carry richer contracts when they orchestrate multiple agents or external side effects.

---

## Why

Agents fail differently from ordinary scripts. A script usually has a clear input, deterministic code path, and simple exit status. An agent may reason, call tools, branch, remember, delegate, and act on external systems. That makes live operation the trust boundary: access, logs, visibility, context, and escalation are as important as the prompt.

This also prevents a recurring trap: celebrating that an agent can perform the happy path once while ignoring whether it can be trusted repeatedly.

---

## Relationship to existing Cockpit doctrine

- **OM-1 / no master agent:** this does not create a conductor. It defines per-agent operational contracts while coordination remains stigmergic through memory, board, and human.
- **MEM-8/9 / single writer:** memory remains governed by staging + reconciler. Runtime operations must not give agents direct canonical-memory write access.
- **MEM-23 / VM boundary:** confidential client runtime still requires a separate VM. Runtime permissions inside a VM do not replace the VM trust boundary.
- **MEM-30 / ambient recall:** recall supplies context; it is not authorization. Access control and external side effects remain runtime responsibilities.
- **OPEN-3/4 / board + handoff:** this doctrine should shape those future designs.

---

## Rejected alternatives

**Bake this into the memory layer.** Rejected because memory and runtime operations are different systems. `memory-engine/DESIGN.md` should stay focused on capture, reconcile, retrieval, and projection.

**Copy AWS AgentCore as the architecture.** Rejected. AWS validates the pattern, not the vendor. Cockpit should keep its local-first, clone-clean, subscription/tool-agnostic stance.

**Require heavy ops for every agent.** Rejected. One-off research or local drafting agents should stay lightweight. The contract scales with risk and recurrence.

---

## Sources

- Cox Automotive / AWS case study capture: `~/.cockpit/memory/scopes/boringscale/sources/2026-06-27__aws-cox-auto-agentcore-case-study.md`
- Cox Automotive AWS video transcript: `~/.cockpit/memory/scopes/boringscale/sources/2026-06-27-cox-automotive-uses-agentic-ai-to-transform-automotive-exper.md`
- `~/.cockpit/DECISIONS.md` — OM-1, MEM-8/9, MEM-23, MEM-30, OPEN-3, OPEN-4
- `~/.cockpit/memory-engine/DESIGN.md` — memory layer operational contract
