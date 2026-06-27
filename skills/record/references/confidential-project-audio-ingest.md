# Confidential project audio ingest pattern

Use when a meeting/audio file belongs to a project that is intentionally absent from Cockpit scopes (for example a repo that must not enter the shared memory graph).

Pattern:
1. Try the requested project scope with `record.py ingest` only if the user explicitly named it.
2. If `record.py` refuses because the scope is unknown, use a registered scope only as a temporary transcription bridge.
3. Immediately copy the resulting `.opus` audio and transcript source into the project's gitignored local artifact area.
4. Rewrite transcript frontmatter to point at the project-local audio path and project scope.
5. Delete the temporary Cockpit-scope audio/transcript copies.
6. Verify:
   - project artifact directory is ignored by git,
   - project-local audio/transcript/note exist and are non-empty,
   - temporary shared-scope copies no longer exist.
7. Report the workaround plainly, with final real paths.

Transcript cleanup:
- If the transcript includes unrelated tail/ambient conversation after the meeting ended, trim the transcript at the user-approved boundary.
- Remove any meeting-note caveat that says the unrelated tail remains.
- Verify with a content search for representative removed phrases.

Do not create durable memory nodes from the transcript; leave it as a source artifact only.