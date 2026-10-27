---
name: publish-design-system
description: "This skill should be used when the user asks to \"publish\", \"deploy Storybook\", \"push to GitHub\", \"share the design system\", \"put it online\". Reviews everything since the last publish, runs the checks and tests, writes a complete DESIGN.md per brand, pushes the saved versions to GitHub and deploys Storybook to GitHub Pages through the Plinth MCP tools."
version: 0.4.0
---

# Publish a design system

The user can also press **Publish** in the UI, which runs the same steps with a progress view and Claude's review.
Use the tool when they ask in the chat.

## 1. Saved, reviewed, checked

- Publishing pushes saved versions. If `status` shows unsaved changes, ask the user to save them (or save them with
  `save_version` when they tell you to, with the message they give).
- Review: `review_changes` lists everything since the last publish. Read it with `get_guidelines` and tell the user,
  in a few sentences, anything that contradicts the guidelines or a role's purpose. Suggestions only; the user decides.
- `run_checks`. Broken token references stop publishing; so do components without component tokens or a story, or
  with hardcoded values (GitHub's `plinth check` would refuse to deploy them). Explain each in plain words and fix it
  with a change. Contrast and look-alike findings are reminders; the user may accept one as an exception in Checks.

## 2. Dry run

`publish` with `dryRun: true`. This writes `exports/<brand>/DESIGN.md` (complete files in Google's DESIGN.md format,
for other AI tools), commits them, and runs the tests (typecheck + stories) when dependencies are installed. Show the
lint result per brand and the test summary.

## 3. Publish

Ask before the first push: it creates a repository on the user's GitHub account. Confirm the `owner/name` and
visibility (default private).

`publish` with `repo` (first time only) and `visibility`.

| Result | What to tell the user |
|---|---|
| `published: true` | Sent to GitHub, not online yet: GitHub runs the checks and tests on Linux and deploys only if they pass. Call `deploy_status` and report what it says; do not call it published until it is `live` |
| `stoppedAt: "unsaved"` | There are unsaved changes; the user saves them as a version (or discards them), then publish again |
| `stoppedAt: "checks"` | What `blocking` lists (broken references, component format); fix them with changes, save, then publish again |
| `stoppedAt: "tests"` | Which tests failed; fix the component (create-component skill), then publish again |
| `stoppedAt: "github"`, sign-in expired or missing | Run `gh auth login --web` and finish in the browser, then ask to publish again. Local work is safe. |
| `gh` not installed | Install from https://cli.github.com, then sign in as above |
| `deploy_status`: `failed` | Nothing new went online. Name the step and the failing tests; fix the cause (a test can pass here and fail on GitHub, e.g. checking visibility during a fade-in: wait for it), the user saves and publishes again |
| Pages step failed | In the repository settings, set Pages → Source to "GitHub Actions"; the next push deploys |

## Rules

- Never force-push or rewrite history.
- A repository that already has a remote is pushed as-is; `repo` is ignored.
