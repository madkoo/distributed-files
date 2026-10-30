# dfiles

Track and sync specific files or directories from remote Git repositories into local destinations.

## Why / Motivation

Keeping dotfiles, skills, and small config files in sync across machines is annoying when they live in different repositories. Cloning entire repos just to copy one file is noisy and hard to maintain. `dfiles` gives you a simple manifest-driven workflow to pull only what you need, where you need it.

## Install

### Prerequisites

- Node.js >= 16.7.0
- Git

### Install from this repository

Build the CLI before installing it globally from a checkout:

```bash
npm ci
npm run build
npm install -g .
```

### Install the published package

```bash
npm install -g @madkoo/dfiles
```

Global npm executables use npm's global bin directory:

- macOS and Linux: `<prefix>/bin`
- Windows: `<prefix>`

`npm prefix -g` prints `<prefix>`. Add the matching directory to your `PATH` (`Path` on
Windows) if it is not already there. Open a new terminal after you change it.

Run `dfiles init --global` once to create a shared manifest at `~/.dfiles/dfiles.json`.
Commands that use a manifest (`add`, `pull`, `status`, `list`, and `remove`) search the
current directory and its parents first. If they find no local manifest, they use the
global manifest. This lets you run these commands from any working directory. A local
manifest takes precedence. `init` and `upgrade` do not need an existing manifest.

## Quick start

1. Initialize a manifest:

```bash
dfiles init
```

2. Add a tracked entry:

```bash
dfiles add https://github.com/org1/repo1 skills/canvas-design/SKILL.md ~/.claude/skills/canvas-design/SKILL.md --branch main --id canvas-design-skill
```

3. Pull latest content from remotes:

```bash
dfiles pull
```

4. Check local sync state:

```bash
dfiles status
```

## Commands reference

| Command | Description | Options / Arguments |
| --- | --- | --- |
| `dfiles init [directory] [--global]` | Create a project manifest (default) or the shared global manifest. | `directory` (optional), `--global` |
| `dfiles add <repo> <source> <destination>` | Add a tracked file or directory from a remote repository. | `--branch <branch>` (default: `main`), `--id <id>` |
| `dfiles pull [ids...]` | Fetch updates from remotes and sync tracked entries (all by default). | `ids...` (optional), `--dry-run` |
| `dfiles status` | Offline status check against cached state (`current`, `outdated`, `missing`). | none |
| `dfiles upgrade` | Install the latest published version of dfiles globally. | none |
| `dfiles list` | List tracked entries. | `--json` |
| `dfiles remove <id>` | Remove a tracked entry from the manifest. | `id` (required) |

## The manifest file

`dfiles` stores tracked entries in `dfiles.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "canvas-design-skill",
      "repo": "https://github.com/org1/repo1",
      "branch": "main",
      "source": "skills/canvas-design/SKILL.md",
      "destination": "~/.claude/skills/canvas-design/SKILL.md"
    },
    {
      "id": "deploy-workflow",
      "repo": "https://github.com/org2/repo2",
      "branch": "feature-branch",
      "source": "workflows/deploy.yml",
      "destination": "~/.local/workflows/deploy.yml"
    }
  ]
}
```

Notes:
- `id` is how you target specific entries (for example with `dfiles pull <id>` or `dfiles remove <id>`).
- `source` is a path inside the remote repository.
- `destination` is your local output path (supports `~`).
- `dfiles.json` is discovered by walking up parent directories, similar to how Git finds `.git`.
  If no local manifest exists, dfiles uses `~/.dfiles/dfiles.json`.

## How it works

- Repositories are cached under `~/.dfiles/cache/<hash>/`, where `<hash>` is SHA-256 of the repo URL.
- First-time cache setup uses shallow clone (`--depth 1`) to minimize download size.
- Subsequent `pull` operations update existing caches with `git fetch` + `git pull`.
- Sync uses SHA-256 file hashing, so unchanged files are not recopied.
- Supports syncing both files and directories.

## Private repositories

Private repositories work using your existing Git authentication setup. `simple-git` inherits `process.env`, so SSH keys, Git credential manager, and other configured auth methods are used automatically.

## Contributing

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Build:

```bash
npm run build
```

4. Run in dev mode:

```bash
npm run dev -- <args>
```

Examples:

```bash
npm run dev -- init
npm run dev -- list --json
npm run dev -- pull --dry-run
```

PR guidelines:
- Keep PRs focused and small.
- Include a short note on what changed and how you tested it.
- Update docs when command behavior or flags change.

## License

MIT
