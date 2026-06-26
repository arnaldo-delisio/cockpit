# Agentic engineering / Google AI-SDLC video — Cockpit mapping

Source session: YouTube transcript captured with `watch` from `https://www.youtube.com/watch?v=zbmuiaPuiNM`.
Saved transcript path in that session: `/home/arn/.cockpit/memory/scopes/cockpit/sources/2026-06-26-google-just-dropped-a-masterclass-on-agentic-engineering-its.md`.

## Condensed takeaways
- AI mostly compresses implementation; requirements/specification and validation remain bottlenecks.
- AI coding is a spectrum: vibe coding → structured AI-assisted coding → agentic engineering.
- The harness matters more than the model: rules, context, tools, hooks, workflows, tests/evals, observability, and guardrails compound reliability.
- Agentic engineering usually means plan artifact first, then a separate coding/build session to reduce context rot and planning bias.
- Verification gates distinguish agentic engineering from vibe coding: tests, CI, evals, LLM judges, separate code review, and human review where stakes warrant it.
- When an agent failure happens, improve the harness that allowed it, not just the immediate output.
- Keep static context lean; push specialized knowledge into dynamic skills/workflows/RAG.
- Token economics favor harness investment: higher upfront cost, lower repeated iteration/token burn.

## Cockpit mapping pattern
When summarizing a workflow/doctrine video for Cockpit, do not stop at generic takeaways. Ground any proposed “memory-worthy rule” against live Cockpit mechanisms before calling it new:

1. Already-built mechanism?
   - Capture salience and corrections: capture hooks + MEM-22.
   - Durable behavior promotion: reconciler feedback/identity nodes + MEM-20 projection into CLAUDE.md/SOUL.md.
   - Examples of harness lessons already projected: absolute hook paths, dry-run-first, verify-before-freezing.
2. Partial/open gap?
   - Skills/workflows/tools/evals/hooks do not self-update from memory yet. DECISIONS OPEN-10 tracks “Harness auto-upgrade from failures.”
   - Workflow layer / shared board / handoff seams may still be open depending on STATE.
3. Net-new lesson?
   - Only present a rule as new if it is not already represented by docs, projected rules, or open decisions.

Recommended answer shape after reading such a transcript:
- `Saved: <path>`
- `Key takeaways: ...`
- `Cockpit relevance: already done / partial gap / new candidate`
- If asked “is this already done?”, answer with that split, not a binary yes/no unless the evidence is clean.
