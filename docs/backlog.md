# Actis — Deferred Ideas Backlog

Captured from [Brief.md](../Brief.md) item 6. These are explicitly deferred to keep the core deliverable focused on daemon lifecycle, retention/GC, local-LLM translator, and CI. Each item includes a rough complexity estimate and the reason it was deferred.

---

## Complexity Scale

| Rating | Meaning |
|--------|---------|
| **S** (Small) | < 1 week, minimal new deps, touches ≤ 2 files |
| **M** (Medium) | 1–3 weeks, may need 1–2 new deps, touches 3–6 files |
| **L** (Large) | > 3 weeks, architectural impact, multiple new deps or core changes |

---

## 1. Export Formats

**Description:** Add CLI commands to export ledger data as JSON, CSV, or SQLite dump for external analysis or backup.

**Complexity:** **S**

**Reason deferred:** Core deliverables (daemon, retention, CI) must ship first. Export is a standalone convenience feature with no architectural impact — can be added later without touching the watcher or storage layer.

---

## 2. Replay

**Description:** Re-apply recorded filesystem events against a fresh directory to reconstruct state, useful for disaster recovery or reproducing bugs.

**Complexity:** **M**

**Reason deferred:** Requires a deterministic event ordering guarantee and idempotent application logic. The current watcher debounce and batching semantics need to be hardened first (part of daemon lifecycle work). Replay also overlaps with the snapshot diff idea — doing both together would be cleaner.

---

## 3. Git-Aware Mode

**Description:** Correlate ledger events with git commits (branch, commit hash, author) so queries can filter by "what changed in commit X" or "activity on branch Y".

**Complexity:** **M**

**Reason deferred:** Depends on the watcher reliably detecting `.git` directories and reading commit metadata without slowing down the hot path. This is a cross-cutting concern that touches the watcher, storage schema, and query parser — best tackled after the core daemon is stable and the query layer is exercised in CI.

---

## 4. Fuzzy Path Queries

**Description:** Extend the query parser to support glob-like or Levenshtein-distance path matching (e.g., `path ~ "src/**/*.ts"` or `path ≈ "config.json"`).

**Complexity:** **S**

**Reason deferred:** The current rule parser is intentionally minimal and deterministic. Fuzzy matching adds algorithmic complexity and a potential dependency (e.g., `fast-levenshtein`). Deferred until the parser has real-world usage data showing the need.

---

## 5. .actisignore

**Description:** A `.actisignore` file (gitignore-style patterns) to exclude noisy paths (node_modules, build output, vendor dirs) from the watcher without CLI flags.

**Complexity:** **S**

**Reason deferred:** The watcher already supports `--ignore` patterns via CLI. A file-based mechanism is a UX improvement, not a functional gap. Deferred to avoid scope creep on the daemon lifecycle work; can be layered on top once the daemon is proven stable.

---

## 6. --on-change Hooks

**Description:** Execute a user-defined command (shell script, webhook, local binary) when matching events occur, enabling custom reactions (notify, rebuild, sync).

**Complexity:** **M**

**Reason deferred:** Introduces process spawning, timeout handling, and security surface (arbitrary command execution). The Brief explicitly keeps the CLI zero-network and local-first; hooks must be designed to preserve that guarantee. Deferred until after CI gates are in place so hook execution can be tested in the pipeline.

---

## 7. Time-Bucketed Summaries

**Description:** Pre-aggregated rollups (hourly, daily, weekly) of event counts, bytes changed, top paths — queryable via `actis summary --bucket day`.

**Complexity:** **M**

**Reason deferred:** Requires a background aggregation job or materialized views in SQLite. The retention/GC task (item 3 in Brief) will define the vacuum/compaction strategy; summaries should share that infrastructure. Doing summaries first risks schema churn.

---

## 8. Snapshot Diff Between Two Timestamps

**Description:** `actis diff --since <ts1> --until <ts2>` showing a unified diff of file contents at two points in time, derived from stored diffs.

**Complexity:** **L**

**Reason deferred:** Architecturally the largest item. Requires storing forward/reverse diffs efficiently, handling file renames/deletes, and computing transitive diffs across potentially many stored events. The Brief's "Definition of done" prioritizes a working daemon and CI over this advanced query feature. Also explicitly out of scope: a plugin system (which a diff engine might evolve into).

---

## Notes

- **No code changes** — this file is documentation only.
- Items are **not prioritized**; complexity and dependency order suggest a natural sequence if/when capacity opens.
- The **Definition of done** (daemon, retention, CI, local-LLM translator) and **Out of scope** (plugin system, hosted models) from Brief.md are the governing constraints.
- When an item is picked up, create a plan in `docs/plans/` following the existing template.