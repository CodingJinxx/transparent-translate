---
name: handle-prs
description: Review and merge the open pull requests of this repository once their required checks have passed. Use when asked to handle, triage, review or merge PRs, or after opening a PR of your own and its CI has finished.
---

# Handle pull requests

`main` is protected (see "Workflow" in CONTRIBUTING.md): changes land only through squash-merged pull requests whose required checks passed, **Check (Node 22.x)**, **Check (Node 24.x)** and **End-to-end (Obsidian)**, with the branch up to date. The maintainer has allowed Claude to review and merge pull requests **whose checks are complete**. Everything outside that stays with the maintainer.

Use the `gh` CLI. Never use `--admin`, never change or bypass the branch protection, never force-push, never merge a PR whose required checks are failing, pending or missing.

## 1. List what is open

```sh
gh pr list --state open --json number,title,author,isDraft,headRefName,mergeable,mergeStateStatus,reviewDecision \
  --jq '.[] | "#\(.number) \(.title) [\(.author.login)] draft=\(.isDraft) \(.mergeStateStatus)"'
```

Skip drafts. Handle one PR at a time, oldest first.

## 2. Check the status

```sh
gh pr checks <n>
```

- All three required checks **pass**: continue.
- **Pending**: wait with `gh pr checks <n> --watch --interval 20`. Do not merge on pending checks (do not enable auto-merge unless the maintainer asked for it).
- **Failing**: do not merge. Read the cause with `gh run view <run-id> --log-failed`.
  - A flaky end-to-end step (a timing wait, one click that did not land): fix the test on a branch, as CONTRIBUTING.md asks. Re-running the failed jobs once is fine for a one-off runner problem; if the same test fails again, treat it as a real failure.
  - A real failure in someone else's PR: leave a comment with the failing step and stop.
- `mergeStateStatus` **BEHIND**: run `gh pr update-branch <n>`, then wait for the checks again (the branch must be up to date). **DIRTY** / conflicting: report it, do not resolve conflicts in other people's branches without being asked.

## 3. Review the diff

```sh
gh pr view <n> --json title,body,files,commits
gh pr diff <n>
```

Read the whole diff and check:

- It does what the title and description say, and nothing else.
- **No secrets or private data:** API keys, tokens, `.llm_connection_details.json`, personal notes, real names or emails, vault content. Scan the diff, for example `gh pr diff <n> | grep -iE "api[_-]?key|secret|token|bearer|sk-[a-z0-9]{10,}"`, and look at every new fixture.
- **Plugin guidelines** (CONTRIBUTING.md, "Plugin guidelines"): no `innerHTML`/`outerHTML`, no inline styles (classes in `styles.css`), no regex lookbehind, no default hotkeys, no telemetry or extra network calls, Vault API instead of the adapter, no new non-public Obsidian API outside `src/obsidian/internals.ts`.
- `src/core` has no `obsidian` imports. The note file only changes through editor transactions.
- New UI strings are in both `src/i18n/en.ts` and `src/i18n/de.ts`; user-facing changes have a line under "Unreleased" in `CHANGELOG.md`; behaviour changes have tests.
- Workflow, `package.json`, lockfile or `manifest.json` changes are expected for this PR. A release PR changes only the changelog, `package.json`, `package-lock.json`, `manifest.json` and `versions.json`, and the version matches in all of them.
- **Dependabot PRs:** patch and minor bumps with passing checks may be merged. Skim the release notes of major bumps and merge only if the checks pass and the notes show nothing relevant (renamed config, dropped Node versions, changed test APIs); otherwise report the PR and leave it open.
- A PR from a fork, or one that touches `.github/workflows`, gets extra care: read every changed workflow line, look for new triggers, permissions or secrets, and do not merge if anything is unclear.

If something is wrong, comment on the PR with what to change (`gh pr review <n> --request-changes --body "..."` for other people's PRs) and do not merge.

## 4. Leave a review comment and merge

Write a short summary of what you checked, then merge:

```sh
gh pr review <n> --comment --body "Reviewed the full diff: <scope>. <what was checked>. Required checks passed on this commit."
gh pr merge <n> --squash --delete-branch
```

(GitHub does not allow approving your own PR; a comment is the review record.) Squash is the only merge method enabled. Keep the PR title as the commit title; it should read like a commit message.

## 5. Afterwards

```sh
git switch main && git pull --prune
```

If the merged PR was a **release PR** and the maintainer asked for a release, tag the merge commit as described under "Releasing" in CONTRIBUTING.md (`git tag <x.y.z> && git push origin <x.y.z>`), wait for the release workflow's draft release, and publish it with `gh release edit <x.y.z> --draft=false --latest` only when asked to. Do not tag on your own initiative.

## 6. Report

End with a short table: PR number, title, outcome (merged / waiting for checks / needs changes / left for the maintainer) and the reason for everything that was not merged.
