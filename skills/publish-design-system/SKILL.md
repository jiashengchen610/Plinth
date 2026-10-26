---
name: publish-design-system
description: "This skill should be used when the user asks to \"publish\", \"deploy Storybook\", \"push to GitHub\", \"share the design system\", \"put it online\". Runs the quality gate, writes a complete DESIGN.md per brand, pushes to GitHub and deploys Storybook to GitHub Pages through the Plinth MCP tools."
version: 0.1.0
---

# Publish a design system

## 1. Gate

`run_checks`. If the gate fails, stop: explain each failure in plain words and propose fixes
(`propose_contrast_fixes` for contrast). Do not publish around a failing gate.

## 2. Dry run

`publish` with `dryRun: true`. This writes `exports/<brand>/DESIGN.md` (complete files in Google's DESIGN.md format,
for other AI tools) and commits them. Show the lint result per brand.

## 3. Publish

Ask before the first push: it creates a repository on the user's GitHub account. Confirm the `owner/name` and
visibility (default private).

`publish` with `repo` (first time only) and `visibility`.

| Result | What to tell the user |
|---|---|
| `published: true` | The GitHub link and the Storybook link; Storybook is live a few minutes after the push (GitHub Actions) |
| `stoppedAt: "github"`, sign-in expired or missing | Run `gh auth login --web` and finish in the browser, then ask to publish again. Local work is safe. |
| `gh` not installed | Install from https://cli.github.com, then sign in as above |
| Pages step failed | In the repository settings, set Pages → Source to "GitHub Actions"; the next push deploys |

## Rules

- Never force-push or rewrite history.
- A repository that already has a remote is pushed as-is; `repo` is ignored.
