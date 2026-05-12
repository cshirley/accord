# Project configuration

Lives in the project's `AGENTS.md` under the compatibility heading `## Dev Harness` as a fenced JSON block. Created by `/dev init`:

1. Detects stack from marker files (`go.mod`, `Cargo.toml`, `package.json`, etc.)
2. Infers commands from project config (`package.json` scripts, `pyproject.toml` tool sections, Makefile targets)
3. Falls back to `assets/lang-profiles/<lang>.json` for gaps
4. User confirms, then writes

The block is validated against `schemas/accord-schema.json`. See [`docs/extending.md`](extending.md) for how to add custom providers in this same JSON block.

## Supported stacks

| Language | Marker | Test | Type check | Lint |
|----------|--------|------|------------|------|
| TypeScript/JS | `package.json` | vitest, jest, mocha | tsc | eslint, biome |
| Go | `go.mod` | go test | go vet | golangci-lint |
| Rust | `Cargo.toml` | cargo test | cargo check | clippy |
| Python | `pyproject.toml` | pytest | mypy, pyright | ruff, flake8 |
| Ruby | `Gemfile` | rspec, rake test | — | rubocop |
| Java | `pom.xml` / `build.gradle` | mvn/gradle test | — | checkstyle |
| C#/.NET | `*.csproj` / `*.sln` | dotnet test | dotnet build | dotnet format |

Makefile targets (`test`, `lint`, `check`, `fmt`) override language defaults.
