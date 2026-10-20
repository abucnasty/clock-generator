# Factorio Clock Generator

A TypeScript-based simulation and blueprint generation tool for Factorio that creates precise circuit-controlled production setups. This tool simulates machine crafting cycles, inserter timing, and generates blueprints with clock signals to ensure deterministic, perfectly-timed production systems.

## Purpose

This tool solves the challenge of creating perfectly synchronized production setups in Factorio by:

1. **Simulating** the exact behavior of machines, inserters, and belts tick-by-tick
2. **Analyzing** when inserters should be enabled/disabled to maintain stable production
3. **Generating** blueprints with decider combinators that provide clock signals to control inserters
4. **Optimizing** for minimal inserter swings while maximizing throughput

The generated blueprints use circuit network clocks to control when inserters are enabled, preventing common issues like:
- Machine inventory overflow/underflow
- Inserter timing conflicts
- Production instability and desynchronization
- Suboptimal throughput

## Installation

```bash
npm install
npm run build   # tsc, into dist/
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run build` | Compiles `src/` into `dist/` |
| `npm test` | The unit tests |
| `npm run test:typecheck` | Type-check simulator and game tests without running Factorio |
| `npm run probe -- --help` | Retained raw mechanic captures using shared Lua helpers |
| `npm run test:generation` | The generation tests (`*.generation.test.ts`): the clocks of whole samples, a few minutes |
| `npm run test:all` | Both |
| `npm run test:game -- <file>` | Selected game mechanic or clock-build checks; requires Factorio |
| `npm run test:game:watch` | Sample scaffold clock checks with the game open to watch |
| `npm run record` | Records a blueprint in a headless Factorio (see below) |
| `npm run verify` | Compares a recording with the simulator (see below) |

`record` and `verify` build first. Run either without arguments for its options.

The [contributor guide](../CONTRIBUTING.md) maps changes to relevant checks and explains where resources belong.
The [belt pickup documentation](docs/belt-pickup/README.md) groups the diagram glossary, timing reference,
experiment findings and capture rules. The [mechanics index](tests/game/mechanics/belt-pickup/README.md)
links the runnable fixtures and their detailed findings.

## Entries and the Game Data

The package has three entries (`exports` in `package.json`):

- `clock-generator` (`src/index.ts`): everything in the browser entry, for Node. Importing it makes the game data be
  read from `resources/data-filtered.json` on first use (`src/data/factorio-data-file.ts`).
- `clock-generator/browser` (`src/browser.ts`): the config schema and parsers, the generator, the blueprint encoding and
  the types, without Node built-ins. It does not read the game data: call `FactorioDataService.initialize(data)` with
  the contents of `data-filtered.json` (the UI fetches it) before generating.
- `clock-generator/light` (`src/light.ts`): the constants, status categories, clock ranking and `Option`, without the
  simulation, the game data or zod. The UI's main thread takes its values from here and only types from `browser`, so
  the generator is bundled once, in its web worker.

A file of your own under `src/` that imports modules directly, not through `index.ts`, imports
`./data/factorio-data-file` itself, as `verify-recording.ts` and `record-in-factorio.ts` do.

### Refreshing the game data

`resources/data-filtered.json` is cut from a data dump of the game by `resources/filter-raw.js`, and
`resources/data-version.json` beside it says which game made the dump (since 0.14.0: Factorio 2.1.21, build 87673; the
`npm run calls` header repeats it). To follow a new version of the game, with a locked install of that version (never
the one that is played; the install is not written to):

```bash
factorio --version                                        # the version line
factorio --config config.ini --mod-directory mods --dump-data
node resources/filter-raw.js --dump=<write-data>/script-output/data-raw-dump.json --version="Version: 2.1.21 (build 87673, linux64, full)"
```

`config.ini` names the install's `data` folder as `read-data` and a scratch folder as `write-data`, and `mods/mod-list.json`
enables the mods that ship with the game (every folder beside `base` in `data`: space-age, quality, elevated-rails,
recycler), the way the harness sets a game up (`src/harness/factorio-harness.ts`). The dump itself is not committed.
Factorio 2.1 renamed the ore melting recipes (`iron-ore-melting`, `copper-ore-melting`) and gives a recipe a list of
crafting categories; the filter writes that list for any version of the dump.

## Usage

### Basic Usage

1. Choose or create a configuration file in `resources/config-samples/` (JSON)
2. Open it in the UI (`clock-generator-ui`), or generate its clock with the library in a file of your own under `src/`:

```typescript
import './data/factorio-data-file';
import { loadConfigFromFile } from './config/loader';
import { ConfigPaths } from './config/config-paths';
import { generateClockForConfig, blueprintFileFor } from './crafting/generate-blueprint';
import { encodeBlueprintFile } from './blueprints/serde';

async function main() {
    const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_SHARED_INSERTER);
    const result = generateClockForConfig(config);
    console.log(encodeBlueprintFile(blueprintFileFor(result)));
}

main().catch(console.error);
```

3. Build and run it:

```bash
npx tsc && node dist/<your file>.js
```

4. Copy the output blueprint string and import it into Factorio

### Configuration Format

Configuration files are JSON. The samples live in `resources/config-samples/`, grouped by what they make, one folder per
build, each holding the config(s) of that build and, where one exists, its scaffold: a blueprint of one copy of the
build without a clock, for recording it in the game.

- `science/`: automation, logistic, chemical, production, utility, agriculture, metallurgic, electromagnetic and military science
- `intermediates/`: advanced circuit, processing units, flying robot frame, lithium plates, electric engine unit, productivity module, low density structure, accumulator
- `gleba/`: rocket fuel from jelly, jellynut processing, biochamber fuel, iron bacteria cultivation
- `smelting/`: stone bricks, electric furnace

`src/config/config-paths.ts` names every sample.

A config describes one copy of a build, and `target_output.copies` says how many identical copies stand side by side:
the generator plans one and multiplies its rate. The copies are assumed identical, with no inserter from one to another,
and the belts shared between them. A config that itself holds several identical copies (the same machines and
inserters written out twice or more, joined by no inserter) is refused and told to describe one copy and set `copies`
(`src/config/copies-validator.ts`). Describe the smallest repeating unit of a build, not a whole block of it.
`copies` may be fractional, such as 5.5: the build then holds a partial block, and its rate is planned as that fraction of
one block's (5.5 copies of a block of 4 assemblers making 240 a second means one block makes 480/11 a second). The unit
itself is still whole, with identical units, no inserter between them and shared belts. The number is read as an exact
fraction, so it must be a whole number or a short decimal (a reduced denominator of at most 1000); 0.3333333333333333 is
refused.

### Configuration Example (JSON)

Here is a complete configuration for a utility science pack setup. Recipe names are Factorio recipe names; a machine's crafting speed comes from hovering it in Factorio and running `/c game.print(game.player.selected.crafting_speed)`, or from the sidecar mod.

```json
{
  "belts": [
    {
      "id": 1,
      "lanes": [
        {
          "ingredient": "low-density-structure",
          "stack_size": 4
        },
        {
          "ingredient": "processing-unit",
          "stack_size": 4
        }
      ],
      "type": "turbo-transport-belt"
    },
    {
      "id": 2,
      "lanes": [
        {
          "ingredient": "low-density-structure",
          "stack_size": 4
        },
        {
          "ingredient": "flying-robot-frame",
          "stack_size": 4
        }
      ],
      "type": "turbo-transport-belt"
    }
  ],
  "inserters": [
    {
      "filters": [
        "low-density-structure",
        "processing-unit"
      ],
      "sink": {
        "id": 1,
        "type": "machine"
      },
      "source": {
        "id": 1,
        "type": "belt"
      },
      "stack_size": 16
    },
    {
      "filters": [
        "low-density-structure",
        "flying-robot-frame"
      ],
      "sink": {
        "id": 1,
        "type": "machine"
      },
      "source": {
        "id": 2,
        "type": "belt"
      },
      "stack_size": 16
    },
    {
      "filters": [
        "utility-science-pack"
      ],
      "sink": {
        "id": 1,
        "type": "belt"
      },
      "source": {
        "id": 1,
        "type": "machine"
      },
      "stack_size": 16
    }
  ],
  "machines": [
    {
      "crafting_speed": 68.90625,
      "id": 1,
      "productivity": 100,
      "recipe": "utility-science-pack"
    }
  ],
  "target_output": {
    "copies": 7,
    "items_per_second": 120,
    "recipe": "utility-science-pack"
  }
}
```

## How It Works

### Three-Phase Simulation Process

The `generateClockForConfig` function executes three distinct steps:

#### 1. **Prepare Phase**
- Simulates until all machines reach output-blocked state
- Establishes steady-state inventory levels
- Determines the crafting cycle baseline

#### 2. **Warmup Phase**
- Runs the simulation for multiple cycles with clock controls enabled
- Ensures the system reaches a stable, repeating state
- Validates that the timing windows are correct

#### 3. **Simulate Phase**
- Records the exact tick ranges when each inserter transfers items
- Captures a complete production cycle
- Generates timing data for the clock signals

### Output

The tool generates a Factorio blueprint containing:
- **Decider combinators** that act as clock signals
- **Timing ranges** for each inserter (when they should be enabled)

## Advanced Configuration

### Inserter Prototype, Quality and Hand

An inserter is a legendary stack inserter with a hand of 16 unless its config says otherwise. Three optional fields
change that:

- `prototype`: the inserter's name in the game data, `"inserter"`, `"fast-inserter"`, `"long-handed-inserter"`,
  `"bulk-inserter"` or `"stack-inserter"` (the default). The burner inserter needs fuel and is refused, as is a name
  that is not an inserter of the game data.
- `quality`: `"normal"`, `"uncommon"`, `"rare"`, `"epic"` or `"legendary"` (the default). A better quality turns the arm
  faster; it does not change the hand.
- `stack_size`: the items in the hand. Without it the hand is what all the research gives the prototype: 16 for a stack
  inserter, 12 for a bulk inserter, 4 for the others. With it, it overrides that, as when a technology is not researched.

The swing comes from the game data (`inserter` and `quality` in `data-filtered.json`): the arm turns each way for
`ceil(0.5 / ω) - 2` ticks, where ω is the prototype's `rotation_speed` times 1 + 0.3 times the quality's level (normal
0, uncommon 1, rare 2, epic 3, legendary 5), and picking up from or dropping into a machine or chest takes 1 tick. The
swing from machine to machine is 8 ticks for a legendary stack inserter, 24 for a normal fast inserter and 70 for a
normal inserter. Picking up from a belt (4 ticks) is calibrated on the legendary stack inserter alone, so a belt pickup
by any other prototype or quality is refused (follow-up F7). Dropping onto a belt keeps the legendary stack inserter's
timing, which is not checked for the others. The simulator also gives every inserter the stack inserter's wait for a
full hand, which the other prototypes do not have in the game.

`filters` are the items the inserter moves, a whitelist. An optional `filter_mode` says so with `"whitelist"`; a
`"blacklist"`, naming the items to leave, is refused when there are filters. The Clock Generator Sidecar exports the
prototype, the quality and a blacklist from 0.11.0 on.

```json
{
  "source": { "id": 1, "type": "machine" },
  "sink": { "id": 2, "type": "machine" },
  "prototype": "fast-inserter",
  "quality": "normal"
}
```

### Mining Drill Support

For direct-insertion mining setups. A drill's `speed_bonus` comes from `/c game.print(game.player.selected.speed_bonus)`:

```json
"drills": {
  "mining_productivity_level": 50,
  "configs": [
    {
      "id": 1,
      "type": "electric-mining-drill",
      "mined_item_name": "stone",
      "speed_bonus": 2.5,
      "target": { "type": "machine", "id": 1 }
    }
  ]
}
```

### Chest Buffering Support

Chests can be used as intermediate buffers between inserters. This is useful when you want to accumulate items before an inserter picks them up, or when inserters need to partially drop items due to capacity constraints.

#### Basic Chest Configuration

A buffer chest has a number of inventory slots (`storage_size`) and the one item it takes (`item_filter`):

```json
"chests": [
  { "type": "buffer-chest", "id": 1, "storage_size": 1, "item_filter": "iron-ore" }
]
```

#### Infinity supplies and disposal

Infinity chest filters maintain constant configured quantities. To remove all incoming items without supplying any,
leave the filters empty and enable `remove_unfiltered_items`:

```json
{ "type": "infinity-chest", "id": 1, "item_filter": [], "remove_unfiltered_items": true }
```

With filters and removal enabled, configured items remain constant supplies and other incoming items are discarded.
With removal omitted or false, the existing filtered-supply model is unchanged; unfiltered items are not accepted.
The model does not implement Factorio's separate at-least/at-most filter modes. An empty receiving chest with removal
disabled produces a configuration error instead of a failed simulation. Disposal-only chests never supply ingredients.

#### Using Chests with Inserters

Reference chests in inserter source/sink configurations:

```json
"inserters": [
  {
    "source": { "type": "machine", "id": 1 },
    "sink": { "type": "chest", "id": 1 },
    "stack_size": 16
  },
  {
    "source": { "type": "chest", "id": 1 },
    "sink": { "type": "machine", "id": 2 },
    "stack_size": 16
  }
]
```

### Nearest Belt Lane

An inserter that takes two items off one belt takes from the lane nearest to it first, whenever its machine takes
both. Which item that is can decide whether a clock holds: on the utility science sample it sets how the low density
structures are split between the two inserters that bring them. Name the lane with `near_lane` on the inserter's
source, 1 or 2 by its place in the belt's `lanes`:

```json
{
  "source": { "type": "belt", "id": 2, "near_lane": 1 },
  "sink": { "type": "machine", "id": 1 },
  "stack_size": 16
}
```

The sidecar mod exports it for an inserter beside a straight piece of belt, and the inserter's panel in the UI has a
field for it. Without it the items are taken in the order of the inserter's `filters`, or of the machine's
ingredients when it has none.

### Enable Control Overrides

You can override the automatic enable control logic for individual inserters and drills. This is useful when you want to manually specify when an entity should be enabled during the crafting cycle.

#### Available Modes

| Mode | Description |
|------|-------------|
| `AUTO` | Use automatic control logic (default behavior) |
| `ALWAYS` | Entity is always enabled, and gets no combinator in the blueprint |
| `NEVER` | Entity is never enabled |
| `CLOCKED` | Entity is enabled during specified tick ranges |
| `CONDITIONAL` | Entity is enabled while a rule set (`rule_set`, with an optional `latch`) holds |

#### Inserter Override Example

Both overrides are optional; `period_duration_ticks` defaults to the crafting cycle duration.

```json
{
  "source": { "type": "belt", "id": 1 },
  "sink": { "type": "machine", "id": 1 },
  "stack_size": 16,
  "overrides": {
    "animation": { "pickup_duration_ticks": 15 },
    "enable_control": {
      "mode": "CLOCKED",
      "ranges": [
        { "start": 0, "end": 100 },
        { "start": 200, "end": 300 }
      ],
      "period_duration_ticks": 500
    }
  }
}
```

#### Drill Override Example

```json
"drills": {
  "mining_productivity_level": 50,
  "configs": [
    {
      "id": 1,
      "type": "electric-mining-drill",
      "mined_item_name": "iron-ore",
      "speed_bonus": 0.5,
      "target": { "type": "machine", "id": 1 },
      "overrides": { "enable_control": { "mode": "ALWAYS" } }
    }
  ]
}
```

#### Mode Details

**AUTO (default)**: The simulation determines optimal enable windows automatically. This is the recommended mode for most setups.

**ALWAYS**: The entity is always enabled. Use this when you want the entity to operate freely without clock control. It gets no clock windows and no combinator in the blueprint, also when it only fills a fuel slot or takes a by-product away, and every clock is checked with it always enabled. An always-enabled inserter is woken at every craft of the machine it waits on, which shows in the wake-ups of the clock.

**NEVER**: The entity is never enabled. Useful for debugging or temporarily disabling an entity.

**CLOCKED**: The entity is enabled only during specified tick ranges within the period. Each range has:
- `start`: The tick when the entity becomes enabled (inclusive)
- `end`: The tick when the entity becomes disabled (inclusive)
- `period_duration_ticks` (optional): The period length in ticks. If not specified, uses the crafting cycle duration.

For a moving belt input, set `pickup_length` on the inserter's `source`: `1` for the exposed line on a straight
belt or `0.5` at either underground endpoint. Sidecar 0.9.0 exports this automatically for inserters beside those
pieces. Omitted `pickup_length` defaults to `1`, including in older configs. Moving supply uses reachable-stack
timing; `overrides.backed_up_belts: true` selects backed-up supply independently of the physical geometry. See [pickup timing](docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).

### Configuration Overrides

- `terminal_swing_count`: force the output swings per cycle, instead of the count the plan works out
- `lcm`: override the LCM calculation for the cycle length
- `backed_up_belts`: items back up at the input pickups and upstream supply refills the gaps, making one stack available each pickup tick (default false)
- `search_for_fewer_wake_ups`: run the four searches for every build (default false)
- `check_start_dependence`: try every clock from other starts than the cold start too, and name the clocks that reach their target from some starts only (default false; see `docs/stability.md`, "Start dependence")
- `loop_seed_items`: items a machine that makes its own ingredient (pentapod eggs) is given once when a clock starts (default 200, as the harness seeds)

`src/config/schema.ts` (`ConfigOverridesSchema`) lists the others. Older files using `non_moving_belts` migrate to
`backed_up_belts` on import; if both are present, `backed_up_belts` takes precedence. New configs and exports use
only `backed_up_belts`.

```json
"overrides": {
  "terminal_swing_count": 4,
  "lcm": 12,
  "backed_up_belts": true,
  "search_for_fewer_wake_ups": true
}
```

#### The belt a clock is made for

The simulator assumes saturated input supply. Moving supply times the stacks within reach; backed-up supply makes one stack available each eligible pickup tick. An inserter changes its tick timing when the items on the belt are moving, and more so when the belt has gaps, so a clock that is exact on a backed-up belt can switch an inserter off holding a partial hand on a moving one.

Every potential clock names the belt it is made for:

- **moving**: each window of an inserter that picks up from a belt stays open a few ticks longer, long enough for one more full hand at one belt stack a tick (`+4 ticks` for a hand of 16 from stacks of 4). This is belt pickup slack: extra margin for late pickups on top of the simulated reachable-stack timing. Sparse upstream supply is not simulated.
- **backed-up belt**: the belt inserters get only the windows they need with backed-up supply at the pickup. "Batched swings, backed-up belt" is made this way on purpose; other clocks drop the slack when they do not hold the expected output with it. A clock with a period that is not a whole number of ticks (a subtick clock) never gets the slack, and is not ranked behind other clocks for it.

By default a backed-up belt clock is only selected for you when no clock for a moving belt holds the target rate. Set `backed_up_belts: true` (the Belts section's "Backed up" answer in the UI) when your belts are backed up: each clock is made without the slack, and the one with the fewest wake-ups is selected. A clock that does not hold the expected output that way is first made again with room for a hand of fuel: each window of an inserter that takes fuel off the belt as well as an ingredient stays open the ticks a hand of fuel takes to fill (`+4 ticks` for a hand of 16 from stacks of 4), because the fuel slot asks for a hand at any tick, ahead of the hands the window is planned for. That is still a backed-up belt clock, and its description names the inserters. A clock that does not hold with the room either, or has no such inserter, is listed as unstable: it is not made again with the slack. Of the samples, agricultural science selects its batched swings with room for a hand of fuel.

#### Searching for fewer wake-ups

Four of the potential clocks are found by a search, which tries many clocks in the simulator: observed windows, uneven output swings, shifted swings and full-hand output swings. Together they take most of the time of a generation. The other potential clocks are made straight from the plan: batched swings, fractional swings and the other output swing counts.

By default the searches only run when none of the clocks made without one can be selected as stable: one that holds the target rate, gets back to it after a backpressure loss and is made for the belt the config asks for. Then a search is the only way left to a stable clock, and all four run. Where a clock made without a search is stable, the searches are left out, and the generator says which.

A search can still find a stable clock with fewer wake-ups than the one selected. Set `search_for_fewer_wake_ups: true` ("Search for fewer wake-ups" in the UI) to run the searches for every build and have the clock with the fewest wake-ups selected among all of them.

## Troubleshooting

### Common Issues

**Issue**: Generated blueprint doesn't work in-game
- Verify your crafting speed and productivity match in-game values exactly
- Check that stack inserter capacity bonuses are correct
- Ensure belt configuration matches your actual setup

**Issue**: Simulation takes too long
- Reduce the number of machines in your configuration
- Check for configuration errors causing infinite loops
- Ensure ingredients are available on belts

**Issue**: Node runs out of memory ("JavaScript heap out of memory") on a large build
- Describe the smallest repeating unit of the build and set `copies`, as above; a whole block of hundreds of inserters
  needs memory for every one of them
- A chain with no repeating unit can be given a larger heap: `NODE_OPTIONS=--max-old-space-size=8192 npm run calls -- --sample=...`
  (8 GB; the same variable works for any `node dist/...` script and the tests). The largest sample, low density
  structure with 15 inserters, peaks at the figure in the 0.14.0 pull request on the default heap

**Issue**: Unstable production in-game
- Review console output for stability warnings
- Consider adjusting configuration parameters

## Development

### Project Structure

```
src/
├── index.ts          # Node entry: the browser entry plus the game data from resources/
├── browser.ts        # Browser entry
├── light.ts          # Light entry: constants, status categories, clock ranking
├── record-in-factorio.ts # npm run record
├── verify-recording.ts   # npm run verify
├── common/           # Shared constants (entity types, enable control types), logger
├── config/           # Configuration loading and validation
│   ├── schema.ts     # Zod schemas for config validation
│   ├── loader.ts     # config file loader (Node)
│   ├── config-browser.ts # config parsers without Node built-ins
│   └── config-paths.ts # Path constants for sample configs
├── data/             # The game data: FactorioDataService, and factorio-data-file.ts that reads resources/
├── crafting/         # Core simulation and blueprint generation
│   ├── plan/         # The planning run
│   ├── candidates/   # The clocks made from another clock, and their search
│   ├── runner/       # Step-based execution framework
│   └── sequence/     # Simulation logic and interceptors
├── control-logic/    # Entity behavior and state machines
├── entities/         # Machine, inserter, belt, chest and drill models
├── state/            # Entity states and status categories
├── blueprints/       # Blueprint encoding/decoding
├── harness/          # Running a build in a headless Factorio (record, test:game)
└── verification/     # Comparing a recording with the simulator (verify)

resources/
├── data-filtered.json # The game data, and under `names` the in-game English names of its items and recipes
├── filter-raw.js     # Makes data-filtered.json from `factorio --dump-data` and the game's locale (FACTORIO_DATA_DIR)
├── clock_generator_staging.zip # The save test:game builds in
└── config-samples/   # sample configurations and scaffolds, by build
```

### Running Tests

```bash
npm test                 # the unit tests: under a minute
npm run test:generation  # the generation tests: the clock alternatives of whole samples, a few minutes
npm run test:all         # both
```

The generation tests are the files named `*.generation.test.ts`. They generate every clock alternative of a sample and check what is selected, so they take as long as the slowest sample (most of it one test of agricultural science). Pull requests run the unit tests; pull requests to master run the generation tests too (`.github/workflows/test.yml`). Run `npm run test:all` before opening one.

### Recording a Build in Factorio

`npm run record` starts a headless Factorio on a copy of a save, builds a blueprint in it, records it with the recorder mod of this repository and writes a recording that `npm run verify` reads. No game window and no player are needed.

```bash
export FACTORIO_PATH=~/Games/factorio          # executable or install folder, or --factorio=
export FACTORIO_HARNESS_SAVE=~/saves/test.zip  # or --save=
npm run record -- --blueprint=build.txt --out=recording.json --ticks=3600 --warmup=300 \
    --seed='[{"target":{"recipe":"pentapod-egg"},"item":"pentapod-egg","count":200}]' \
    --clock=clock-blueprint.txt --config=config.json
```

- `--seed` adds items right before the recording starts. `target` picks the built entities by `name`, `type`, `recipe` or `unit_number`; `inventory` is `input`, `output`, `fuel`, `modules` or `chest`, and by default wherever the entity takes the item. `count` is per entity, and per lane for belts.
- `--clock` replaces the clock the build came with: its combinators are built below the build and wired to the inserters their descriptions name. The inserters are found by matching the build to `--config`, the config the clock was generated from. Belt inserters are matched by what lies on their belt, so give belts a `--warmup` to fill.
- `--unclocked` removes the build's clock and lets its inserters run freely. Without either, the build is recorded as it is.
- `--settle` runs the build for a number of ticks on its new clock and seeds before the recording starts, so its start-up is not counted.
- `--lua` runs a Lua chunk right before the recording starts, called with `(entities, surface, area)`, for anything a seed cannot express.
- `--watch` also opens the game with graphics, joined to the run as a spectator over the build. The game then runs at speed 1 unless `--speed` says otherwise, and the run ends when that window is closed. Whoever watches is an admin of the game, with alt mode on, and the game shows the FPS/UPS counter and the wake-up lists (`show-fps` and `show-wakeup-lists`, set to always, so debug mode need not be on).

The save is never written to; Factorio gets a temporary write-data folder (`--work-dir` keeps it). The save needs a place where the blueprint can be built and powered, such as an editor map with a global electric network. Run `npm run record` without arguments for all options.

### Recording the Samples: `npm run test:game`

Game-backed verification is organized under [`tests/game`](tests/game/README.md): isolated mechanic experiments
and generated-clock build checks have separate locations. `npm run test:game -- <file>` runs selected local Factorio
checks, while `npm run test:typecheck` checks their code without Factorio. CI runs simulator unit/generation tests
and type-checks the game tests; it does not collect new game evidence. Use `npm run probe -- ...` to retain a raw
pickup capture, with shared helpers composed automatically. The guide lists prerequisites, commands and scope.

Copy `.env.example` to `.env` and set `FACTORIO_PATH` to your Factorio executable or install folder; `vitest.game.config.ts` loads it automatically, so `npm run test:game` picks it up without exporting anything by hand. `FACTORIO_HARNESS_SAVE` already defaults to the staging save committed at `resources/clock_generator_staging.zip`. `.env` is not read by `npm run record` or `npm run verify`, which still take `FACTORIO_PATH`/`FACTORIO_HARNESS_SAVE` from the shell environment or `--factorio=`/`--save=`.

`npm run test:game:watch` runs the scaffold-recordings suite with the game also open with graphics, joined as a spectator over the build, to watch them. All builds then run in one game, each built in the place of the one before it, so there is one window and the game with graphics starts once; it closes by itself after the last build. The builds run at `WATCH_SPEED` (in `tests/game/builds/scaffold-recordings.game.test.ts`) instead of the 1000 they run at unwatched, slow enough to follow over a remote connection. That speed is only where the first build starts: whoever watches is an admin of the game, so they can set its speed (`/c game.speed = 16`), pause it or open the editor (`/editor`) for its time controls, and the builds after keep what they set. Close the window early and the builds left run unwatched at full speed. Narrow it to some builds with `npm run test:game:watch -- -t "automation science"`. Without `:watch` every build still gets a game of its own, so it starts from the save as it is.

### Verifying a Recording

`npm run verify` lays a recording against the simulator. It generates the clocks of the config, runs the one that was built on its own in the simulator, as its blueprint runs it in the game, and compares that run with the recording. The run is written in the format of the recorder, so both are read by the same functions (`src/verification/compare-recordings.ts`).

```bash
npm run verify -- --config=config.json --recording=recording.json [--alternative=planned-belt-slack]
```

- `--alternative` names the clock that was recorded, by its id, label or index in the list of potential clocks. Without it, the clock the generator selects is taken.
- `--overrides` merges config overrides (JSON) into the config, e.g. the swing count of the clock that was built; `--items-tolerance` and `--state-agreement` set how close the two have to be. Run `npm run verify` without arguments for the defaults.
- The report gives, game against simulator: the output of every clock period, the wake-ups a minute, what every inserter moved and every machine finished in a period, and how much of the time each showed the same state at the same place in the period. A build that takes several periods to repeat, or a loop of machines the clock does not hold to a place in the period, shows other states at the same place without being any different, so that figure comes with how alike the two are wherever in the period.
- It exits with 1 when the two moved something else: a clock period off the expected output, an inserter or a machine that moves another amount in a period, or a recorded clock that is not the clock of the config. States that differ are listed and do not fail it.
- A build with fuel is also checked for the fuel its machines burned against the energy consumption of the config, and its fuel inserters against their fuel clocks.

`npm run test:game` makes the same comparison for every scaffold it records.


### Configuration Validation

Configurations are validated at runtime using [Zod](https://zod.dev/) schemas. If you provide an invalid configuration, you'll get detailed error messages:

```typescript
import { parseConfig } from './config/loader';
import { ConfigValidationError } from './config/errors';

try {
    const config = await parseConfig(jsonString);
} catch (error) {
    if (error instanceof ConfigValidationError) {
        console.error(error.getFormattedIssues());
        // Output: target_output.items_per_second: Invalid input: expected number, received string (expected number)
    }
}
```

### Browser Compatibility

The browser entry works without Node built-ins. It does not read the game data itself, so initialize it first:

```typescript
import { FactorioDataService, parseConfigFromJson, generateClockForConfig } from 'clock-generator/browser';

FactorioDataService.initialize(await (await fetch('/data-filtered.json')).json());
const config = parseConfigFromJson(await (await fetch('/my-config.json')).text());
const result = generateClockForConfig(config);
```


## License

MIT, see [LICENSE](../LICENSE).
