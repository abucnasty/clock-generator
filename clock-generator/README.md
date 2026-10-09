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
    "items_per_second": 120,
    "machines": 7,
    "overrides": {
      "output_swings": 3
    },
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

### Enable Control Overrides

You can override the automatic enable control logic for individual inserters and drills. This is useful when you want to manually specify when an entity should be enabled during the crafting cycle.

#### Available Modes

| Mode | Description |
|------|-------------|
| `AUTO` | Use automatic control logic (default behavior) |
| `ALWAYS` | Entity is always enabled |
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

**ALWAYS**: The entity is always enabled. Use this when you want the entity to operate freely without clock control.

**NEVER**: The entity is never enabled. Useful for debugging or temporarily disabling an entity.

**CLOCKED**: The entity is enabled only during specified tick ranges within the period. Each range has:
- `start`: The tick when the entity becomes enabled (inclusive)
- `end`: The tick when the entity becomes disabled (inclusive)
- `period_duration_ticks` (optional): The period length in ticks. If not specified, uses the crafting cycle duration.

### Configuration Overrides

```typescript
overrides: {
    output_swings: 3,           // Force specific output inserter swing count
    terminal_swing_count: 4,    // Override calculated max swings
    lcm: 12                     // Override LCM calculation for cycle length
}
```

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
npm test
```

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
- `--lua` runs a Lua chunk right before the recording starts, called with `(entities, surface, area)`, for anything a seed cannot express.
- `--watch` also opens the game with graphics, joined to the run as a spectator over the build. The game then runs at speed 1 unless `--speed` says otherwise, and the run ends when that window is closed.

The save is never written to; Factorio gets a temporary write-data folder (`--work-dir` keeps it). The save needs a place where the blueprint can be built and powered, such as an editor map with a global electric network. Run `npm run record` without arguments for all options.

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
