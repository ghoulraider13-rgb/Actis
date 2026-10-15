# Changes for task/20261010-retention-gc

## Summary
Implemented retention garbage collection (`actis gc` command) with the following features:
- Deletes events older than `--keep-days` from `file_events` table
- Nulls diffs older than `--keep-diffs-days` while preserving event metadata
- Optional `--max-diffs-per-file N` keeps only the latest N diffs per file
- `--dry-run` mode shows what would be deleted without making changes
- All operations run in a single SQLite transaction for atomicity
- Added comprehensive tests covering all scenarios

## Files Changed
- `packages/core/src/retention.ts` - New browser-safe module with `RetentionPolicy`, `RetentionResult`, `RetentionDb` types and `applyRetention`/`previewRetention` functions
- `packages/core/src/index.ts` - Added export for retention module
- `packages/core/tsup.config.ts` - Added `src/retention.ts` to entry points
- `packages/cli/src/gc.ts` - New CLI command implementation
- `packages/cli/src/cli.ts` - Replaced `prune` stub with `gc` command
- `packages/core/tests/retention.test.ts` - New test file with 7 tests covering all acceptance criteria

## Commands Run
```bash
# Build
pnpm run build
# Output: Build succeeded for @actis/core and @actis/cli

# Tests
pnpm test
# Output: All 69 tests pass (41 existing + 7 new retention tests + 28 llm-query tests)
```

## Manual Verification
Tested the CLI command end-to-end:
```bash
# Dry run
actis gc --dry-run --keep-days 365 --keep-diffs-days 90 --max-diffs-per-file 2
# Output: Shows events to delete (1), diffs to null (1), diffs to trim (3)

# Actual execution
actis gc --keep-days 365 --keep-diffs-days 90 --max-diffs-per-file 2
# Output: GC complete with correct counts

# Verification via query/show commands confirmed:
# - Very old event (400 days) deleted entirely
# - Medium old event (200 days) kept but diff nulled
# - Recent event (10 days) fully preserved
# - frequent.txt keeps only latest 2 diffs (versions 4, 5)
```

## Acceptance Criteria Met
- ✅ `actis gc --keep-days 365 --keep-diffs-days 90 --dry-run` shows what would be deleted
- ✅ `actis gc --keep-days 365 --keep-diffs-days 90` executes deletion
- ✅ Events older than `--keep-days` deleted from `file_events`
- ✅ Diffs older than `--keep-diffs-days` set to NULL (metadata retained)
- ✅ Optional `--max-diffs-per-file N` keeps only latest N diffs per file
- ✅ Single transaction for atomicity
- ✅ Tests: create old events, run gc, verify correct rows deleted/nulled

## Deviations from Plan
None - all acceptance criteria implemented as specified.