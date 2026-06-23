---
topic: open-sourcing the cockpit — designing for it from the start, publishing later
decisions: [OSS-1]
status: locked (intent + structural split); publish deferred
relates: [MEM-23, MEM-10, MEM-25, DOC-1]
date: 2026-06-23
---

# Open-Sourcing the Cockpit

## TL;DR

The cockpit is built to be open-sourceable **from day one** — but published **only after a
polish pass**, not now. The operative move now is a clean **public/private boundary**: the
*system* (engine code, specs, decisions, skills) is public-ready; the *data* (identity, logs,
distilled knowledge) is private and gitignored from the public history. This costs almost
nothing because it's the **same clone-clean discipline MEM-23 already requires** for VM
isolation — open-source-readiness rides along for free.

---

## Context / why this came up

The git-boundary question for memory ("same repo vs separate repo for the reconciler's commits")
surfaced a bigger one: **is the cockpit going to be public?** If yes, the boundary between the
reusable *system* and the personal *data* is real and must hold *now* — you cannot retroactively
scrub private data out of a git history that's already public. So the decision had to be made
before laying memory's git posture in Phase 1, even though publishing itself is deferred.

---

## The boundary

| | Public (the system) | Private (the data) |
|---|---|---|
| **What** | engine code (`engine/`), `engine/DESIGN.md`, `DECISIONS.md`, `decisions/`, `skills/`, `bootstrap.mjs`, the shell skeletons | `memory/scopes/` (identity, logs, staging, sources), `memory/knowledge/` (nodes, INDEX) |
| **Nature** | reusable architecture + reasoning — the thing others would clone | personal/operational content — only meaningful to this operator |
| **Git** | the public cockpit repo | gitignored from public; private versioning finalized at OSS-polish |

**Undecided, deliberately:** `STATE.md` and `log/` sit in the grey zone — they're system-shaped
(roadmap, narrative) but carry venture lists and personal strategy. Disposition (sanitize / public
mirror / keep private) is an OSS-polish decision, not a now decision.

---

## Why it's nearly free: clone-clean does double duty

MEM-23 already mandates the cockpit stay **clone-clean** — no hardcoded absolute paths, secrets out
of the tree, deps pinned, no single-VM assumptions — so a confidential client's VM clone is
isolation-by-construction. That exact discipline is also what open-source-readiness requires. The
only *added* work for open-source is **drawing the public/private data line** (one `.gitignore`
block) and, later, the publish polish. The structural cost was already being paid.

`bootstrap.mjs` becomes the source of truth for the data-tree shape: it recreates the (gitignored)
`scopes/`/`knowledge/` tree on a clone, so the public repo ships the *system* and the *recipe for
the tree*, never the data. Clone → run bootstrap → empty, correct substrate.

---

## Why open-sourcing is a career play (not vanity)

`job-search` and `content` are both live scopes — this is directly on the income path.

1. **Reasoning-as-portfolio.** For senior/staff AI-engineering roles, the scarcest hiring signal is
   *demonstrated judgment on hard systems problems*. The `decisions/` files literally are that —
   single-writer reconciler, hybrid retrieval, VM-isolated multi-tenancy, the supersede-in-place
   decision lineage. That outperforms a resume bullet or a LeetCode score.
2. **Build-in-public flywheel.** `content` is live and the build *is* the content. DOC-1 already
   specifies that `decisions/` files are written to double as content raw material — publishing +
   write-ups compound an audience off work already being done.
3. **AI-search visibility (GEO).** The operator runs GEO agents; a public, cited repo builds the
   operator's name presence in exactly the AI-search surfaces those agents optimize for.
4. **Inbound.** Notable agent infrastructure pulls collaborators, talks, and warm inbound — higher
   leverage than cold applications.

---

## Risks + how they're controlled

| Risk | Control |
|---|---|
| Private data / secrets leak into public history | **Structural, not discipline:** gitignore the data dirs now; secrets already gitignored (`.env`); secret-scan at publish. The boundary is enforced by `.gitignore`, so a careless `git add -A` can't leak it. |
| Confidential client data exposure | Out of scope by construction — confidential work lives in a separate VM (MEM-23 / CLAUDE.md guardrail); the public repo is the non-confidential cockpit only. |
| Over-exposing personal strategy (STATE/log) | Deferred grey-zone call; default-private until the OSS-polish disposition decision. |
| Public-quality maintenance burden | Accepted as a forcing function; polish is a deliberate pre-publish pass, not continuous pressure. |

---

## What's deferred to OSS-polish (before publishing)

- The **private data repo** + the reconciler's two-phase-commit git target (MEM-9/MEM-10) — stood
  up at Phase 3, when the first nodes exist and need a versioned home.
- **STATE.md / `log/` disposition** — sanitize, public-mirror, or keep private.
- License choice, a public-facing README, example/seed data so a cloner has something to run, and a
  full secret-scan of history before the first push.

---

## Sources

- This build session, 2026-06-23 — the memory git-boundary question surfaced the open-source intent;
  user chose to design for it now and polish/publish later.
- Builds on: MEM-23 (clone-clean / VM isolation), MEM-10 (owned-markdown + git), DOC-1 (decisions as
  content material), MEM-25 (reconciler = the data repo's committer).
