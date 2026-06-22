---
topic: Walling — how confidential client data is kept isolated
decisions: [MEM-3, MEM-4, MEM-5, MEM-6, MEM-7]
status: superseded
superseded_by: MEM-23
superseded_date: 2026-06-22
date: 2026-06-19
hardened: 2026-06-19pm
---

# Walling — How Confidential Client Data Is Kept Isolated

> **SUPERSEDED 2026-06-22 → MEM-23.** Intra-graph walling (split substrate, `vault/` dirs, keys-not-prompts, the `substrate` tag) was dropped in favor of **VM-as-trust-boundary**: a confidential client gets its own VM running a clone of the cockpit; the main VM holds only non-confidential work, and confidential data never leaves its VM. Retained for the **threat model + rejected-options reasoning** (still a content goldmine); the per-substrate mechanism documented below is **no longer built**.

## TL;DR

General know-how cross-pollinates freely across the memory graph. Confidential client data is walled from everything else by two independent enforcement halves: the **read side** uses OS file permissions and scoped credentials ("keys not prompts"), never prompt discipline; the **write side** stamps an immutable `substrate` tag at the write-API boundary and the reconciler hard-rejects vault material from the shared graph. Both halves are necessary — neither alone is sufficient. The physical container for confidential data is a per-client local `vault/` that is gitignored and never in any tree with a push remote.

---

## Context / the threat

The cockpit runs a fleet of agents across multiple clients and ventures. The memory system is designed so that general knowledge (techniques, patterns, lessons) can cross-pollinate freely — that is the point of a shared graph. But confidential client data must never cross that boundary.

Two distinct leak surfaces exist:

1. **Cross-client leak** — agent working on client-A reads or writes material belonging to client-B, either via the shared graph or via a subagent that inherited too-broad scope.
2. **Third-party leak** — confidential data reaching a cloud surface (originally NotebookLM/Google was in scope; now irrelevant because the retrieval engine is local — see MEM-15 / TOOL-1). The vault rule still defends the `git push` leak path.

"No-leak" is precisely scoped: it applies to **confidential data**, not to learned knowledge. Treating all knowledge as confidential would defeat the point of a shared memory system. (MEM-3)

---

## The two-halves model

Walling is enforced at two independent points in the stack. Both are needed; each closes what the other cannot.

### Read side — "keys not prompts" (MEM-5)

Access to a client's memory is enforced by **OS file permissions and scoped credentials**, not by asking an agent to behave correctly. An agent bound to client-A simply lacks the path access and API keys to reach client-B's vault. There is nothing for the agent to override or misinterpret — the kernel refuses the open(2) call.

Key properties:
- Scope ("the keys") is **derived from one permission source-of-truth** (shared drive / OAuth). The local scope cache is a read-only mirror of that source. (MEM-7)
- **Lose source access → memories stop pulling automatically.** No manual cleanup required when a client relationship ends.
- **Subagents inherit the parent's reduced scope.** A Haiku plumbing agent spawned inside a client session cannot reach outside that client's wall.

Why prompt discipline was rejected: prompts are instructions, not access controls. An LLM can be confused, jailbroken, or simply hallucinate. Relying on a prompt to say "don't read client-B's vault" provides no real isolation — the path is still traversable. Keys-not-prompts makes the isolation structural rather than behavioral.

### Write side — substrate-provenance tag (MEM-6)

Keys-not-prompts secures reads. It does not prevent a write path from landing vault material in the wrong place. The write side is a separate problem with a separate mechanism.

Every log entry, staging entry, and node receives an **immutable `substrate` tag** — either `shared` or `vault:<scope>` — stamped **at the write-API boundary**, not by agent judgment. The tag travels with the data from that point forward. Then:

- The **reconciler hard-rejects** any vault-tagged entry from the shared graph. Vault material reconciles only into its own vault.
- **Retrieval-engine indexing** (AnythingLLM, local) ingests `substrate=shared` nodes into the shared workspace and `substrate=vault:<scope>` nodes into that scope's isolated workspace only — never commingled.
- **Dreaming and graph traversal** are OS-perm-scoped to their substrate.
- **Cross-substrate promotion is forbidden.** `shared→vault` = read-only lookup at most. `vault→shared` never.

Why the tag must be stamped at the write-API boundary, not by agent judgment: if agents decide the tag, any mistake — confused context, wrong scope variable, a subagent that inherited ambiguous identity — mislabels the entry. Once mislabeled and ingested, vault content is in the shared graph. The boundary stamp removes agent discretion from the security-critical decision.

---

## Options considered for HOW to wall

Three options were evaluated during the memory deep dive (2026-06-19). All three are documented in STATE.md.

### (a) Separate sub-graphs per client

Each client gets its own isolated knowledge graph. No shared graph exists.

**Pro:** strongest isolation; no boundary crossing possible.  
**Con:** traps knowledge. Lessons learned on one client engagement cannot inform another. The entire value proposition of a shared memory system — cross-pollination of technique, pattern, domain insight — is destroyed. An agent working on venture-A cannot benefit from a pattern discovered on project-B.  
**Verdict: rejected.** The cost to knowledge utility is too high.

### (b) Single graph + sensitivity-tag gating

One unified graph. Each node carries a sensitivity tag. Retrieval queries filter by tag at read time.

**Pro:** simplest architecture; no substrate split.  
**Con:** one wrong gate equals a leak. If a node is mislabeled (agent error, reconciler bug, schema migration mistake), confidential content sits in the shared pool permanently. Tag-gating is a runtime filter — it does not prevent the data from being written to the shared store in the first place. The failure mode is silent and undetectable until damage is done.  
**Verdict: rejected.** Relies on perfect labeling; the blast radius of any single error is the entire shared graph.

### (c) Split substrate — shared knowledge graph + per-client local vaults (MEM-4)

Two physically separate stores: a shared knowledge graph (non-confidential cross-scope knowledge) and per-client `vault/` directories (confidential, local-only). The shared graph never receives vault-tagged material by construction; the reconciler enforces this at every write cycle.

**Pro:** isolation is structural. Vault content cannot reach the shared graph even if an agent mislabels something — the reconciler rejects it. Knowledge still cross-pollinates in the shared graph. The two enforcement halves (keys-not-prompts + substrate-provenance) each operate on their respective sides without depending on the other.  
**Con:** more moving parts than (b). Two storage locations to maintain. Path topology is slightly more complex.  
**Verdict: chosen.** This is MEM-4.

---

## The 5 leak paths closed

The adversarial review panel (2026-06-19pm, three-lens Sonnet) identified five concrete write-path leak paths that "keys not prompts" alone did not close. Substrate-provenance closes all five:

1. **Commingled logs.** Without the substrate tag, session logs from a client engagement could be written to the same log pool as shared logs and picked up by the reconciler. The `substrate` tag on every log entry routes it to the correct reconciler target.

2. **Dreaming-pattern leakage.** The dreaming process (overnight cron agent synthesizing logs/transcripts into new nodes) could traverse across substrates and surface patterns derived from vault content into the shared graph. OS-perm-scoping of dreaming to its substrate prevents traversal.

3. **Traversal crossing.** Graph traversal following wikilinks between nodes could walk from a shared node into a vault node and back. OS-perm-scoping of traversal closes this.

4. **Subagent in-context vault content.** A subagent operating in a client session could carry vault content in its context window and then write a "learned insight" to staging without a vault tag. The write-API boundary stamp ensures the tag is applied regardless of what the subagent believed its scope was.

5. **Retrieval-engine cross-substrate contamination.** The retrieval engine (AnythingLLM) ingests nodes into workspaces. Without the substrate tag, a vault node could be indexed into the shared workspace, making it retrievable by any agent. The tag drives separate workspace indexing per substrate.

---

## Permission source-of-truth + vault rule

### Permission source-of-truth invariant (MEM-7)

There is exactly one ground-truth permission source — the shared drive / OAuth layer. The local scope cache is a **read-only mirror** of it, never an authoritative copy. This means:

- Permissions cannot drift out of sync with the real access model.
- Revocation at the source propagates automatically: lose source access to a client → the local mirror stops refreshing → memories stop pulling.
- No separate "local permissions database" that can diverge from reality.

### Vault rule (MEM-13, topology-independent)

A `vault/` is **local-only + gitignored, never inside a tree with a push remote.**

This closes the remaining storage-layer leak path: even if the substrate tag and OS permissions are working correctly, a careless `git push` could exfiltrate vault content to a remote. The gitignore prevents it. Placing vaults under `~/.cockpit/memory/scopes/<scope>/vault/` — inside the centralized memory home, not co-located with individual project repos — ensures the vault tree is under one gitignore we control, not spread across N project repos some of which may push to external remotes (GitHub, etc.).

The three layers reinforce each other: OS perms wall local reads; the substrate tag walls writes; gitignore walls the push path.

---

## Nuances, caveats, and open threads

**context-mode auto-memory walling flag (open — build step).** context-mode maintains a cross-project auto-memory (68 learned preferences, 450 sessions as of 2026-06-21). This is separate from the walling system above and is currently **unscoped** — it can bleed across projects including client contexts. This was identified as a landmine during the retrieval-engine decision session. The locked build flag: **disable or scope-bound context-mode's auto-memory before any client onboarding.** Until then, no confidential client work should proceed. (DECISIONS.md MEM-15, log 2026-06-21 cont 2)

**NotebookLM as a former third-party surface.** The original walling design specifically called out `substrate=shared`-only sync to NotebookLM (client vaults never push to Google). This is now moot: NotebookLM was dropped entirely (TOOL-1, locked 2026-06-21) and the retrieval engine is 100% local (AnythingLLM). The vault wall still holds by construction, but the Google leak path via retrieval is gone.

**Headroom rejected partly on walling grounds.** Headroom was evaluated and rejected as core infra (TOOL-2). One explicit reason: open cross-origin data-disclosure vulnerability (#1227) conflicts directly with the client-data walling guardrail. Third-party tools that touch the memory layer must be clean on this axis.

**"Vault" is not a type — it is confidential cells of a scope.** Early modeling treated "vault" as a third memory type alongside identity/knowledge/log. This was the original modeling error (corrected via Blocker 2 in the adversarial review). Vault is the confidential subset of the per-client scope column in the TYPE × SCOPE grid. Shared knowledge graph = union of all non-confidential knowledge cells. (MEM-2, DESIGN.md §3)

**Cross-substrate promotion.** The rule is asymmetric and absolute: `shared→vault` is permitted as a read-only lookup (an agent in a client context can read shared knowledge). `vault→shared` is never permitted. Promotion of a vault node into the shared graph requires human decision and re-authoring outside the write-API, not a flag flip.

---

## Sources

- `DECISIONS.md` — MEM-3, MEM-4, MEM-5, MEM-6, MEM-7, MEM-13, MEM-15, TOOL-1, TOOL-2
- `STATE.md` — "Knowledge flows, client data is walled"; "HOW to wall — DECIDED: (c) split substrate"; "WALLING enforcement — DECIDED (fork B): keys not prompts"; "Blocker 1 — write-path walling via SUBSTRATE-PROVENANCE"; "Post-completeness-review hardening (adversarial Sonnet panel)"; "Vault rule [LOCKED, topology-independent]"
- `memory/DESIGN.md` — §6 (Walling — read + write)
- `log/2026-06.md` — 2026-06-19 memory deep dive; 2026-06-21 (cont 2) retrieval engine decision + context-mode walling flag
