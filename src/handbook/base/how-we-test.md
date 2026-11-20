---
title: How we test
type: convention
updated: 2026-11-20
summary: "The team's own testing conventions: commands, layers and what must never be skipped, to be filled in by the team."
status: stub
---

This page is not filled in yet. Agents ignore it while `status: stub` is in the front matter. Answer each question below, remove
`_TBD_`, and take `status: stub` out of the front matter in the same merge request.

## Commands
- How do we run the whole test suite? `_TBD_`
- How do we run the tests of one module, and one test? `_TBD_`
- Which commands do the lint, the type check and the build run, and in what order? `_TBD_`

## Layers
- Which kinds of test do we have (unit, integration, end to end) and where do they live? `_TBD_`
- What belongs in each layer, and what must never be only in the slowest one? `_TBD_`
- How do we handle databases, queues and external services in tests? `_TBD_`

## What must never be skipped
- Which tests must pass before a merge request is opened? `_TBD_`
- Are there changes that need a manual check, and who does it? `_TBD_`
- What is our rule on a flaky test: who fixes it and by when? `_TBD_`

## Evidence
- What proof of a passing run does a merge request carry (a pasted run, a CI link)? `_TBD_`
