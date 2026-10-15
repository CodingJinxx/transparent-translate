# Contributing

Thanks for helping. Bug reports with a small, non-private Markdown sample are the most useful contribution.

## Setup

```bash
git clone https://github.com/CodingJinxx/transparent-translate.git
cd transparent-translate
npm install
npm run dev
```

`npm run dev` rebuilds `main.js` on every change. To try it in a vault, either set `OBSIDIAN_PLUGIN_DIR` to `<vault>/.obsidian/plugins/transparent-translate` before running it (each build is copied there), or launch a sandboxed Obsidian that reloads the plugin on every build:

```bash
npx obsidian-launcher watch -p . <path to a test vault>
```

Use a test vault, not your real notes.

## Project layout

```
src/
  core/          Pure logic, no Obsidian imports: blocks, sentences, placeholders,
                 hashing, cache format, prompt, output parsing, language detection,
                 names and glossary (format, matching, term review)
  translator/    OpenAI-compatible client (HTTP injected, so it runs in tests)
  services/      Cache stores, glossary store and translation queues (notes and names)
  views/         Reading view controller, Live Preview (CodeMirror 6) extension,
                 decode animation, file and folder name display (name-display.ts)
  ui/            Settings tab and modals
  obsidian/      Vault backend; internals.ts is the only place that touches
                 non-public API (the "Excluded files" list and the tab header
                 elements used to show translated file names)
  i18n/          English and German strings (same keys, enforced by types)
  main.ts        Plugin lifecycle and wiring
test/
  unit/          Vitest tests for core, translator and services
  e2e/           WebdriverIO tests in a real, sandboxed Obsidian with a mock LLM server
  live/          Optional test against a real endpoint
  fixtures/      Sample notes (byte-exact, some with CRLF line endings)
  vaults/e2e/    The e2e test vault
site/            The showcase website on GitHub Pages (see docs/showcase.md)
```

## Tests

| Command | What it checks |
| --- | --- |
| `npm run check` | Typecheck, ESLint with `eslint-plugin-obsidianmd`, the guideline check, unit tests |
| `npm run test:e2e` | Real Obsidian at `minAppVersion` and latest, plus mobile emulation. Downloads Obsidian into `.obsidian-cache` on first run. `OBSIDIAN_VERSIONS=latest/latest` limits the versions. |
| `npm run test:live` | A real endpoint. Put `{"baseurl": "...", "model": "...", "apikey": "...", "reasoning": ["low"]}` in `.llm_connection_details.json` (git-ignored). The key is never printed. |

The rule every change must keep: **switching languages or translating never changes the note file.** The e2e tests check this byte for byte.

## Plugin guidelines

The plugin is meant for the Obsidian community directory, so these are hard rules (`npm run check:guidelines` enforces most of them):

- No `innerHTML`/`outerHTML`/`insertAdjacentHTML`; build DOM with `createEl` and friends.
- No inline styles; style with classes in `styles.css` and Obsidian's CSS variables.
- No regex lookbehind (breaks on older iOS).
- No Node or Electron APIs (mobile support).
- No default hotkeys, no `console.log` (use `log.debug`), no global `app`.
- Vault files through the Vault API, never the adapter. Open notes are only changed through editor transactions.
- UI text in sentence case. Every new string goes into both `src/i18n/en.ts` and `src/i18n/de.ts`.
- Never commit API keys, private notes or personal data.

## Workflow

`main` is protected: nothing is pushed to it directly. Every change, including releases, goes through a pull request.

1. Branch from `main` (`git switch -c fix/short-name`) and commit there.
2. Run `npm run check` (and `npm run test:e2e` when views or editing change) before you push.
3. Open a pull request. CI must pass: **Check (Node 22.x)**, **Check (Node 24.x)** and **End-to-end (Obsidian)**, and the branch must be up to date with `main`. Open conversations must be resolved.
4. Merge with **Squash and merge** (or enable auto-merge, which waits for the checks). The branch is deleted afterwards.

The end-to-end job drives a real Obsidian and can fail for timing reasons on a slow runner. A failure is a reason to look at the log first; if it is a flaky wait, fix the test (retry the click, wait for the condition) rather than re-running until it is green. **Re-run failed jobs** is fine for a one-off runner problem.

## Releasing

The release is a pull request, then a tag on the merged commit.

1. `git switch -c release/<x.y.z>` from an up-to-date `main`.
2. Move the "Unreleased" entries in `CHANGELOG.md` under a new version heading.
3. Run `npm version <x.y.z> --no-git-tag-version` (no leading `v`). This updates `package.json`, `manifest.json` and `versions.json`. Commit all of them.
4. Open the pull request, wait for CI, merge it.
5. Tag the merge commit and push the tag: `git switch main && git pull && git tag <x.y.z> && git push origin <x.y.z>`.
6. The release workflow checks that the tag matches `manifest.json`, runs all checks, builds, attests the build and creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css`. Review it and publish.

Bump `minAppVersion` in `manifest.json` (and the pinned `obsidian` dev dependency) only when a newer API is actually used.
