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

## Generation test runtime

Group assertions about the same unmodified build under a shared `beforeAll`, so one generation serves them.
Keep changed configs, explicit searches and start-dependence overrides as independent generations. Share
results only within that test run; persisted generation caches can hide regressions.

Prioritize reducing repeated generation and simulation work; adding workers is not a substitute, especially
on CI runners with limited CPU capacity. Preserve every case, phase, clock offset and recovery check.
CI uploads `generation-test-results` with JSON test outcomes and a JUnit report, including when assertions fail.
Use the JUnit suite durations to include shared `beforeAll` work; individual test durations alone omit it.

For a local timing comparison, run the same affected cases before and after, with the same Node version,
worker count and machine load. Save a fresh report for each run, for example from `clock-generator/`:

```bash
npm run test:generation -- src/crafting/automation-science.generation.test.ts \
  --maxWorkers=1 --reporter=default --reporter=json \
  --outputFile=../work/test-results/generation-after.json
```

Compare elapsed time and CPU time as well as test names and outcomes. Use a single worker to isolate work
reduction from scheduling changes; do not report a faster test from a less busy machine as a code speedup.

## Belt pickup experiment release hold

The belt pickup experiment was developed on `integration/belt-pickup` and its stacked mechanics PRs.
It may be consolidated into `master` as an **unreleased merge** while the repository Actions variable
`RELEASE_HOLD` is `true`. Both publishing workflows enforce that hold, including manual dispatches; tests and
master preview deployments remain enabled. Keep the hold active while capture/config compatibility work is pending.

Reserve engine/UI **0.19.0** and Sidecar **0.11.0** for the complete experiment. Keep the engine/UI package and
lock versions synchronized. Update the existing unreleased changelog sections rather than adding a version for
each mechanics case. Keep Sidecar's `info.json`, newest changelog entry, `LATEST_SIDECAR_VERSION`, feature-version
checks and documentation aligned at 0.11.0. Published versions and their release notes stay unchanged.

Publishing is on hold until the user authorizes the release. Do not clear `RELEASE_HOLD` or dispatch publishing
workflows to bypass that hold. At release time, finalize both changelog dates/summaries and run the release
checks. Only then set the repository variable to `false` and explicitly dispatch the release and Sidecar
publishing workflows on `master` (a change outside the Sidecar directory does not trigger its push workflow).
Reserved versions and published release notes remain unchanged until that release.
