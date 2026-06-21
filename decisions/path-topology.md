---
topic: path topology — where memory and knowledge physically live on disk
decisions: [MEM-13]
status: locked
date: 2026-06-20
---

# Path Topology

## TL;DR

Three distinct layers, three distinct placement rules: the knowledge graph is one flat pool (`~/.cockpit/memory/knowledge/nodes/`, scope = node frontmatter); the memory substrate is centralized (`~/.cockpit/memory/scopes/<scope>/{identity,log,staging,vault,sources}/`); project nav docs are co-located with the repo. A one-line `CLAUDE.md` pointer bridges the gap — experience feels local, bytes stay central. Vault is always local-only and gitignored, never inside a push-remote tree.

---

## Context / the problem

The system has three kinds of persistent information that need homes on disk:

1. **The knowledge graph** — distilled, wikilinked markdown nodes capturing what the system has learned across all domains.
2. **The memory substrate** — per-scope operational state: identity files, session logs, staging areas, raw-capture sources, and the confidential vault.
3. **Project instruction / nav docs** — `CLAUDE.md`, `AGENTS.md`, any docs a human or agent navigates when working inside a specific repo.

The central question: should any of these live **co-located with the projects they relate to**, or **centralized in a single home** (`~/.cockpit/memory/`)? The instinct for co-location is real — it feels self-contained, keeps related things adjacent, mirrors how codebases organize themselves. But the right answer turns out to differ by layer, and the Agent Zero docs-tree video (NVkRkioBXQc) crystallized exactly why.

---

## The three layers

### 1. Knowledge graph — one flat pool

**Path:** `~/.cockpit/memory/knowledge/nodes/`

All knowledge nodes live in one flat directory regardless of domain. Scope is encoded in each node's frontmatter, not in the folder path. A master-index sits over the pool to enable token-efficient hot-path traversal without re-traversing all nodes on every query. Nodes link to each other via wikilinks (`[[ ]]`), making the graph Obsidian-navigable.

### 2. Memory substrate — centralized

**Path:** `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,vault,sources}/`

All per-scope operational memory lives under one root. Scopes are confidentiality and permission boundaries (e.g., `global`, `personal`, `venture/<name>`, `client/<name>`). Projects nest inside their scope as sub-folders or tags — a new scope exists only when a new wall is needed. The `sources/` subdirectory is the raw-capture layer (verbatim inputs, fully frontmattered and indexed). The `vault/` subdirectory holds confidential material and is always gitignored.

### 3. Project nav docs — co-located with the repo

**Path:** inside each project repo, e.g., `~/projects/<name>/CLAUDE.md`, `~/projects/<name>/AGENTS.md`

These are the navigated-at-path artifacts: files a human or agent reads sequentially while moving through the repo's directory tree. Claude Code auto-loads `CLAUDE.md` from cwd upward; an optional `AGENTS.md` docs-tree (per the Agent Zero pattern) can sit alongside subdirectories. These live in the repo because that is how they are consumed — by path traversal, not by search.

---

## Options considered

### Knowledge pool: flat vs. folder tree

**Option A — Flat pool (chosen):** All nodes in one directory, scope in frontmatter. Cross-domain links are first-class — a node about a framework decision can link directly to a node about a client constraint without either living in the other's folder. The master-index gives fast traversal without a hierarchy.

**Option B — Folder tree (rejected):** Organizing nodes under `domains/<name>/` or `scopes/<scope>/` would embed scope in the filesystem path. The problem: knowledge isn't codebase-shaped. Cross-domain links become awkward — a node truly belongs to multiple domains, so folder placement is arbitrary and traps those links. Graph-not-tree is the right mental model for knowledge; the folder tree fights it.

### Memory substrate: centralized vs. co-located per project

**Option A — Centralized (chosen):** All scope memory under `~/.cockpit/memory/scopes/`. The system is *already forced* to have a central home for the global scope and for the cross-scope knowledge pool — neither can live in any single project repo. Given that a central home must exist, co-locating project substrates would mean *two* memory homes with all the complexity that follows: walling logic spread across every project repo, multiple gitignore files to get right, vault material potentially ending up in repos with push remotes the system does not fully control.

One centralized home gives:
- A single-writer reconciler with a clear, auditable path
- All vaults behind one gitignore in one repo whose remote is controlled
- One-tree backup — a single `rsync` or snapshot covers all memory
- Auditable walling — the boundary between `substrate:shared` and `substrate:vault:<scope>` is enforced in one place

**Option B — Co-located per project (rejected):** Each project repo carries its own `memory/` directory. Feels self-contained but creates the two-homes problem. Memory is hook-written and reconciler-read — it is never navigated on path the way a `CLAUDE.md` is. Co-location's proximity payoff (fast lookup by path) simply does not apply to material that is always retrieved by query. And vault material scattered across N project repos — some of which push to remotes — is a walling nightmare.

---

## The navigated-vs-queried insight

The Agent Zero docs-tree video (NVkRkioBXQc) describes a `AGENTS.md` tree: self-documenting files co-located per folder, consumed by top-down path traversal, updated after each operation. The pattern is elegant — but it applies to *navigated* artifacts, not *queried* ones.

The distinction that forced the clean three-layer split:

- **Navigated artifact:** something you find by walking a path. You know the directory, you open the file. `CLAUDE.md`, `AGENTS.md`, a `README` — you reach these by cd-ing into the right place. Co-location makes sense here because path is the access mechanism.
- **Queried artifact:** something you find by search — semantic similarity, wikilink traversal, or a reconciler scan. Memory logs, knowledge nodes, vault entries — you never cd into `~/.cockpit/memory/scopes/client-x/log/` to manually browse session logs. The agent issues a query; the retrieval engine returns results regardless of path. Path is irrelevant; co-location buys nothing.

Memory is hook-written (agents append to staging on every session stop) and reconciler-read (the reconciler runs distillation on schedule). No human or agent navigates memory by path during normal operation. Therefore the co-location payoff — "related things are adjacent" — does not materialize, and the co-location costs (two homes, distributed walling, uncontrolled remotes) are real.

Project nav docs are the opposite: they are navigated by path, auto-loaded from cwd, read sequentially. For these, co-location is exactly right.

---

## Decision & why

**MEM-13 [Locked 2026-06-20]** establishes four rules:

1. **Knowledge graph = one flat pool.** `~/.cockpit/memory/knowledge/nodes/`, scope in frontmatter, master-index over the pool. Graph-not-tree because knowledge has cross-domain links that a folder hierarchy would trap.

2. **Memory substrate = centralized.** `~/.cockpit/memory/scopes/<scope>/{identity,log,staging,vault,sources}/`. Centralized because the system already requires a central home (global scope + cross-scope pool), co-location would create two homes, and memory is queried not navigated so co-location yields no benefit.

3. **Co-located experience, centralized storage.** Each project's `CLAUDE.md` carries exactly one line pointing to its scope: `Memory scope → ~/.cockpit/memory/scopes/<scope>/`. The agent working inside the project immediately knows where its memory lives; the bytes stay in the one safe, gitignored, controlled home. This honors the self-contained instinct without the two-homes cost.

4. **Project nav docs co-located with the repo.** `CLAUDE.md` (auto-loaded cwd→root by Claude Code) and optional `AGENTS.md` docs-tree live in the repo. These are navigated artifacts — their access mechanism is path, so co-location is correct.

---

## Nuances and caveats

### The co-located-pointer mechanism

The one-line pointer in `CLAUDE.md` (`Memory scope → ~/.cockpit/memory/scopes/<scope>/`) is the bridge between the local experience and the centralized storage. It is not a symlink, not a config file, not a runtime lookup — it is a plain text line in the file Claude Code already auto-loads. Zero new mechanism required. The agent reads its `CLAUDE.md`, knows its scope path, and all further memory operations use that path.

### Scope definition

Scope = a confidentiality and permission boundary. Examples: `global` (public/shared, no wall), `personal` (personal data, personal wall), `venture/boringscale` (venture-scoped), `client/acme` (client-confidential). Projects nest inside scopes — a new scope is created only when a new wall is needed, not for organizational convenience. This prevents scope proliferation and keeps the `scopes/` directory manageable.

### Vault rule (topology-independent)

The vault rule is locked independently of the topology decision: a `vault/` directory is **local-only and gitignored, never inside a directory tree that has a push remote**. Three enforcement layers: OS file permissions wall local reads, the `substrate` tag (stamped at the write-API boundary, not by agent judgment) walls reconciler writes, and `.gitignore` walls the `git push` leak path. This rule would hold under any topology.

### Sources subdirectory

`sources/` lives beside `vault/` in each scope: `~/.cockpit/memory/scopes/<scope>/sources/`. It is the raw-capture layer — verbatim inputs (transcripts, repo snapshots, docs, pastes) that are fully frontmattered and search-indexed. Public content (`substrate:shared`) routes to `scopes/global/sources/`; confidential content routes to the relevant scope's `vault/sources/`. Sources are never invisible: everything autosaves, nothing requires a manual save step.

---

## Sources

- `~/.cockpit/STATE.md` (HEAD) — "PATH TOPOLOGY — DECIDED (2026-06-20, after grey-area pass + video NVkRkioBXQc)" section
- `~/.cockpit/log/2026-06.md` — "2026-06-20 (night) — `hermes update` verified + grey areas closed; memory topology DECIDED"
- `~/.cockpit/DECISIONS.md` — MEM-13 (Path topology, Locked 2026-06-20)
- `~/.cockpit/memory/DESIGN.md` — §4 (Storage & ownership)
- Video NVkRkioBXQc — Agent Zero docs framework; source of the navigated-vs-queried insight
