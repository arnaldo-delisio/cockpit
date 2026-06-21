---
topic: Headroom — evaluation as a candidate for the cockpit memory/context stack
decisions: [TOOL-2]
related: [MEM-10, MEM-15]
status: rejected as core infra; `headroom learn` parked as a candidate
date: 2026-06-21
---

# Evaluating Headroom (`chopratejas/headroom`)

## TL;DR

Headroom is a context-compression proxy + memory + transcript-learning bundle for LLM coding agents. Colleagues use it in production, which earned it a real evaluation (four deep-dive research passes over the actual source). Verdict: **do not adopt it as core infra** — its proxy/compression and memory-as-store-of-record collide with our hard client-data walling guardrail and override two locked decisions (MEM-10 owned-markdown spine, context-mode-stays). **One piece is worth keeping in view:** `headroom learn` (an offline, off-critical-path transcript miner) as a candidate for the future self-evolving-CLAUDE.md / feedback-mining slot.

## Context / Why we looked

A colleague signal ("people use it, it could replace a lot of our stack") is a strong prior — it touches **five** areas of our design at once: context-mode (hygiene/compression), AnythingLLM (retrieval, MEM-15), the reconciler/owned-markdown spine (store of record, MEM-10), the parked self-evolving-CLAUDE.md / feedback-mining ideas, and the parked RTK/token-opt tools (TOOL-5). So a fair, deep look was warranted rather than a quick dismissal.

**Honesty note (worth keeping — it's good content about how to evaluate).** My *first* pass was too dismissive and leaned on the README. The deep dive corrected real errors in that pass:

| First-pass claim | Reality (verified in source) |
|---|---|
| "Memory is opaque, no walling, one flat store" | Wrong — per-project *physical* DB isolation (fail-closed when no project signal; they fixed cross-project bleed in issue #462) + a USER→SESSION→AGENT→TURN scope hierarchy. |
| "Not a store of record, opaque" | Wrong — SQLite, user-owned, documented schema, `export/import/supersede/delete` CLI. Portable. |
| "Basically keyword like context-mode" | Wrong — vector (sqlite-vec/hnswlib) + FTS5 BM25 + entity graph, local embeddings via `all-MiniLM-L6-v2` ONNX (the *same* embedder we picked for AnythingLLM). |
| "`learn --apply` auto-writes, no gate" | Unfair — default is dry-run; `--apply` is explicit opt-in and prints the full proposed content first. |

The lesson: read the source before judging, and steelman a tool colleagues actually rely on.

## What Headroom actually is

It's really three tools bundled behind one CLI, all local-to-the-machine:

1. **Compression proxy** — `headroom proxy` (OpenAI-compatible) or `headroom wrap claude`. Sits in the request critical path and compresses context before it leaves the machine. Pipeline: ContentRouter → SmartCrusher (JSON, lossy + statistical) / CodeCompressor (AST, tree-sitter) / Kompress-v2-base (ModernBERT+LoRA, ~149M, local ONNX) → CCR (reversible: stores originals locally, model calls `headroom_retrieve`). Plus **CacheAligner** (preserves provider KV-cache prefixes). Bundles **RTK** for shell-output rewriting.
2. **Memory subsystem** (`--memory`) — SQLite + sqlite-vec + FTS5 + entity graph, local `all-MiniLM-L6-v2` ONNX embeddings, per-project isolation, supersession lineage, export/import.
3. **`headroom learn`** — offline transcript miner: reads `~/.claude/projects/**`, `~/.codex/**`, `~/.gemini/**`, one LLM call produces structured recommendations, writes marker-delimited blocks into CLAUDE.md/MEMORY.md. Dry-run by default.

License Apache-2.0, Python, pre-1.0 (v0.26.0 at eval).

## Scorecard — by component

**Compression proxy → could replace context-mode hygiene.**
*Pros:* genuinely good engineering — semantic ML compression, AST-aware code handling, CacheAligner is a real KV-cache cost lever; self-reported 73–92% token reductions with accuracy held on small evals (GSM8K unchanged, BFCL 97%).
*Cons / why no:* it sits in the **request critical path**, and that path carries (a) an **open high-severity cross-origin data-disclosure vuln** (CORS `allow_origins=["*"]` + missing loopback guard on `/v1/retrieve/*` → any webpage open in your browser can exfiltrate cached **original** tool outputs + file contents while the proxy runs); (b) an open data-loss bug (unrecoverable CCR markers, #1006); (c) AST compression emitting **invalid syntax on ~28% of files** (#1233); (d) silent proxy-bypass (#951). Failures are silent no-ops — the worst kind. context-mode is installed, proven (450 sessions, 88% reduction), and not in the request path. Swapping it fails minimalism rung 1 and "don't refactor what isn't broken."

**Memory subsystem → could replace the AnythingLLM slot.**
*Pros:* validates our direction — it independently landed on the **same local embedder** we chose; scoping/supersession/export model is a good reference for our reconciler's node lifecycle.
*Cons / why no:* its store of record is **SQLite rows**, whereas our most-locked decision (MEM-10) is **owned wikilinked markdown + git** as the brain, engine swappable on top. Headroom inverts that (DB *is* the brain) — adopting it would abandon the markdown-graph spine, the git-as-undo/reconciler model, and portability. And it's activated via the same risky proxy. Good reference, not a drop-in.

**`headroom learn` → could serve self-evolving-CLAUDE.md / feedback-mining.**
*Pros:* the one genuinely attractive, low-risk piece — runs **offline, off the critical path**, dry-run by default, uses our own API key, **no telemetry in that path**, writes standard CLAUDE.md/MEMORY.md with marker blocks, carries prior sections forward. Maps almost exactly onto our parked self-evolving-CLAUDE.md design (mine sessions → propose → human gate).
*Caveat:* still reads **all** projects' transcripts by default (a cross-project read we'd want scoped/walled); re-check the security posture before use.

## The security/posture argument (the durable disqualifier)

The single in-flight CVE isn't the point — *posture* is. Headroom shipped **opt-out telemetry by default** (#1223), CORS `*` + credentials on data endpoints, missing loopback guards, and silent data-loss modes. That's an immature security posture, and for anything that touches **walled client data** (our hard guardrail: confidential client data never reaches a third party), immature posture is disqualifying regardless of any one patch. A proxy that caches original file/tool content and currently leaks it cross-origin is exactly the leak our walls exist to prevent (see decisions/walling.md).

## Adoption reality (discount the halo, not the tool)

Both are true: **PyPI ~660k downloads/month = a real user base** (can't be faked the way stars can), so colleagues liking it is legitimate — for *general* coding it's a reasonable token-saver. But the **~44k GitHub stars are almost certainly inflated** (266 stars/day for 165 days; 0.31% watcher-to-star ratio; same-minute burst clustering) — so don't lean on the popularity signal. Solo maintainer (Netflix engineer), bus-factor 1, pre-1.0 with ~2 releases/day, `ENTERPRISE.md` present (could go paid). Our constraint is simply stricter than the median user's.

## Decision & what we salvaged

- **Reject** the proxy/compression and memory-as-store-of-record. Fails walling; overrides MEM-10 + the context-mode-stays decision (MEM-15); pre-1.0 with an open data-leak.
- **Keep** context-mode for hygiene; **keep** AnythingLLM-over-owned-markdown (Headroom *validates* it).
- **Park** `headroom learn` as a candidate to evaluate when we build the self-evolving-CLAUDE.md / feedback-mining slot (see STATE → CLAUDE.md orchestration dive). Re-check the CORS/telemetry status and run it scoped.

## Nuances / open threads

- Convergence, not a fork: Headroom independently validating the `all-MiniLM-L6-v2` ONNX local-embedder choice is a confidence signal for MEM-15.
- If `headroom learn` is adopted later, it must be walled (it reads cross-project transcripts) and its `--apply` gated through our "agent reports, human decides" doctrine (it already defaults to dry-run, which fits).

## Sources

- Four parallel deep-research passes over the actual repo source + docs (`headroom-docs.vercel.app`) + `gh` issue/release/star data, run 2026-06-21 in this build session: (1) memory subsystem, (2) compression + cache, (3) `learn` + telemetry, (4) operational reality/adoption.
- Cross-referenced against our own guardrails (client-data walling), MEM-10, MEM-15, TOOL-1.
