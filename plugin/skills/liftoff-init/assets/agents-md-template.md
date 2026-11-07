# AGENTS.md — {{PROJECT_NAME}}

> Instructions for AI coding agents on this project, whichever agent you use (Claude Code, GitHub Copilot, ...).
> Read this file first. `CLAUDE.md` and `.github/copilot-instructions.md` only point here: edit this file, not them.

## Overview

| Field | Value |
|---|---|
| Project | {{PROJECT_NAME}} |
| Purpose | {{PURPOSE}} |

## Modules

{{MODULE_TABLE}}

Before working under a module's path, read that module's `AGENTS.md`. Some tools load only this root file, so
anything that applies to every task is written under "Rules that always apply" below, not only in a module file.

## Commands

{{COMMANDS_TABLE}}

## Rules that always apply

<!-- Rules every agent must follow on every task. Keep them here, not only in a module file. -->

- Never commit secrets. `.env*` files are off limits.
- Do not weaken the quality bar in `{{CONSTRAINTS_FILE}}` to get a task done: no skipped or deleted tests, no new
  suppressions, no lowered thresholds without the user's explicit approval.
{{EXTRA_RULES}}

## Quality bar

See `{{CONSTRAINTS_FILE}}`.

## Conventions

- Branches: `feat/`, `fix/`, `chore/`, `docs/`
- Commits: Conventional Commits
- PRs: small, under ~400 changed lines

## Key paths

| Path | Purpose |
|---|---|
| `AGENTS.md` | this file |
| `{{CONSTRAINTS_FILE}}` | quality bar |
{{EXTRA_PATHS}}

## Agent files

{{AGENT_FILES_LIST}}

These files only point to this one. Do not add project context to them; edit this file.
