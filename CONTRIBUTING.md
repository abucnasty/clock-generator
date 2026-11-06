# Contributing

## Pull requests

A pull request's title and body become its merge commit, so together they are the history of the repository. Write them
for someone reading that history later. These rules hold for every pull request, whoever writes it.

### Branch and type

Name the branch `<type>/<slug>`, the slug at most five words in kebab-case and without the issue number (the title
carries it): `fix/moving-belt-pickup`. An integration branch is `release/<slug>`. The type says what the change does for
the user, the person generating clocks:

| Type | The change | User changelog |
| --- | --- | --- |
| `feature` | adds, changes or removes something the user can do or see, samples included | Added, Changed, Removed |
| `fix` | makes a result the user sees right where it was wrong | Fixed |
| `perf` | keeps the results and makes them faster or smaller | Changed |
| `refactor` | keeps the results and changes the code: a zero-change blast | none |
| `test` | adds or changes tests, fixtures or game coverage only | none |
| `docs` | changes documentation only | none |
| `chore` | changes tooling, CI or scripts: nothing the user sees | none |
| `release` | prepares, dates or integrates a version | dates its section |

A pull request with an entry in a user changelog (`CHANGELOG.md` or the sidecar's) is a `feature`, `fix` or `perf`.
Split a pull request that mixes types when its parts can merge apart; otherwise give it the type with the most user
impact: `fix`, then `feature`, then `perf`.

### Title

`<type>: <what changed>`, at most 72 characters, with the issue number at the end when there is one:
`fix: infinity chest gives up its last-sorted item first (#617)`.

### Body

Start from the type's template in `.github/PULL_REQUEST_TEMPLATE/`: copy it, fill it and pass it with
`gh pr create --body-file <file>` (`--template` works only in an interactive terminal):

| Template | Types |
| --- | --- |
| `change.md` | `feature`, `fix`, `perf` |
| `refactor.md`, `test.md`, `docs.md`, `chore.md`, `release.md` | the type of the same name |

Fill every slot; a `{…}` placeholder left in shows a rule was skipped. The visible body fits on one screen, about 25
lines: put longer lists in a `<details>` block. The slots that carry a rule:

- **Blast**: `zero-change`, `<N> jobs moved` with the jobs listed, `selective: <jobs>`, or `not run: <reason>`. The
  Blast column of [Choose checks for the change](#choose-checks-for-the-change) says when one is needed; where it says
  not needed, write `not run:` and the row. A pull request that says behavior is unchanged shows a zero-change blast:
  CI cannot prove that.
- **Evidence**: the best there is, each shown before → after: a game recording that agrees with the simulator, the test
  that failed and now passes, the jobs the blast moved, a screenshot of the UI. Write `factorio: not run` when no game
  ran: a skipped game test is not game verification.
- **Impact**: the door (two-way, or one-way and what cannot be undone) and what it affects (whose builds, saved configs,
  CI time, or none).
- **Version**: the generator version, `sidecar <version>`, both, `bundled: #<pull request>` when another pull request
  carries the bump (as under a [release hold](#release-hold-for-unreleased-merges)), or `none`. A fix reaches users
  only with a version bump, in its own pull request or in the one that carries the bump.
- **Changelog**: the file (`CHANGELOG.md` or `sidecar`) and the exact entry, or `none: no user impact`.
- **Overview** (release): two to four lines on what the release changes for the user, by area, above the list of
  pull requests it ships.

### Changelogs

Changelogs and pull requests say "user", never "player".

- `CHANGELOG.md`, for the generator and its UI, is shown in the app. It lists only what a user notices, under the Keep a
  Changelog headings, one entry per change: `<area>: <change>`, at most 15 words after the area and no full stop. Name
  the build, item, field or result that changes; leave out field names, geometry, mechanisms and reasons. The areas:
  - `simulation`: how the game is modelled
  - `generation`: which potential clocks are found, and which becomes the selected clock
  - `blueprint`: what the user takes into the game
  - `ui`: everything else the user sees on the page

  `- simulation: builds where several inserters share a single machine are now updated in the game's order`
- `clock-generator-sidecar/changelog.txt` is shown on the mod portal and in the game's mod manager. The same rules hold
  in Factorio's format: the categories `Features`, `Changes` and `Bugfixes` instead of areas, and the mod as the
  subject: `- exports which way a belt runs under an inserter's drop`.
- `clock-generator-recorder/changelog.txt` is a developer log: one line per change, which may name recording fields.
  Recorder changes are `chore` or `test`.

## Where files belong

- `clock-generator/resources/config-samples/`: general clock builds, one folder per target item. `ConfigPaths` is their named catalog and is used by sample sweeps.
- `clock-generator/tests/game/mechanics/`: isolated game experiments, fixture configs/scaffolds, and probes. Their catalog is `tests/game/helpers/fixture-paths.ts`, separate from `ConfigPaths`.
- `clock-generator/tests/game/builds/`: generated-clock throughput and recovery checks.
- `clock-generator/src/harness/`: reusable recording infrastructure used by the CLI and tests.
- Simulator regressions stay near their implementation. They may read game fixtures without launching Factorio.
- Full raw recordings and generated probe sources belong in the ignored `clock-generator/.scratch/<topic>/<run>/`, rather than beside committed fixtures.
- `clock-generator/scripts/`: sweeps and capture helpers, and the tools for checking an engine change, each with its usage in its header:
  - `blast/blast.sh`: the blast radius: every sample and fixture generated, every alternative's exported clock hashed, cached by a key of the engine's content and of the environment variables that change what it generates (none today; a `CLOCK_*` variable no list in `key.py` knows stops the command) (`blast.sh key`, `before`, `run`, `select`, `compare`, `record`); a run reruns only the jobs a change of the engine reaches, per the functions each job ran (see the header of `blast.sh`).
  - `blast/record.py` (through `blast.sh record write|check`): the record in `clock-generator/record/`, one small JSON per blast job (the selected clock and every alternative), written from a blast run and checked against one in CI. See [`record/README.md`](clock-generator/record/README.md).
  - `replay/replay.sh`: the replay check of a change that must keep results identical: every blast job's selected clock run with no search (the as-built run, the planning run, a speed run and, with `--losses`, the supply losses), what every entity holds and shows hashed per period, and laid against a base recorded once on the parent commit (`record`, `check`, `explain`).
  - `native/run-lane.sh`: one Factorio lane over a list of game test cases, at most four harness Factorio processes on the machine; `native/expected-from-blast.py` and `native/check.cjs` check a capture's clocks against the blast's.
  - `classify/features.py` and `summarize.py`: the windows a native recording lifted from a full machine, by when the input's hand grew.
  - `worktree/setup.sh` gives a worktree its own `node_modules`; `worktree/orphans.sh` lists or stops a worktree's leftover vitest and harness Factorio processes.

The [game verification guide](clock-generator/tests/game/README.md) explains setup, fixture conventions, capture commands and measured evidence.

## Choose checks for the change

Run commands from the package they belong to. Engine commands below run from `clock-generator/`.

| Change | Verification | Blast |
| --- | --- | --- |
| Documentation only | Check changed links and command paths. Simulation and game runs are unnecessary. | not needed |
| File moves, import paths, fixture catalog, test/build configuration | `npm run test:typecheck`, `npm run build`, `npm run lint`, `npm run knip`, and `npx vitest list --config vitest.game.config.ts --filesOnly`. Run affected simulator tests. | engine files or import paths: yes, zero-change expected; catalog or configuration only: not needed |
| Shared Lua capture or a probe | Type-check, run helper unit tests and affected mechanic game tests. Preserve observation/intervention ordering and capture windows. | not needed |
| Simulator mechanic | Affected unit tests and a targeted game comparison when Factorio is available. Include generation tests when clock selection or windows change. | yes |
| Clock planning or selection | Affected generation tests and relevant clock throughput/recovery game cases when available; where a job's result moves, a new record and a MOVES.md entry ([the record](#the-record-of-the-blast-jobs)). | yes |
| Samples or fixture configs | Affected generation tests and the samples' game cases when available; the record of the jobs they feed (a new sample or fixture is a new record file). | selective: the jobs they feed |
| UI | UI lint/type checks and affected UI tests. Build when imports or package integration change. | not needed |

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
that generates it, and
keep a test in the first file that the other still makes it. A game-tied pin of a selection that is a job of the record
(`clock-generator/record/`) is checked against the record by `clock-controls.test.ts`, with no generation of its own. A
property that must hold of every job's result (not a value) belongs in `clock-generator/tests/game/builds/record-properties.ts`,
which the blast runs on every alternative of every job and `blast.sh record check` reports; do not write it again as a test of
one build.

Prioritize reducing repeated generation and simulation work; adding workers is not a substitute, especially
on CI runners with limited CPU capacity. Preserve every case, phase, clock offset and recovery check.
CI runs the generation tests in eight shards (`vitest --shard`, files shared out by their measured CI seconds in
`clock-generator/ci/generation-durations.json`; the count is the `shard` list of the `generation-shards` job in
`.github/workflows/test.yml`), so a pull request waits for the slowest shard. A file is never split between shards, so the slowest file sets a floor under that time however many
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

## The record of the blast jobs

[`clock-generator/record/`](clock-generator/record/README.md) holds one small JSON file for each of the 86 blast jobs: the clock the generator selects for the
sample or fixture and every alternative it weighed (verdict, holds, rate, period, wake-ups, windows, clock hash). The check named "Record check" in CI
generates the jobs in six shards (`Record jobs (shard n of 6)`, dealt out by the seconds each job took on a runner,
`clock-generator/ci/record-durations.json`), joins them and compares them with the committed files field by field; a difference fails with a table of job,
field, before and after in the job summary. The check runs on every pull request to `master`, `feature/` or `release/` that changes more than documentation, and reports
success on one that changes documentation only. Its name is stable so that it can be a required check. It is never faster than the slowest job
(the productivity module chest chain). After a change to the jobs or the engine, refresh the durations with
`node scripts/ci/update-record-durations.js <dir of the downloaded record-jobs-* artifacts of a run>`. The same script prints the shard
count the durations call for (`--shards` prints only that): the smallest count whose estimated slowest shard is the slowest job, which is 6
today; set the `shard` list of the `record-shards` job in `.github/workflows/test.yml` to it when it changes.

**A selected clock never gets worse unless MOVES.md says so.** The same check sets the selected clock of every job against the record of the pull
request's base (the first parent of the merge commit CI tests) and fails when one got worse and its job key is not in the lines the pull request adds to
[`record/MOVES.md`](clock-generator/record/MOVES.md). The record has no target, so worse is defined by its fields, on the selected alternative:

- the job generated before and now fails to (`error`);
- the verdict ranks lower: `stable`, then `no recovery`, then `unstable`;
- `holds` went from true to false;
- `rate` is lower;
- `wake_ups` (inserter wake-ups a minute) is higher.

Locally: `python3 scripts/blast/record.py worse --base <the base's record folder> --moves <the lines added to MOVES.md>`.

A pull request that changes what the generator selects or computes on purpose regenerates the record, commits the new files and adds an entry to
[`record/MOVES.md`](clock-generator/record/MOVES.md) that names each moved job and why. From `clock-generator/`, with a clean engine commit:

```bash
BLAST_GROUPS=config,pickup,overhood,front,blocked,containers,variants bash scripts/blast/blast.sh run .. <out>   # cached by the engine's key; a rerun is selective
bash scripts/blast/blast.sh record write <out>        # rewrites record/ (the cache entry's key works in place of <out>)
bash scripts/blast/blast.sh record check <out>        # exit 0: the committed files equal the run
git diff --stat record/                               # the moved jobs; each one gets a line in MOVES.md
```

A pull request that moves no record changes no file in `record/`. A rename of jobs is checked with `blast.sh record check --map <renames.txt> <out>`
(the rename map of `blast.sh compare`), then the files are renamed with `record write`.

### Which test a check belongs in

| The check | It goes in | Why |
| --- | --- | --- |
| What the generator selects or computes for a sample or fixture as it is (verdict, rate, period, wake-ups, windows, clock hash) | nothing: the record holds it | a moved value is a changed file in `record/` and a MOVES.md entry, not a hand-edited assertion |
| The same for a sample with an option set (belts backed up, an ingredient out of the period) that a game recording is tied to or a test pins | a job of the `variants` group: an entry in [`variant-jobs.ts`](clock-generator/tests/game/builds/variant-jobs.ts) naming the recording or test that qualifies it | the job gets the record and every property; the generation test goes |
| Something that must be true of every job's result, whatever the build | a property of `record-properties.ts` (below) | one definition, run on every alternative of every job |
| A game recording's clock | its `*-clock-controls.json` entry; `clock-controls.test.ts` checks the hash against the record | no generation of its own |
| An option or search the record does not run (a changed config, an explicit search, a start-dependence override, a ranking such as the speed-80 agricultural one), or a check of a hand-made clock or a direct call | a generation test (`*.generation.test.ts`), one generation shared in the file (above) | a job would be one more generation for a check no recording needs; add a variant job only when a recording or a pin does |
| A function or rule that needs no generation | a unit test (`npm test`) | runs on every pull request, in seconds |

A job file is never edited by hand: `record write` makes it, and `blast.sh record check` fails on a job with no file and on a file with no job.

### The property module

[`record-properties.ts`](clock-generator/tests/game/builds/record-properties.ts) holds the five properties
([listed in `record/README.md`](clock-generator/record/README.md#the-properties)). To add one: name it in `PROPERTIES`, write its check in
`checkProperties` so that it returns the problems it finds on an alternative (a message with the values) and applies only where the alternative
has what it needs, then make a full blast, so that every job file carries the new module's hash (a job file from another version of the module
fails `record check`):

```bash
BLAST_GROUPS=config,pickup,overhood,front,blocked,containers,variants bash scripts/blast/blast.sh run .. <out> --full
bash scripts/blast/blast.sh record check <out>        # the problems, by job, property and alternative
```

A property is never loosened because a job fails it: the failure is a finding. When a job fails one for a reason of its own, name it in
`EXCEPTIONS` (job key, property, the alternative ids, the reason with the issue number), file the issue, and say so in the pull request;
`record check` lists what each exception found. #626 is the example: `counters-add-up` finds an inserter's swings a minute above its grabs a
minute on five alternatives (`config-ADVANCED_CIRCUIT_230`, `config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN`, `config-STEEL_PLATE_26_WAGON_CHEST` and two
variant jobs); each is in `EXCEPTIONS` with `#626` in its reason, and the entries go when #626 is fixed.

### The CI jobs

| Check name | What it does | Runs |
| --- | --- | --- |
| Unit tests | knip, typecheck, build, lint, `npm test` (the units, `clock-controls.test.ts` among them) | every pull request that changes more than documentation |
| Generation tests (shard n of 8), then Generation tests | the `*.generation.test.ts` files, dealt out by `ci/generation-durations.json` | ready pull requests to `master`, `feature/` or `release/` that change more than documentation, and releases; on a draft the shards do not run and the check fails (below) |
| Record jobs (shard n of 6), then Record check | the 86 jobs, joined, compared with `record/`, with the properties and the never-worse rule | ready pull requests to `master`, `feature/` or `release/` that change more than documentation; on a draft the shards do not run and the check fails (below) |
| UI build, UI tests of every sample, UI generate in a browser | the UI | every pull request that changes more than documentation |

**Drafts.** GitHub's free plan runs 20 jobs at once and a pull request starts about 22, so the heavy suites (the generation shards and the
record shards) do not run on a draft pull request; unit tests, the UI build, the UI samples and the browser job do. On a draft the checks
"Generation tests" and "Record check" run and fail with "not run on a draft: mark the pull request ready, or run
`gh workflow run test.yml --ref <branch>`": a skipped required check counts as passing, so they never skip or pass there. Marking the pull
request ready (`ready_for_review`) runs everything, as does a push to a ready pull request, a run by hand (`gh workflow run test.yml --ref <branch>`)
and a release or sidecar run that calls the workflow.

The ruleset "Integration branches: CI before merge" (`feature/*`, `release/*`) lists `Record check` among its required checks, so a record
that moved without a file, a property problem or an unnamed worse selected clock stops a merge into an integration branch. No ruleset
covers `master` today. After a change to the jobs, refresh `ci/record-durations.json` (above); after a change to the generation tests,
`node scripts/ci/update-generation-durations.js <dir of the downloaded generation-test-results-* artifacts of a run>` (a median of several runs is
steadier than one).

## Release hold for unreleased merges

Work can be merged into `master` as an **unreleased merge** while the repository Actions variable `RELEASE_HOLD` is
`true`. Both publishing workflows enforce that hold, including manual dispatches; tests and master preview deployments
remain enabled. Keep the hold active until the held work is ready to release.

Reserve the next engine/UI version and the next Sidecar version for the work held back. Keep the engine/UI package and
lock versions synchronized. Update the existing unreleased changelog sections rather than adding a version for
each change. Keep Sidecar's `info.json`, newest changelog entry, `LATEST_SIDECAR_VERSION`, feature-version
checks and documentation aligned at the reserved Sidecar version. Published version numbers and their GitHub release
notes stay unchanged; a published changelog entry may be reworded when it keeps its meaning and its version.

While the hold is on, publishing waits until the user authorizes the release. Do not clear `RELEASE_HOLD` or dispatch publishing
workflows to bypass that hold. At release time, finalize both changelog dates/summaries and run the release
checks. Only then set the repository variable to `false` and explicitly dispatch the release and Sidecar
publishing workflows on `master` (a change outside the Sidecar directory does not trigger its push workflow).
Reserved versions and published GitHub release notes remain unchanged until that release.
