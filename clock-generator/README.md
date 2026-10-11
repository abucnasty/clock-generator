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
```

## Usage

### Basic Usage

1. Choose or create a configuration file in `resources/config-samples/` (JSON)
2. Update `src/multi-machine-poc.ts` to use your desired config:

```typescript
import { loadConfigFromFile } from './config/loader';
import { ConfigPaths } from './config/config-paths';
import { DebugSettingsProvider } from './crafting/sequence/debug/debug-settings-provider';
import { generateClockForConfig } from './crafting/generate-blueprint';
import { encodeBlueprintFile } from "./blueprints/serde";

async function main() {
    // Load a configuration file
    const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_SHARED_INSERTER);

    const debug = DebugSettingsProvider.mutable();
    const result = generateClockForConfig(config, debug);

    console.log("----------------------");
    console.log(encodeBlueprintFile({
        blueprint: result.blueprint
    }));
}

main().catch(console.error);
```

3. Run the generator:

```bash
npm run dev
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

### Mining Drill Support

For direct-insertion mining setups:

```typescript
drills: {
    mining_productivity_level: 50,
    configs: [
        {
            id: 1,
            type: "electric-mining-drill",
            mined_item_name: "stone",
            speed_bonus: 2.5,  // Get from: /c game.print(game.player.selected.speed_bonus)
            target: { type: "machine", id: 1 }
        }
    ]
}
```

### Chest Buffering Support

Chests can be used as intermediate buffers between inserters. This is useful when you want to accumulate items before an inserter picks them up, or when inserters need to partially drop items due to capacity constraints.

#### Basic Chest Configuration

```conf
chests = [
    {
        id = 1
        storage_size = 1        # Number of inventory slots
        item_filter = "iron-ore" # Single item type allowed in this chest
    }
]
```

#### Using Chests with Inserters

Reference chests in inserter source/sink configurations:

```conf
inserters = [
    # Inserter dropping items into a chest buffer
    {
        source { type = "machine", id = 1 }
        sink { type = "chest", id = 1 }
        stack_size = 16
    },
    # Inserter picking up items from the chest buffer
    {
        source { type = "chest", id = 1 }
        sink { type = "machine", id = 2 }
        stack_size = 16
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

#### Inserter Override Example

```conf
inserters = [
    {
        source { type = "belt", id = 1 }
        sink { type = "machine", id = 1 }
        stack_size = 16
        overrides {
            # Animation timing overrides (optional)
            animation {
                pickup_duration_ticks = 15
            }
            # Enable control override (optional)
            enable_control {
                mode = "CLOCKED"
                ranges = [
                    { start = 0, end = 100 },
                    { start = 200, end = 300 }
                ]
                # Optional: custom period duration (defaults to crafting cycle duration)
                period_duration_ticks = 500
            }
        }
    }
]
```

#### Drill Override Example

```conf
drills {
    mining_productivity_level = 50
    configs = [
        {
            id = 1
            type = "electric-mining-drill"
            mined_item_name = "iron-ore"
            speed_bonus = 0.5
            target { type = "machine", id = 1 }
            overrides {
                enable_control { mode = "ALWAYS" }
            }
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

### Configuration Overrides

```typescript
overrides: {
    terminal_swing_count: 4,    // Force the output swings per cycle, instead of the count the plan works out
    lcm: 12,                    // Override LCM calculation for cycle length
    non_moving_belts: true      // The belts the inserters pick up from do not move (default false)
}
```

#### The belt a clock is made for

The simulator's belts are always full and do not move. An inserter changes its tick timing when the items on the belt are moving, and more so when the belt has gaps, so a clock that is exact on a non-moving belt can switch an inserter off holding a partial hand on a moving one.

Every potential clock names the belt it is made for:

- **moving**: each window of an inserter that picks up from a belt stays open a few ticks longer, long enough for one more full hand at one belt stack a tick (`+4 ticks` for a hand of 16 from stacks of 4). This is belt pickup slack. It is a rule of thumb, not a simulated moving belt: it may work on one build and not on another.
- **non-moving belt**: the belt inserters get only the windows they need on a full belt that does not move. "Batched swings, non-moving belt" is made this way on purpose; other clocks drop the slack when they do not hold the expected output with it. A clock with a period that is not a whole number of ticks (a subtick clock) never gets the slack, and is not ranked behind other clocks for it.

By default a non-moving belt clock is only selected for you when no clock for a moving belt holds the target rate. Set `non_moving_belts: true` ("Belts do not move" in the UI) when your belts are backed up and standing still: each clock is made without the slack, and the one with the fewest wake-ups is selected. A clock that does not hold the expected output that way is first made again with room for a hand of fuel: each window of an inserter that takes fuel off the belt as well as an ingredient stays open the ticks a hand of fuel takes to fill (`+4 ticks` for a hand of 16 from stacks of 4), because the fuel slot asks for a hand at any tick, ahead of the hands the window is planned for. That is still a non-moving belt clock, and its description names the inserters. A clock that does not hold with the room either, or has no such inserter, is listed as unstable: it is not made again with the slack. Of the samples, agricultural science selects its batched swings with room for a hand of fuel.

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

**Issue**: Unstable production in-game
- The tool automatically detects fast-crafting instability (threshold: 3.0)
- Review console output for stability warnings
- Consider adjusting configuration parameters

## Development

### Project Structure

```
src/
├── common/           # Shared constants (entity types)
├── config/           # Configuration loading and validation
│   ├── schema.ts     # Zod schemas for config validation
│   ├── loader.ts     # config file loader
│   ├── config-paths.ts # Path constants for sample configs
│   └── examples.ts   # Legacy TypeScript config examples
├── crafting/         # Core simulation and blueprint generation
│   ├── runner/       # Step-based execution framework
│   └── sequence/     # Simulation logic and interceptors
├── control-logic/    # Entity behavior and state machines
├── entities/         # Machine, inserter, and belt models
├── blueprints/       # Blueprint encoding/decoding
└── types/            # Custom type declarations

resources/
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

`npm run test:game` records the scaffold builds under `resources/config-samples` the same way and checks that the clock the generator selects moves the expected output in every clock period of ten minutes of game time (`src/harness/scaffold-recordings.game.test.ts`). It needs `FACTORIO_PATH` and `FACTORIO_HARNESS_SAVE`, skips with the reason when they are missing, and is not part of `npm test`, since each recording takes about ten seconds in a game of its own.

Copy `.env.example` to `.env` and set `FACTORIO_PATH` to your Factorio executable or install folder; `vitest.game.config.ts` loads it automatically, so `npm run test:game` picks it up without exporting anything by hand. `FACTORIO_HARNESS_SAVE` already defaults to the staging save committed at `resources/clock_generator_staging.zip`. `.env` is not read by `npm run record` or `npm run verify`, which still take `FACTORIO_PATH`/`FACTORIO_HARNESS_SAVE` from the shell environment or `--factorio=`/`--save=`.

`npm run test:game:watch` runs the same tests with the game also open with graphics, joined as a spectator over the build, to watch them. All builds then run in one game, each built in the place of the one before it, so there is one window and the game with graphics starts once; it closes by itself after the last build. The builds run at `WATCH_SPEED` (in `src/harness/scaffold-recordings.game.test.ts`) instead of the 1000 they run at unwatched, slow enough to follow over a remote connection. That speed is only where the first build starts: whoever watches is an admin of the game, so they can set its speed (`/c game.speed = 16`), pause it or open the editor (`/editor`) for its time controls, and the builds after keep what they set. Close the window early and the builds left run unwatched at full speed. Narrow it to some builds with `npm run test:game:watch -- -t "automation science"`. Without `:watch` every build still gets a game of its own, so it starts from the save as it is.
- `--lua` runs a Lua chunk right before the recording starts, called with `(entities, surface, area)`, for anything a seed cannot express.
- `--watch` also opens the game with graphics, joined to the run as a spectator over the build. The game then runs at speed 1 unless `--speed` says otherwise, and the run ends when that window is closed. Whoever watches is an admin of the game, with alt mode on, and the game shows the FPS/UPS counter and the wake-up lists (`show-fps` and `show-wakeup-lists`, set to always, so debug mode need not be on).

The save is never written to; Factorio gets a temporary write-data folder (`--work-dir` keeps it). The save needs a place where the blueprint can be built and powered, such as an editor map with a global electric network. Run `npm run record` without arguments for all options.

### Verifying a Recording

`npm run verify` lays a recording against the simulator. It generates the clocks of the config, runs the one that was built on its own in the simulator, as its blueprint runs it in the game, and compares that run with the recording. The run is written in the format of the recorder, so both are read by the same functions (`src/verification/compare-recordings.ts`).

```bash
npm run verify -- --config=config.json --recording=recording.json [--alternative=planned-belt-slack]
```

- `--alternative` names the clock that was recorded, by its id, label or index in the list of potential clocks. Without it, the clock the generator selects is taken.
- The report gives, game against simulator: the output of every clock period, the wake-ups a minute, what every inserter moved and every machine finished in a period, and how much of the time each showed the same state at the same place in the period. A build that takes several periods to repeat, or a loop of machines the clock does not hold to a place in the period, shows other states at the same place without being any different, so that figure comes with how alike the two are wherever in the period.
- It exits with 1 when the two moved something else: a clock period off the expected output, an inserter or a machine that moves another amount in a period, or a recorded clock that is not the clock of the config. States that differ are listed and do not fail it.
- A build with fuel is also checked for the fuel its machines burned against the energy consumption of the config, and its fuel inserters against their fuel clocks.

`npm run test:game` makes the same comparison for every scaffold it records.


### Configuration Validation

Configurations are validated at runtime using [Zod](https://zod.dev/) schemas. If you provide an invalid configuration, you'll get detailed error messages:

```typescript
import { parseConfig } from './config/loader';

try {
    const config = await parseConfig(jsonString);
} catch (error) {
    if (error instanceof ConfigValidationError) {
        console.error(error.getFormattedIssues());
        // Output: target_output.items_per_second: Expected number, received string
    }
}
```

### Browser Compatibility

The configuration system is designed to work in browser environments:

```typescript
import { createBrowserConfigLoader } from './config/loader';

const loader = createBrowserConfigLoader(async (url) => {
    const response = await fetch(url);
    return response.text();
});

const config = await loader.loadFromUrl('/api/config');
```


## License

MIT
