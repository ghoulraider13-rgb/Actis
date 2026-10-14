# Changes for task/20261010-daemon-lifecycle

## Summary
Implemented daemon lifecycle commands (`actis watch --daemon`, `actis start`, `actis stop`, `actis status`) with full background process management.

## Files Changed
- `packages/cli/src/daemon.ts` - New module with daemon lifecycle implementation (277 lines)
- `packages/cli/src/cli.ts` - Added `--daemon` flag to watch, implemented `start`, `stop`, `status` commands

## Features
- **`actis watch --daemon <path>`** - Starts background daemon with PID file tracking
- **`actis start <path>`** - Alias for watch --daemon
- **`actis stop`** - Gracefully stops daemon via SIGTERM (5s timeout, force cleanup)
- **`actis status`** - Shows RUNNING/STOPPED with PID, project name, path, and uptime

## Implementation Details
- **PID file**: `~/.actis/actis.pid` (JSON with pid, projectPath, projectName, startedAt)
- **Log file**: `~/.actis/daemon.log` (stdout/stderr from daemon process)
- **Worker process**: Spawned detached with `node dist/cli.js daemon-worker <args>`
- **Worker entry point**: Detected in cli.ts by `argv[2] === 'daemon-worker'` skip
- **SIGTERM handler**: Flushes pending events, closes DB, removes PID file, exits 0
- **Race condition handling**: Parent verifies PID file within 100ms, cleans up on failure

## Commands Run
```bash
# Build
pnpm run build
# Output: Build succeeded for @actis/core and @actis/cli

# Tests
pnpm test
# Output: All 34 tests pass

# Manual Verification
actis init test-final /tmp/test-final-proj
actis watch --daemon /tmp/test-final-proj
# → "Daemon started (PID 71402) watching..."
actis status
# → "actis daemon: RUNNING (PID 71402) watching "test-final" at /tmp/test-final-proj, uptime 3s"
actis stop
# → "Stopped daemon (PID 71402)"
actis status
# → "actis daemon: STOPPED"

# Foreground watch still works
actis watch /tmp/test-fg-proj
# → "Watching "test-fg" at /tmp/test-fg-proj. Press Ctrl+C to stop."
```

## Acceptance Criteria Met
- ✅ `actis watch --daemon` starts background daemon
- ✅ `actis stop` stops daemon gracefully (SIGTERM, 5s timeout)
- ✅ `actis status` shows RUNNING/STOPPED with PID and uptime
- ✅ PID file at `~/.actis/actis.pid`
- ✅ Log file at `~/.actis/daemon.log`
- ✅ Worker process detached, parent exits independently
- ✅ Graceful shutdown flushes pending events, saves DB
- ✅ Stale PID file detection (process dead → STOPPED)
- ✅ All 34 tests pass, build succeeds

## Deviations from Plan
- Used `actis watch --daemon` instead of separate `actis start` (both work, watch --daemon is the primary)
- Worker process uses same CLI binary with `daemon-worker` sentinel command (cleaner than separate entry point)