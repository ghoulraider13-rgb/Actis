# Actis — Backlog

Deferred ideas for Actis, captured from `Brief.md` item 6. None of these are
part of the current hardening milestone; they are recorded here so they are
not lost and can be scheduled deliberately later.

Complexity scale (matches `docs/plans/`):
- **S** — Small: < 1 week, minimal or no new deps, touches ≤ 2 files.
- **M** — Medium: 1–3 weeks, may need 1–2 new deps, touches 3–6 files.
- **L** — Large: > 3 weeks, architectural impact, multiple new deps or core changes.

## Summary

| # | Idea | Complexity | Reason deferred (short) |
|---|------|------------|-------------------------|
| 1 | Export formats | M | Needs the stable storage/query layer to land first |
| 2 | Replay | L | Depends on reliable stored diffs + daemon lifecycle |
| 3 | Git-aware mode | L | Needs git integration and stable ignore semantics |
| 4 | Fuzzy path queries | M | Rule parser must be frozen and deterministic first |
| 5 | `.actisignore` (full semantics) | S | Basic parsing exists; full gitignore semantics are lower priority |
| 6 | `--on-change` hooks | M | Arbitrary command execution needs sandboxing/UX design |
| 7 | Time-bucketed summaries | S | Weekly summary exists; generalizing is a nice-to-have |
| 8 | Snapshot diff between two timestamps | M | Depends on retained per-file diffs and GC landing |

---

## 1. Export formats

**Description.** Let users export ledger data out of SQLite into portable
formats — at minimum JSON (round-trippable via `actis import`), CSV (spreadsheet
analysis), and Markdown (human-readable reports). Should support filtering by
project, path and time range, and stream large exports rather than buffering the
whole result set.

**Complexity.** M

**Reason deferred.** Export is a presentation layer over the storage and query
systems. The on-disk SQLite backend (WAL), the daemon lifecycle and retention/GC
are the higher-priority items in the Brief's Definition of Done; the schema and
query surface should be stable before we freeze an export format.

---

## 2. Replay

**Description.** Reconstruct the timeline of a project — or a single file — by
replaying recorded events and their diffs between two points in time, either as
a scrollable CLI/TUI walkthrough or as a machine-readable stream. A building
block for "what did this look like at commit X / last Tuesday?".

**Complexity.** L

**Reason deferred.** Replay is only as trustworthy as the stored diffs it reads;
it depends on the SQLite backend reliably persisting diffs and on GC/retention
deciding how long those diffs survive. It is an architectural feature, not a
quick add-on, and sits beyond the current hardening milestone.

---

## 3. Git-aware mode

**Description.** Correlate filesystem events with git state: attribute changes
to commits/branches, mark events as "dirty" vs "committed", surface the branch a
change landed on, and expose queries like `actis query "files changed on
feat/x last week"`.

**Complexity.** L

**Reason deferred.** Requires shelling out to git (or a git library), a clear
policy for `.git/` handling (already ignored by default) and provenance
semantics that must not lie when the repo is dirty or mid-rebase. It depends on
stable ignore handling and the query layer, and adds a non-trivial dependency
surface, so it is out of the current milestone.

---

## 4. Fuzzy path queries

**Description.** Allow approximate path matching in queries so a mistyped,
abbreviated or partially remembered path still resolves — e.g. `auth middlware`
matching `src/auth/middleware.ts`, with ranked results and a confidence score.

**Complexity.** M

**Reason deferred.** The rule parser (`packages/core/src/query.ts`) is
deliberately deterministic and browser-safe, and the CLI's no-network guarantee
means any fuzzy matching must be local. Adding fuzzy behaviour on top of an
unfrozen parser would make results harder to reason about; the parser should be
stabilized first, with fuzzy matching layered on only when the deterministic
path is settled.

---

## 5. `.actisignore` (full semantics)

**Description.** A project-local ignore file with gitignore-compatible
semantics: negation (`!pattern`), directory-only rules (`dir/`), anchoring and
precedence relative to `.gitignore` and the built-in defaults.

**Complexity.** S

**Reason deferred.** Partial support already exists — `packages/core/src/ignore.ts`
reads `.actisignore` and merges it with defaults and `.gitignore`, but it
currently skips negated (`!`) rules and directory-only markers. The built-in
secret-safe and no-diff patterns already cover the risky cases, so completing
full gitignore semantics is a small, low-risk improvement that can wait until
after the core hardening work.

---

## 6. `--on-change` hooks

**Description.** Let `actis watch` run a user-specified command when a matching
change is detected, e.g. `actis watch --on-change 'make lint' --match 'src/**/*.ts'`,
passing the changed paths and event types to the hook.

**Complexity.** M

**Reason deferred.** Executing arbitrary user commands from a long-running
watcher raises real safety and UX questions (debounce/coalescing, quoting,
failure handling, recursion if the hook writes files, WSL/Windows shell
differences). It also overlaps with the explicitly out-of-scope "plugin system".
Needs a dedicated design before implementation.

---

## 7. Time-bucketed summaries

**Description.** Generalize the existing `actis summary` command into
configurable time buckets (hourly / daily / weekly / monthly) and expose the
aggregation as a browser-safe core function so the landing page demos and
dashboards can reuse it instead of each re-implementing grouping.

**Complexity.** S

**Reason deferred.** A weekly summary already exists in `packages/cli/src/cli.ts`
(grouped by day, then directory), so this is an ergonomic generalization rather
than missing capability. It is a nice-to-have that should follow the storage and
retention work, once the underlying query surface is stable.

---

## 8. Snapshot diff between two timestamps

**Description.** Diff an entire project (or a subtree) between two points in
time: which files were created, modified, deleted or renamed, with per-file line
counts — a "git diff" over the ledger's own history, independent of any VCS.

**Complexity.** M

**Reason deferred.** Depends on per-file diffs being reliably persisted and on
retention/GC defining how far back snapshots remain available (once old diffs
are nulled by `actis gc`, the diff can no longer be produced). It should land
after the storage backend and GC policy are in place, and it reuses the same
diff primitives in `packages/core/src/diff.ts`.

---

_All items are documentation only. No implementation is committed for any of
them as part of this task; see `Brief.md` item 6 and `docs/plans/` for the plan
that produced this file._
