# Contributing to ACCORD

Thank you for your interest in contributing. This project is a [Pi](https://pi.dev/) extension and monorepo; the sections below cover local setup, validation, and how to open a pull request.

## Prerequisites

- [Bun](https://bun.sh/) (runtime and test runner)
- [Pi](https://pi.dev/) if you are exercising `/dev` end-to-end (see [README](README.md#install-pipidev))

## Local setup

```bash
git clone https://github.com/cshirley/accord.git
cd accord
bun install
```

To wire this checkout into Pi for interactive development, see [docs/local-development.md](docs/local-development.md).

## Running checks

Run the full validation suite before opening a PR:

```bash
bun run check
```

Individual steps (useful while iterating):

| Command | What it runs |
| --- | --- |
| `bun test` | Unit and integration tests |
| `bun run check:biome` | Lint and format (Biome) |
| `bun run check:types` | TypeScript (`tsc --noEmit`) |
| `bun run validate:schemas` | JSON schema example validation |
| `bun run validate:assets` | Bundled asset manifest checks |
| `bun run check:bundle` | Bundle smoke build |
| `bun run check:runtime` | Runtime smoke script |

Fix formatting issues with:

```bash
bun run check:biome:fix
```

## Making changes

1. **Fork** the repository and create a branch from `main`.
2. **Keep PRs focused** — one logical change per pull request when possible.
3. **Match existing style** — follow patterns in the code you are editing; Biome enforces most formatting.
4. **Add or update tests** when you change behaviour (not just refactors).
5. **Update docs** when you change user-visible behaviour, CLI commands, schemas, or CI contracts. Start with [docs/accord-workflow.md](docs/accord-workflow.md) if you are unsure where something belongs.
6. **Do not commit secrets** — use `.env.example` / `.env.smoke.example` as templates; real tokens belong in gitignored `.env` files or CI secrets only.

## Pull requests

1. Ensure `bun run check` passes locally.
2. Open a PR against `main` with:
   - A clear summary of **what** changed and **why**
   - Notes on how you tested the change
   - Links to any related issues
3. CI workflows under [`.github/workflows/`](.github/workflows/) must stay green.

## Project layout

- [`src/`](src/) — core harness, `/dev` command, MCP adapter
- [`packages/`](packages/) — Pi extension modules (subagent, worktree, git tools, CI, etc.)
- [`assets/`](assets/) — bundled skills, agents, provider sidecars
- [`schemas/`](schemas/) — JSON schemas for artifacts and agent return packets
- [`docs/`](docs/) — user and contributor documentation
- [`tests/`](tests/) — test suite

See [docs/file-structure.md](docs/file-structure.md) for a fuller map.

## Reporting issues

- **Bugs and feature requests:** [GitHub Issues](https://github.com/cshirley/accord/issues)
- **Security vulnerabilities:** see [SECURITY.md](SECURITY.md) — please do not open public issues for security reports.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
