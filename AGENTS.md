# Notes for coding agents

Read [CONTRIBUTING.md](CONTRIBUTING.md) first; its "Plugin guidelines" section is binding.

- Keep `src/core` free of `obsidian` imports so it stays unit-testable.
- The note file must never change because of a mode switch or a translation. Changes to the note only come from the user typing or confirming an edit session, through CodeMirror transactions.
- `_Translations/` (or the configured cache folder) is generated cache. Do not edit it by hand and do not treat it as user notes.
- `.llm_connection_details.json` holds a real API key. It is git-ignored. Never print, read into context, copy or commit it; load it only from code at runtime (see `test/live`).
- Run `npm run check` before committing, and `npm run test:e2e` when views or editing change.
- New UI strings go into both `src/i18n/en.ts` and `src/i18n/de.ts`.
