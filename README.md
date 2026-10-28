# actis — Local-First Activity Ledger

A filesystem activity tracker that logs every meaningful change (new files, edited configs, dependency updates) with timestamps and diffs, entirely offline. Query it with plain English like "what changed in my project since Tuesday" — no cloud AI required for the tracking itself.

## Features

- **Local-first**: All data stored in SQLite on your machine (`~/.actis/ledger.db`)
- **Automatic diffs**: Line-by-line diffs for text files on every change
- **Natural language queries**: "what changed since Tuesday", "show me new files in src", "deleted files last week"
- **Zero cloud dependencies**: The AI is just a query layer — the tracking is deterministic and inspectable
- **Project-based**: Track multiple projects independently

## Installation

```bash
# Quick install via Git (no npm publish yet)
npm install -g git+https://github.com/ghoulraider13-rgb/Actis.git

# Or from source
git clone https://github.com/ghoulraider13-rgb/Actis.git
cd Actis
npm install
npm run build
# CLI available as ./dist/cli.js or via npx from repo root
```

> **Note**: Package is not yet published to npm. The `git+https://` install works immediately and is the recommended method until first npm publish.

## Quick Start

```bash
# Initialize a project in the current directory
actis init my-project

# Start watching for changes (run in background)
actis watch &

# Make some changes to your files...

# Query with natural language
actis query "what changed since Tuesday"
actis query "show me new files in src"
actis query "deleted files last week"
actis query "modified config files since Monday"

# List tracked projects
actis list

# Launch the web dashboard (reads the same local ledger)
npm run web
# → http://127.0.0.1:7420
```

## Commands

| Command | Description |
|---------|-------------|
| `actis init <name> [path]` | Start tracking a new project |
| `actis watch [path]` | Watch a project for changes (runs continuously) |
| `actis query <question>` | Query the activity log in plain English |
| `actis list` | List all tracked projects |
| `actis show <file>` | Show detailed history for a file |
| `npm run web` | Start the local web dashboard on port 7420 |

## Query Examples

- `"what changed since Tuesday"` — all changes since last Tuesday
- `"new files in src"` — created files under src/
- `"deleted files last week"` — deletions in the last 7 days
- `"modified config files since Monday"` — edits to config files since Monday
- `"show me changes in package.json"` — history of a specific file
- `"latest 10 changes"` — most recent 10 events

## Web Dashboard

The web UI (`npm run web`) is a plain Node HTTP server (no Express, no build step) that serves:
- **Dashboard** at `http://127.0.0.1:7420` — dark-mode timeline of events, project selector
- **REST API** under `/api/` — JSON endpoints for projects, events, stats, and natural-language queries
- **Inspectability**: `/api/query` returns exactly how the NL parser interpreted your question

All data stays on your machine; the server only reads the local `~/.actis/ledger.db`.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Filesystem │────▶│   Watcher   │────▶│  SQLite DB  │
│  (chokidar) │     │  (debounced)│     │  (~/.actis) │
└─────────────┘     └─────────────┘     └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ Query Layer │
                                    │ (NL parser) │
                                    └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ Web Server  │
                                    │ (optional)  │
                                    └─────────────┘
```

- **Watcher**: Uses `chokidar` with 500ms debouncing to batch rapid changes. On
  Linux `/mnt/` paths (WSL drives) it automatically switches to polling —
  inotify does not fire across the 9p mount.
- **Storage**: SQLite (via `sql.js`, pure JS) with indexes on project, time, and path
- **Diffs**: Computed via `diff` library (line-level for readability)
- **Queries**: Parsed with rule-based NLP (no external API calls)
- **Web**: Plain `http` module, serves `public/` as static assets + `/api/*` JSON

## Data Stored

Data home: `~/.actis` (override with the `ACTIS_HOME` environment variable —
tests use this to isolate the ledger).

Each event records:
- Project ID, file path (relative), event type (create/modify/delete/rename)
- Timestamp (ms since epoch)
- Unified diff (for modifications)
- File sizes before/after
- SHA-256 hashes before/after (truncated)

## Default Ignore Patterns

```
**/node_modules/**
**/.git/**
**/dist/**
**/build/**
**/.actis/**
**/*.log
**/*.tmp
**/.DS_Store
**/Thumbs.db
```

Override via `WatcherConfig.ignorePatterns` in code or extend the CLI.

## Development

```bash
npm run dev       # tsx watch on CLI
npm run web:dev   # tsx watch on web server
npm run build     # tsc → dist/
npm run test      # vitest — 34 tests (watcher, diff, query parser)
```

## WSL / Windows drives (mnt paths)

Inotify events do not cross the WSL 9p mount, so watching `/mnt/c/...` from WSL
requires polling. Actis turns polling on **automatically** for `/mnt/` paths on
Linux; override with `actis watch --poll` / `--no-poll`, tune with
`--poll-interval <ms>` (default 1000). Verified against a real `/mnt/c`
directory: creates and modifies are captured (delete capture is verified on
native filesystems).

## License

MIT