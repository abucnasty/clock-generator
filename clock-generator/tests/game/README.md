# Game-backed verification

These tests compare the simulator and generated clocks with Factorio. They require a local Factorio installation;
ordinary CI runs simulator tests and type-checks this code without producing new game evidence.

- [Mechanic experiments](mechanics/): isolated game rules, with configs, scaffolds, probes and evidence scope.
- [Clock builds](builds/README.md): generated-clock throughput and recovery, often reusing ordinary samples.
- [Belt drops](mechanics/belt-drop/README.md): native deposit timing at effective stack sizes 1–4.
- [Belt pickup](mechanics/belt-pickup/README.md): moving stacks, lane fallback, backed-up supply and pickup capture.
- `helpers/`: internal fixture paths, host-side Lua composition and shared Lua observations/capture.
- General examples and real extracted cells remain under [config-samples](../../resources/config-samples/README.md).

## Setup

Use Node 24+ and install dependencies with `npm ci` from `clock-generator/`. Copy `.env.example` to `.env` if
needed; preserve an existing `.env`. Set `FACTORIO_PATH` to an executable or install directory and
`FACTORIO_HARNESS_SAVE=resources/clock_generator_staging.zip`. Use Factorio with the staging save's dependencies
(including Space Age for these pickups). Current pickup calibration used Factorio 2.1.21, legendary stack inserters,
fully researched hand/belt stack capacity and a powered editor surface. The committed staging save supplies the
prepared surface; the harness copies the repository's recorder and sidecar mods. It always works on a copy of the save.

## Select a check

All commands run from `clock-generator/`:

```bash
# Static validation, including game tests; no Factorio process.
npm run test:typecheck
npx vitest list --config vitest.game.config.ts --filesOnly

# Simulator regression only; does not collect fresh measurements.
npm test -- src/simulation/components/belt-hand-pickup.test.ts

# Individual mechanic checks; .env is loaded automatically.
npm run test:game -- tests/game/mechanics/belt-pickup/backed-up-pickup.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/same-item-pickup-fixture.game.test.ts

# A clock check narrowed to a case, rather than every scaffold/recovery scenario.
npm run test:game -- tests/game/builds/moving-pickup.game.test.ts -t 'straight-belt holds'
```

`npm test` excludes `*.game.test.ts`. `npm run test:generation` checks generated clocks in the simulator.
`npm run test:game` without a file runs the entire local game suite, serially, and can take many minutes;
`python3 scripts/game/run-suite.py` runs it as case-level jobs on as many Factorio lanes as the guard allows (below).
Missing Factorio/save settings cause skips; a skipped test has not verified the game behavior.

For verification appropriate to other changes, see the [contributor guide](../../../CONTRIBUTING.md).

## How a run is timed

A clock check in the game is timed in game minutes, never in clock periods: a clock's period can be very long (116,160 ticks for
one build), and the length of the period must not decide how long a check runs. One minute is 3,600 ticks. All of it is in
`helpers/lua/steady.lua`; every clock family and the scripts that start the game for a check use that one helper.

- **Steady state** is reached the first moment the machines that make the item the build is for have made the amount the target
  asks for over the last minute (the target rate times 60 seconds). Warming up and settling are not timed in periods either: the
  run goes on until that happens, and fails if it has not within ten minutes (36,000 ticks).
- **Baseline:** the minute after steady state. It holds when the last minute's output never falls below the target amount. A
  build whose output comes in bursts can dip below it between two bursts; then the baseline holds when the products from steady
  state to the last moment the last minute reached the target again make at least the target rate over that stretch, so a minute
  that ends between two bursts does not count against the clock. A build whose output only evens out over a longer stretch may ask
  for a longer baseline, with the reason written next to it, and never over ten minutes (36,000 ticks).
- **Disturbances** follow the baseline: each ingredient cut and the output block, one after the other. A disturbance lasts until the
  last minute's output falls below the lowest it had in the baseline (so the loss is real and not a burst missing from the window),
  and is then released. **Recovery** is steady state met again; it has to happen within ten minutes of the release. Ten minutes
  is a bound for inputs that refill slowly, not what a good clock needs.
- **Length:** a whole run (steady state, baseline and every disturbance with its recovery) ends at 15 minutes of game time
  (54,000 ticks) whatever has happened; a build that would need more is not recorded as a test.
- **Tier:** the clock tests run the turbo belt tier only; the slower tiers are not recorded.
- **Mechanics probes** (`mechanics/`) are fixed short recordings of one game rule. Their stored recordings are read back and
  recorded again only when the game binary changes.
- **Scripts:** `scripts/record-clock.js`, `scripts/rule-count-game-check.js` and `scripts/capture-probe.js` follow the same rule
  (`capture-probe.js` records a mechanics probe of a fixed, short length). `record-clock.js` and `rule-count-game-check.js` wait for steady state, judge the baseline minute as above and then record at
  least one more minute (whole clock periods, as the recorder does). They refuse a request over 36,000 ticks, or a recording that
  would be, unless they are run with `--long "<reason>"` (or `LONG_RUN=<reason>`):
  a long run is a deliberate choice for one particular build, the reason is printed, and routine checks never use it.

## Recording cache

A game test that asks for a recording the game already made does not start the game again. `recordInFactorio` keeps each
recording under a key and reads it back when the key is the same; the test's own assertions run on it as on a fresh one.
The key is a hash of everything the game is given: the game's executable and the names and sizes of its data files, the
save, the mods the harness copies in (the recorder and the sidecar), the harness's own sources, a protocol number, and every
option of the run but where it writes to (scaffold, clock and its schedule, config, probe script with the helpers it
composes, seeds, ticks, speed and the rest, so an option added later is in the key without being named). A game that makes
several builds one after the other (`CachedHarnessSession`) keys each build on the builds before it. What cannot be read or
told (a missing file, a config that is no plain data) is not guessed: the game runs. A run that fails is never kept, a
watched run is never read or kept, and a hit leaves no game log (`work_dir` gets the recording and the files of
`script-output`).

- **Store:** `~/.cache/clock-generator/game-recordings/` (`$XDG_CACHE_HOME` is honoured), outside git and the temporary
  folder, so it survives a reboot. `CLOCK_RECORDING_CACHE_DIR=<folder>` puts it elsewhere. An entry unused for 30 days is
  removed when another is stored. Entries are compressed: the whole suite's 1,300 recordings take about 95 MB, the largest about 3 MB.
- **Cold run:** `CLOCK_RECORDING_CACHE=off` starts the game for every recording and keeps nothing; `=refresh` also starts the
  game for every recording and replaces what the store holds. Keep one cold pass per release. A value other than `on`,
  `off` and `refresh` counts as `off`.
- **Mechanics probes always use the cache.** They record again only when the game binary changes (its hash is in the key,
  so a new binary records them anyway). A cold or refresh run applies to `tests/game/builds` only; `scripts/game/run-suite.py`
  runs `tests/game/mechanics` with `CLOCK_RECORDING_CACHE=on` whatever `--cache` says.
- **What happened:** `CLOCK_RECORDING_CACHE_LOG=<file>` appends a line per recording: `hit`, `miss`, `stored`, `uncached`.
- **Opting out:** `cache: false` in the options of a run. `npm run record`, `scripts/record-clock.js`, `scripts/capture-probe.js` and
  `scripts/rule-count-game-check.js` do; `scripts/native/run-lane.sh` sets `CLOCK_RECORDING_CACHE=off` in record mode. A native
  check that proves a new clock in the game uses one of these.

A change to the key's inputs makes a miss, which runs the game as before and stores the result. The harness's sources are
part of the key, so a change to `src/harness/` starts every recording again; the files outside it that the harness depends on
are named in `HOST_SOURCES` (`factorio-harness.ts`), and a change elsewhere in the engine that alters what the harness
does needs a bump of `RECORDING_CACHE_PROTOCOL`.

## The whole suite on every lane

```bash
python3 scripts/game/run-suite.py                     # warm: recordings read from the cache where they exist
python3 scripts/game/run-suite.py --cache off         # a cold pass over tests/game/builds (mechanics stay on the cache)
python3 scripts/game/run-suite.py --plan car-clock    # the jobs and an estimate, nothing run
python3 scripts/game/run-suite.py tests/game/mechanics/drills grenade-clock    # only files whose path contains these
```

It lists the cases (`vitest list --json`), cuts them into jobs, orders the jobs longest first by the seconds each case took
last (`scripts/game/case-seconds.json`, a cold pass of 2026-11-02 with Factorio 2.1.24), and starts them through the guard
on `machine.factorio_max` lanes (`-j` to override; without the guard directory jobs start directly, two at a time). A case of
at least 120 seconds is a job of its own; shorter cases of one file share a job (`-t '^(a|b)$'`, one game at a time), so the
many probes of a few seconds do not each pay vitest's start-up. Any case may be cut from its neighbours: every case starts its own
game with `recordInFactorio`, or opens a `CachedHarnessSession` inside the one case that needs it (the staged-start tests), so no
recording key depends on another case. The runner never watches (`FACTORIO_HARNESS_WATCH` is cleared); watched `scaffold-recordings`
share one game and are run by hand. The result is one table for the run (`results.tsv`, `results.json`: passed, failed, skipped
or no result per case; the exit code is 0 only when every selected case passed), the cache events, `lanes.log` and, in
`durations.json`, the seconds of this run: copy it over `case-seconds.json` after a cold pass to keep the order current.

## Bounded parallel runs

The limits below are for runs by hand; runs through the guard are limited by `factorio_max` in its policy.

`npm run test:game` remains sequential. Independent controls for the same mechanics question may run in
separate headless processes at once, within the process limit below. A local check of two short belt-pickup controls (the turbo merge release-17 and
outlet cases, removed after commit `52b4e9f0`) passed both sequentially and concurrently, with distinct live
game/RCON ports and write-data directories. The pair took 5.17 seconds sequentially and 3.08 seconds
concurrently; this single comparison does not establish a benefit for larger worker counts or heavier builds.

Harness runs may use at most **four Factorio processes at once**, including any launched by other workers. A
watched run counts as two: its headless server and the graphical client that watches it. A game someone is
playing outside the harness is not counted and must never be closed. Select exact `-t` cases
in separate commands; do not enable an unbounded test sweep. The harness assigns ports and copies the save
and mods into each session's directory. Tests using `mkdtemp` already isolate those directories. For manual
captures, each worker must have a unique work directory and output path: preparation deletes the work
directory's `mods` and `script-output`. Never reuse an active session's directory.

Freeze shared fixtures, simulator code, Sidecar and recorder while comparative runs start and execute. One
coordinator owns common helpers, expectations, Git changes and conclusions; other workers run disjoint
controls or analyze their evidence. Build once before launching commands that use `dist`; do not run parallel
builds into the same checkout. Keep screenshots sequential because they use graphical clients and write the
shared screenshot catalog/provenance. Turn watching off for parallel headless runs.

Port discovery releases its socket before Factorio binds it, so a bind collision is an infrastructure failure,
not evidence about a mechanic. Check logs and retry that failed run with a fresh directory. Increase neither
the worker limit nor timeouts automatically when resource contention slows a run. Evaluate all controls
together before changing the simulator or moving to another mechanics question.

## Preserve a raw capture

The capture command builds the engine, reads `.env`, composes shared Lua with the scenario, and uses the same
backed-up blueprint transformation as the tests. Choose a new directory for each run:

```bash
npm run probe -- --fixture=same-item --geometry=underground-exit --out=.scratch/belt-pickup/same-item-run-01
npm run probe -- --fixture=backed-up --item=supercapacitor --geometry=underground-entrance --out=.scratch/belt-pickup/backed-up-run-01
```

Each directory contains `blueprint.txt`, `config.json`, `probe.generated.lua`, `recording.json`, and `game/`
with Factorio logs and `script-output/same-item-pickups.json` or `script-output/backed-up-pickups.json`.
The command refuses a nonempty output directory. The lower-level recorder CLI clears `script-output` when reusing
its work directory, so use new run directories there too.

The Lua probes clear machine inventories to isolate pickups. Their detailed reports measure pickup timing and lane
motion; use the build tests for production throughput/recovery. Probe ticks start when custom Lua is installed,
before any settling and final recorder start. Empty Lua arrays may serialize as `{}`.

Game tests clean up their own temporary recordings even on assertion failure, unless a capture folder is named:
`SCAFFOLD_CAPTURE_DIR` keeps each scaffold build's recording, the simulator's run of it, a meta file with the comparison
and the inserters' positions in the game, and the `*_CAPTURE_DIR` variables of the other tests keep theirs. Manual
captures retain artifacts; full raw captures belong under the ignored `clock-generator/.scratch/<topic>/<run>/`. Commit reproducible inputs, concise provenance and
small intentionally chosen evidence cuts only. Existing compact evidence under `src/state` and
`src/verification/fixtures` can remain beside its simulator tests.

## Add an experiment

Create a topic under `mechanics/` with its game test and a `fixtures/<case>/` bundle. Document the question,
config/scaffold correspondence, required version/research, interventions, commands, report schema and calibrated
limits. Add its paths to the internal helper, not `ConfigPaths`. Keep a simulator regression near the relevant code.
Use shared capture/snapshot functions and explicit scenario callbacks; preserve independently derived expectations.
Record measured conditions and unverified cases before describing a rule as verified. Clock-rate/recovery checks
belong in `builds/`, and can reuse the mechanic fixture without copying its scaffolds.

## Scaffold screenshots

Mechanic write-ups include native Factorio screenshots compressed to JPEG. These show the layout, rather than
the probe's exact starting state or evidence of a timing rule. The [catalog](mechanics/screenshots.json) names
the committed fixture blueprints and shared sample builds used by mechanics tests. No blueprints are duplicated.

From `clock-generator/`, with the same `.env` configuration as game tests:

```bash
npm run screenshots -- --list
npm run screenshots -- --case=front-underground-exit
npm run screenshots -- --all
```

The default captures only missing or stale images. It compares the blueprint SHA-256, JPEG quality, and capture
recipe with [generated provenance](mechanics/screenshots.generated.json); a current image skips Factorio entirely.
Use `--refresh` to force regeneration, or `--work-dir=.scratch/mechanics-screenshots/run-01` to retain raw output in
a chosen empty directory. The default work directory is a fresh timestamped folder under that same ignored path.

This requires the graphical Factorio executable and a desktop display: `game.take_screenshot` does nothing in a
headless process. The script opens its own harness client and closes it when finished, using copies of the save
and mods. A single server/client pair is reused across the selected images. It does not run test suites, search
for clocks, or wait for someone to close a game window.

Capture settings: the committed base blueprint, its clock disabled, no seeds, 600 warm-up ticks, entity info on,
no GUI/debug overlays, noon lighting, no clouds/fog, and antialiasing. Framing uses the actual built entity bounds
plus two tiles of margin, at up to 48 pixels/tile within 1920×1440. Factorio writes a PNG; Sharp converts it to a
quality-82 JPEG with 4:4:4 color sampling and MozJPEG compression, without resizing. Only JPEGs and provenance
belong in the repository. Native PNGs, the minimal harness recordings and logs stay in the ignored run directory.

For a new mechanic scaffold, add its blueprint and JPEG paths to the catalog, capture that case, inspect the image,
and embed it with a descriptive caption in the fixture/topic README. Local `mechanics/**/*.txt` blueprints must
have catalog entries; an offline helper test enforces this. Shared sample blueprints can have entries too, with
their images in `mechanics/images/` and links from each topic using them. Increment `CAPTURE_RECIPE` in the script
if changing framing or render defaults. Refresh after a Factorio graphics/version change even if blueprints match.

## Maintain an experiment

Read the affected topic and fixture READMEs before changing an experiment. Preserve measured assertions when moving
files or extracting helpers; changes to expected timing need evidence explaining the new expectation.

Shared Lua under `helpers/lua/` handles observation and bounded capture. Keep filtering, inventory clearing and
other interventions visible in the scenario. Use `composeProbeSource` to load shared helpers and JSON parameters
on the host; a scenario source file alone is not directly runnable through `--lua`.

One probe owns `script.on_nth_tick(1, ...)` per run and unregisters it on completion or callback failure. Registering
another handler for that slot replaces the first. Preserve the recorder's separate `on_tick` handler and distinguish
probe installation time from the final recording start when comparing samples.

Select affected files and, where useful, individual `-t` cases. File moves alone do not require every clock-recovery
or scaffold check. Shared capture changes need representative coverage of each consuming scenario; changes to
mechanic assertions may require the full relevant parameter matrix.
