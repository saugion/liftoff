# Stack commands

Detect by manifest, then fill build/test/lint/format/run in module AGENTS.md and
CONSTRAINTS.md. Prefer scripts the project already defines (package.json `scripts`, Gradle tasks, Makefile) over these defaults.
Mark any command you did not run as `(unverified)`.

| Detect | Build | Test | Lint / format | Run |
|---|---|---|---|---|
| `build.gradle(.kts)` (Quarkus/Spring) | `./gradlew build` | `./gradlew test` | `./gradlew spotlessApply` if spotless plugin | `./gradlew quarkusDev` / `bootRun` |
| `pom.xml` | `mvn package` | `mvn test` | `mvn spotless:apply` if plugin | `mvn quarkus:dev` / `spring-boot:run` |
| `package.json` + pnpm-lock | `pnpm build` | `pnpm test` | `pnpm lint` | `pnpm dev` |
| `package.json` + package-lock | `npm run build` | `npm test` | `npm run lint` | `npm run dev` |
| `package.json` + yarn.lock | `yarn build` | `yarn test` | `yarn lint` | `yarn dev` |
| `pyproject.toml` | `uv build` / `pip install -e .` | `pytest` | `ruff check` + `ruff format` | per project |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo clippy` + `cargo fmt` | `cargo run` |
| `go.mod` | `go build ./...` | `go test ./...` | `go vet ./...` + `gofmt -l .` | `go run .` |
| `capacitor.config.*` | `npx cap sync` after web build | (web tests) | n/a | `npx cap run ios` or `npx cap run android` |
| `playwright.config.*` | n/a | `npx playwright test` | n/a | n/a |
| `.maestro/` or `maestro/` | n/a | `maestro test <flow>` | n/a | n/a |

Monorepo: record commands per module path (`pnpm --filter <pkg> ...`, `./gradlew :backend:<m>:test`).
