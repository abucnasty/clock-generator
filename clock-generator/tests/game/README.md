# Game-backed verification

These tests compare the simulator and generated clocks with Factorio. They require a local Factorio installation;
ordinary CI runs simulator tests and type-checks this code without producing new game evidence.

- [Mechanic experiments](mechanics/): isolated game rules, with configs, scaffolds, probes and evidence scope.
- [Clock builds](builds/README.md): generated-clock throughput and recovery, often reusing ordinary samples.
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
