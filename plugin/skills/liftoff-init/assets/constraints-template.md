# CONSTRAINTS — {{PROJECT_NAME}}

Quality bar. Agents must meet it and must not weaken it. Changing a value here needs the user's explicit approval.

| Dimension | Threshold | Check |
|---|---|---|
| Build | green | {{BUILD_CMD}} |
| Tests | all pass; new public behavior has a test | {{TEST_CMD}} |
| Lint/format | zero errors | {{LINT_CMD}} |
| Coverage | {{COVERAGE_TARGET}} on changed code | {{COVERAGE_CMD}} |
| Security | no secrets in repo; inputs validated at trust boundaries | code review |

## Banned shortcuts

- New `@ts-ignore`, `eslint-disable`, `@SuppressWarnings` or equivalents without a written reason
- Skipping, deleting or weakening tests or assertions to get green
- Unimplemented stubs or TODO-returns shipped as done
- Lowering a threshold in this file
