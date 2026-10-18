# Contributing

Use descriptive branch names such as `fix/moving-belt-pickup` or `refactor/game-test-layout`.

## Where files belong

- `clock-generator/resources/config-samples/`: general clock builds and real extracted cells. `ConfigPaths` is their named catalog and is used by sample sweeps.
- `clock-generator/tests/game/mechanics/`: isolated game experiments, fixture configs/scaffolds, and probes. Their catalog is `tests/game/helpers/fixture-paths.ts`, separate from `ConfigPaths`.
- `clock-generator/tests/game/builds/`: generated-clock throughput and recovery checks.
- `clock-generator/src/harness/`: reusable recording infrastructure used by the CLI and tests.
- Simulator regressions stay near their implementation. They may read game fixtures without launching Factorio.
- Full raw recordings and generated probe sources belong in ignored `work/<topic>/<run>/`, rather than beside committed fixtures.

The [game verification guide](clock-generator/tests/game/README.md) explains setup, fixture conventions, capture commands and measured evidence.

## Choose checks for the change

Run commands from the package they belong to. Engine commands below run from `clock-generator/`.

| Change | Verification |
| --- | --- |
| Documentation only | Check changed links and command paths. Simulation and game runs are unnecessary. |
| File moves, import paths, fixture catalog, test/build configuration | `npm run test:typecheck`, `npm run build`, `npm run lint`, `npm run knip`, and `npx vitest list --config vitest.game.config.ts --filesOnly`. Run affected simulator tests. |
| Shared Lua capture or a probe | Type-check, run helper unit tests and affected mechanic game tests. Preserve observation/intervention ordering and capture windows. |
| Simulator mechanic | Affected unit tests and a targeted game comparison when Factorio is available. Include generation tests when clock selection or windows change. |
| Clock planning or selection | Affected generation tests and relevant clock throughput/recovery game cases when available. |
| UI | UI lint/type checks and affected UI tests. Build when imports or package integration change. |

Use `npm test -- <file>` for unit/helper tests and `npm run test:generation -- <file>` for generation tests.
Start with checks that cover the change; broaden them when failures or changes across several components justify it.
Broad sample sweeps, the full game suite and repeated full test runs can be expensive and often add little to a scoped change.

`npm run test:typecheck` checks simulator and game test code without running Factorio. Ordinary CI has no Factorio
installation, so it cannot produce fresh game evidence. Report which checks ran and which were skipped; a skipped
game test is not game verification.
