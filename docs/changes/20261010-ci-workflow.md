# 20261010-ci-workflow — Update CI workflow per Brief

## Summary
Updated `.github/workflows/ci.yml` to match Brief requirements: single job running on ubuntu-latest, macos-latest, windows-latest with Node 22; steps are `pnpm install --frozen-lockfile` (pnpm equivalent of `npm ci`), `pnpm run build`, `pnpm run test`, `pnpm run lint` (which runs `tsc --noEmit` per package). Removed the separate `lint` job (type check now integrated) and the `pack` job (no npm publish per Brief "Out of scope: Publishing to npm"). Branch protection on main must be enabled in GitHub repo settings (OWNER ACTION REQUIRED).

## Files Changed
- `.github/workflows/ci.yml` — rewritten to single-job matrix per Brief
- `docs/changes/20261010-ci-workflow.md` — this file

## Commands Run (with real output)

### Install dependencies
```bash
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 1.1s
```

### Build
```bash
$ pnpm run build
> actis@0.1.0 build /home/ash/Dev/actis
> pnpm --filter=@actis/core --filter=@actis/cli --filter=@actis/site run build
No projects matched the filters "@actis/site" in "/home/ash/Dev/actis"
Scope: 2 of 3 workspace projects
packages/core build$ tsup
packages/core build: CLI Building entry: src/index.ts, src/query.ts, src/types.ts
packages/core build: CLI Using tsconfig: tsconfig.json
packages/core build: CLI tsup v8.5.1
packages/core build: CLI Target: node22
packages/core build: CLI Cleaning output folder
packages/core build: ESM Build start
packages/core build: CJS Build start
packages/core build: ESM dist/types.js     3.81 KB
packages/core build: ESM dist/index.js     25.89 KB
packages/core build: ESM dist/query.js     4.68 KB
packages/core build: ESM dist/types.js.map 8.79 KB
packages/core build: ESM dist/index.js.map 52.64 KB
packages/core build: ESM dist/query.js.map 9.39 KB
packages/core build: ESM ⚡️ Build success in 27ms
packages/core build: CJS dist/types.cjs     5.02 KB
packages/core build: CJS dist/index.cjs     28.90 KB
packages/core build: CJS dist/query.cjs     6.01 KB
packages/core build: CJS dist/types.cjs.map 9.90 KB
packages/core build: CJS dist/query.cjs.map 9.46 KB
packages/core build: CJS dist/index.cjs.map 52.90 KB
packages/core build: CJS ⚡️ Build success in 26ms
packages/core build: DTS Build start
packages/core build: DTS ⚡️ Build success in 1100ms
packages/core build: DTS dist/index.d.ts           2.99 KB
packages/core build: DTS dist/query.d.ts           146.00 B
packages/core build: DTS dist/types.d.ts           150.00 B
packages/core build: DTS dist/types-B5f9GXJ8.d.ts  1.50 KB
packages/core build: DTS dist/index.d.cts          2.99 KB
packages/core build: DTS dist/query.d.cts          147.00 B
packages/core build: DTS dist/types.d.cts          151.00 B
packages/core build: DTS dist/types-B5f9GXJ8.d.cts 1.50 KB
packages/core build: Done
packages/cli build$ tsup
packages/cli build: CLI Building entry: src/cli.ts, src/server.ts
packages/cli build: CLI Using tsconfig: tsconfig.json
packages/cli build: CLI tsup v8.5.1
packages/cli build: CLI Target: node22
packages/cli build: CLI Cleaning output folder
packages/cli build: ESM Build start
packages/cli build: ESM dist/cli.js        12.18 KB
packages/cli build: ESM dist/server.js     6.30 KB
packages/cli build: ESM dist/cli.js.map    22.84 KB
packages/cli build: ESM dist/server.js.map 12.49 KB
packages/cli build: ESM ⚡️ Build success in 18ms
packages/cli build: DTS Build start
packages/cli build: DTS ⚡️ Build success in 981ms
packages/cli build: DTS dist/cli.d.ts    13.00 B
packages/cli build: DTS dist/server.d.ts 13.00 B
packages/cli build: Done
```

### Tests
```bash
$ pnpm run test
> actis@0.1.0 test /home/ash/Dev/actis
> pnpm --filter=@actis/core run test
> @actis/core@0.1.0 test /home/ash/Dev/actis/packages/core
> vitest run
 RUN  v1.6.1 /home/ash/Dev/actis/packages/core
 ✓ tests/diff.test.ts  (8 tests) 6ms
 ✓ tests/query.test.ts  (17 tests) 11ms
 ✓ tests/watcher.test.ts  (9 tests) 200ms
 Test Files  3 passed (3)
      Tests  34 passed (34)
   Start at  16:07:55
   Duration  678ms
```

### Type check (lint)
```bash
$ pnpm run lint
> actis@0.1.0 lint /home/ash/Dev/actis
> pnpm --filter=@actis/core --filter=@actis/cli --filter=@actis/site run lint
No projects matched the filters "@actis/site" in "/home/ash/Dev/actis"
Scope: 2 of 3 workspace projects
packages/core lint$ tsc --noEmit
packages/core lint: Done
packages/cli lint$ tsc --noEmit
packages/cli lint: Done
```

## Not Verified / Known Gaps
- **Branch protection on main**: Not verified — this is an OWNER ACTION REQUIRED in GitHub repo settings. The workflow alone cannot block merges without branch protection enabled.
- **CI execution on GitHub Actions**: Not verified — the workflow was tested locally only. The actual GitHub Actions run will confirm cross-platform (ubuntu/macos/windows) compatibility.
- **@actis/site package**: Does not exist in this repo; the filter warning is benign.

## Deviations from Plan (and Why)
1. **Used `pnpm install --frozen-lockfile` instead of `npm ci`** — Project uses pnpm (lockfile is `pnpm-lock.yaml`, `packageManager: pnpm@9.12.0`). The pnpm equivalent of `npm ci` is `pnpm install --frozen-lockfile`.
2. **Used `pnpm run build` / `pnpm run test` / `pnpm run lint` instead of `npm run …`** — Same reason; pnpm is the package manager.
3. **Type check runs `pnpm run lint` (per-package `tsc --noEmit`) instead of single `npx tsc --noEmit`** — No root `tsconfig.json` exists; TypeScript config lives in each package. `pnpm run lint` correctly runs `tsc --noEmit` in @actis/core and @actis/cli.
4. **Single Node version (22) instead of matrix [22, 24, 26]** — Brief says "Node 20+" and engines field requires `>=22`. Testing one LTS version (22) on three OSes matches the Brief's matrix requirement of three OSes.
5. **Removed `pack` job entirely** — Brief explicitly lists "Publishing to npm" as out of scope. The previous `pack` job had `if: false` but was kept; removing it entirely is cleaner and matches the constraint.