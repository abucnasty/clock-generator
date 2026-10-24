# Contributing

Use descriptive branch names such as `fix/moving-belt-pickup` or `refactor/game-test-layout`.

## Where files belong

- `clock-generator/resources/config-samples/`: general clock builds and real extracted cells. `ConfigPaths` is their named catalog and is used by sample sweeps.
- `clock-generator/tests/game/mechanics/`: isolated game experiments, fixture configs/scaffolds, and probes. Their catalog is `tests/game/helpers/fixture-paths.ts`, separate from `ConfigPaths`.
- `clock-generator/tests/game/builds/`: generated-clock throughput and recovery checks.
- `clock-generator/src/harness/`: reusable recording infrastructure used by the CLI and tests.
- Simulator regressions stay near their implementation. They may read game fixtures without launching Factorio.
- Full raw recordings and generated probe sources belong in the ignored `clock-generator/.scratch/<topic>/<run>/`, rather than beside committed fixtures.
- `clock-generator/scripts/`: sweeps and capture helpers, and the tools for checking an engine change, each with its usage in its header:
  - `blast/blast.sh`: the blast radius: every sample and fixture generated, every alternative's exported clock hashed, cached by a key of the engine's content (`blast.sh key`, `before`, `run`, `select`, `compare`); a run reruns only the jobs a change of the engine reaches, per the functions each job ran (see the header of `blast.sh`).
  - `native/run-lane.sh`: one Factorio lane over a list of game test cases, at most four harness Factorio processes on the machine; `native/expected-from-blast.py` and `native/check.cjs` check a capture's clocks against the blast's.
  - `classify/features.py` and `summarize.py`: the windows a native recording lifted from a full machine, by when the input's hand grew.
  - `worktree/setup.sh` gives a worktree its own `node_modules`; `worktree/orphans.sh` lists or stops a worktree's leftover vitest and harness Factorio processes.

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

See [clock candidate strategies](clock-generator/docs/clock-candidates.md) for the purpose and removal evidence of
each strategy. Duplicate verification is shared within a generation; input-starvation and output-blockage recovery
remain required. A matching window count alone is not evidence that two candidates have the same behavior.

Group assertions about the same unmodified build under a shared `beforeAll`, so one generation serves them.
Keep changed configs, explicit searches and start-dependence overrides as independent generations. Share
results only within that test run; persisted generation caches can hide regressions.

A generation is shared within a file and no further: Vitest runs each file in a context of its own. When a check in
one file needs the selection of a build that another file generates from the same config, make the check in the file
that generates it (`expectPinnedScaffoldClock` and `expectColdStartRunsOnSelection` in `tests/game/builds/` do), and
keep a test in the first file that the other still makes it.

Prioritize reducing repeated generation and simulation work; adding workers is not a substitute, especially
on CI runners with limited CPU capacity. Preserve every case, phase, clock offset and recovery check.
CI runs the generation tests in four shards (`vitest --shard`, files shared out by the hash of their paths; the
count is the `shard` list of the `generation-shards` job in `.github/workflows/test.yml`), so a pull request waits for
the slowest shard. A file is never split between shards, so the slowest file sets a floor under that time however many
shards there are.
The check named "Generation tests" is the job after the shards. A pull request to master that changes only Markdown,
`docs/` or `clock-generator/docs/` skips the shards, and the check reports success; a run by hand and a release run
them. CI uploads `generation-test-results-<shard>` with JSON test outcomes and a JUnit report, including when assertions
fail. Use the JUnit suite durations to include shared `beforeAll` work; individual test durations alone omit it.

For a local timing comparison, run the same affected cases before and after, with the same Node version,
worker count and machine load. Save a fresh report for each run, for example from `clock-generator/`:

```bash
npm run test:generation -- src/crafting/automation-science.generation.test.ts \
  --maxWorkers=1 --reporter=default --reporter=json \
  --outputFile=.scratch/test-results/generation-after.json
```

Compare elapsed time and CPU time as well as test names and outcomes. Use a single worker to isolate work
reduction from scheduling changes; do not report a faster test from a less busy machine as a code speedup.

## Release hold for unreleased merges

Work can be merged into `master` as an **unreleased merge** while the repository Actions variable `RELEASE_HOLD` is
`true`. Both publishing workflows enforce that hold, including manual dispatches; tests and master preview deployments
remain enabled. Keep the hold active until the held work is ready to release.

Reserve the next engine/UI version and the next Sidecar version for the work held back. Keep the engine/UI package and
lock versions synchronized. Update the existing unreleased changelog sections rather than adding a version for
each change. Keep Sidecar's `info.json`, newest changelog entry, `LATEST_SIDECAR_VERSION`, feature-version
checks and documentation aligned at the reserved Sidecar version. Published versions and their release notes stay unchanged.

While the hold is on, publishing waits until the user authorizes the release. Do not clear `RELEASE_HOLD` or dispatch publishing
workflows to bypass that hold. At release time, finalize both changelog dates/summaries and run the release
checks. Only then set the repository variable to `false` and explicitly dispatch the release and Sidecar
publishing workflows on `master` (a change outside the Sidecar directory does not trigger its push workflow).
Reserved versions and published release notes remain unchanged until that release.
