# Copilot instructions for `distributed-files`

## Build, test, and lint commands

Use npm scripts from `package.json`:

- Install dependencies: `npm ci`
- Build TypeScript: `npm run build`
- Run full test suite: `npm test` (runs `vitest run`)
- Run a single test file: `npm test -- tests/status.test.ts`
- Run a single test by name: `npm test -- -t "determineState (glob patterns)"`

Linting:

- `npm run lint` — check for lint/format issues
- `npm run lint:fix` — auto-fix lint/format issues
- `npm run format` — format code

## High-level architecture

`dfiles` is a manifest-driven CLI that pulls selected paths from remote Git repos into local destinations.

- **CLI entrypoint (`src/index.ts`)** wires Commander commands (`init`, `add`, `pull`, `status`, `list`, `remove`) to command modules and centralizes top-level error handling.
- **Manifest system (`src/config.ts`, `src/types.ts`)** defines and validates `dfiles.json` (`version: 1`, `entries[]`). Commands (except `init`) call `requireManifest()`, which discovers the manifest by walking up parent directories.
- **Cache/update layer (`src/cache.ts`)** keeps repo mirrors in `~/.dfiles/cache/<repo-hash>`, where hash is SHA-256 of repo URL (first 16 chars). It uses shallow clone/fetch and recovery paths for stale locks, non-fast-forward pulls, and corrupted caches.
- **Sync layer (`src/sync.ts`)** copies file, directory, or glob sources from cache to destination. File copies are hash-based (`sha256`) so unchanged files are skipped.
- **Pull workflow (`src/commands/pull.ts`)** selects entries, groups by `repo#branch`, updates cache once per group, syncs each entry, then prints a summary and exits non-zero if any entry failed.
- **Status workflow (`src/commands/status.ts`)** is offline-only: it compares current local destinations against cached repo content (including directory hashing and glob-aware comparisons) and reports `current`, `outdated`, or `missing`.

## Key repository conventions

- **Always normalize destination paths with `resolvePath()`** (`src/config.ts`) so `~` expansion and absolute resolution stay consistent.
- **`source` supports file, directory, and glob semantics**; glob sync/status logic is shared via `isGlobPattern()` + `globBase()` (`src/sync.ts`) and treats glob matches as files with preserved relative structure.
- **Manifest writes use `saveManifest()`** (pretty JSON, 2-space indent) rather than ad hoc file writes.
- **Error model is command-level throw + top-level handling**: command modules usually throw `Error`, and `src/index.ts` converts failures into `Error: ...` plus exit code 1.
- **`pull` behavior is intentionally partial-failure tolerant**: failures are tracked per entry, printed in summary rows, and only then converted to process failure if any errors occurred.
- **Tests use Vitest with focused module mocks** (notably `simple-git` and cache functions), and test files are organized by subsystem under `tests/`.

## Must follow workflow

1. Always when implementing a feature or bug fix  always create new tests and update exisiting ones as needed. Tests should cover both typical and edge cases.
2. Always make sure documentation is up to date, including README.md and any relevant comments in the code.