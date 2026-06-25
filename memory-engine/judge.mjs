// judge.mjs — adapter router; re-exports judge() from the active adapter.
// Default: judge-claude.mjs (Claude Code CLI, subscription-based). Set JUDGE_ADAPTER=hermes to use
// judge-hermes.mjs (Hermes/Codex in-plan OAuth). reconcile.mjs imports from this file unchanged.
const mod = process.env.JUDGE_ADAPTER === 'hermes' ? './judge-hermes.mjs' : './judge-claude.mjs';
const { judge } = await import(mod);
export { judge };
