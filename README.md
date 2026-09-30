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
npm install -g actis
# or
npx actis
```

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

# Show history for a specific file
actis show src/index.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `actis init <name> [path]` | Start tracking a new project |
| `actis watch [path]` | Watch a project for changes (runs continuously) |
| `actis query <question>` | Query the activity log in plain English |
| `actis list` | List all tracked projects |
| `actis show <file>` | Show detailed history for a file |

## Query Examples

- `"what changed since Tuesday"` — all changes since last Tuesday
- `"new files in src"` — created files under src/
- `"deleted files last week"` — deletions in the last 7 days
- `"modified config files since Monday"` — edits to config files since Monday
- `"show me changes in package.json"` — history of a specific file
- `"latest 10 changes"` — most recent 10 events

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
```

- **Watcher**: Uses `chokidar` with debouncing to batch rapid changes
- **Storage**: SQLite with indexes on project, time, and path
- **Diffs**: Computed via `diff` library (line-level for readability)
- **Queries**: Parsed with rule-based NLP (no external API calls)

## Data Stored

Each event records:
- Project ID, file path (relative), event type (create/modify/delete/rename)
- Timestamp (ms since epoch)
- Unified diff (for modifications)
- File sizes before/after
- SHA-256 hashes before/after (truncated)

## Configuration

Ignore patterns (default):
- `node_modules/`, `.git/`, `dist/`, `build/`, `.actis/`
- `*.log`, `*.tmp`, `.DS_Store`, `Thumbs.db`

Customize via `WatcherConfig` in code or extend the CLI.

## License

MIT