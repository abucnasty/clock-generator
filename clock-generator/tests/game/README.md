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
npm test -- src/control-logic/inserter/modes/pickup/belt-lane-fallback.test.ts

# Individual mechanic checks; .env is loaded automatically.
npm run test:game -- tests/game/mechanics/belt-pickup/backed-up-pickup.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/same-item-pickup-fixture.game.test.ts

# A clock check narrowed to a case, rather than every scaffold/recovery scenario.
npm run test:game -- tests/game/builds/moving-pickup.game.test.ts -t 'straight-belt holds'
```

`npm test` excludes `*.game.test.ts`. `npm run test:generation` checks generated clocks in the simulator.
`npm run test:game` without a file runs the entire local game suite, serially, and can take many minutes.
Missing Factorio/save settings cause skips; a skipped test has not verified the game behavior.

For verification appropriate to other changes, see the [contributor guide](../../../CONTRIBUTING.md).

## Bounded parallel runs

The default game suite remains sequential. Independent controls for the same mechanics question may run in
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
npm run probe -- --fixture=same-item --geometry=underground-exit --out=../work/belt-pickup/same-item-run-01
npm run probe -- --fixture=backed-up --item=supercapacitor --geometry=underground-entrance --out=../work/belt-pickup/backed-up-run-01
```

Each directory contains `blueprint.txt`, `config.json`, `probe.generated.lua`, `recording.json`, and `game/`
with Factorio logs and `script-output/same-item-pickups.json` or `script-output/backed-up-pickups.json`.
The command refuses a nonempty output directory. The lower-level recorder CLI clears `script-output` when reusing
its work directory, so use new run directories there too.

The Lua probes clear machine inventories to isolate pickups. Their detailed reports measure pickup timing and lane
motion; use the build tests for production throughput/recovery. Probe ticks start when custom Lua is installed,
before any settling and final recorder start. Empty Lua arrays may serialize as `{}`.

Game tests clean up their own temporary recordings even on assertion failure. Manual captures retain artifacts;
full raw captures belong under ignored `work/<topic>/<run>/`. Commit reproducible inputs, concise provenance and
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
Use `--refresh` to force regeneration, or `--work-dir=../work/mechanics-screenshots/run-01` to retain raw output in
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
