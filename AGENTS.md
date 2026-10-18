# Working in this repository

Use descriptive branch names such as `fix/moving-belt-pickup` or `refactor/game-test-layout`.

## Resource ownership

- `clock-generator/resources/config-samples/`: general clock builds and real extracted cells. `ConfigPaths` is their named sample catalog and is used by broad sweeps.
- `clock-generator/tests/game/mechanics/`: isolated game experiments, fixture configs/scaffolds, and probes. Use `tests/game/helpers/fixture-paths.ts`; do not add mechanic fixtures to `ConfigPaths`.
- `clock-generator/tests/game/builds/`: generated-clock throughput and recovery checks.
- `clock-generator/src/harness/`: reusable recording infrastructure used by the CLI and tests.
- Keep simulator regressions near their implementation. They may read game fixtures without launching Factorio.
- Full raw recordings and generated probe sources belong in ignored `work/<topic>/<run>/`, not beside committed fixtures.

## Select verification by the change

Run commands from the package they belong to. Engine commands below run from `clock-generator/`.

| Change | Verification |
| --- | --- |
| Prose/instructions only | Check changed links and command paths. No simulation or game runs. |
| File moves, import paths, fixture catalog, test/build configuration | `npm run test:typecheck`, `npm run build`, `npm run lint`, `npm run knip`, and `npx vitest list --config vitest.game.config.ts --filesOnly`. Run affected simulator tests. |
| Shared Lua capture or a probe | Type-check; run the helper unit tests and the affected mechanic game-test files. Preserve observation/intervention ordering and capture windows. |
| Simulator mechanic | Affected unit tests; targeted game comparison when Factorio is available. Add generation tests when clock selection/window behavior changes. |
| Clock planning/selection | Affected generation tests; relevant clock-throughput/recovery game cases when available. |
| UI | UI lint/type checks and affected UI tests; build when imports/package integration changes. |

Use `npm test -- <file>` for unit/helper tests and `npm run test:generation -- <file>` for generation tests. Avoid broad sample sweeps, all game tests, or repeating full suites when scoped checks already cover the change. Broaden verification when failures or cross-cutting changes justify it.

`npm run test:typecheck` checks simulator and game test code without running Factorio. Ordinary CI does not have Factorio. A skipped game test is not game verification; report tests that ran and any skipped checks accurately.

See `clock-generator/tests/game/README.md` and its scoped `AGENTS.md` before changing a game experiment. Explicit user instructions take precedence over these defaults.
