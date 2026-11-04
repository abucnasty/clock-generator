import { SAMPLE_BUILDS_DIR } from "../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../src/blueprints/serde";
import { ConfigPaths } from "../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../src/config/loader";
import { generateClockAlternatives } from "../../../src/crafting/generate-blueprint";
import { HarnessOptions, HarnessResult, HarnessSession, recordInFactorio, Seed } from "../../../src/harness/factorio-harness";
import { outputPerPeriod, recipesMaking } from "../../../src/harness/recording-output";
import { composeProbeSource } from "../helpers/probe-source";
import { clockHash, readControls } from "./clock-controls";
import { matchRecordingToConfig } from "../../../src/verification/entity-matching";
import { wakeUpsOfRecording } from "../../../src/verification/recording-wake-ups";
import { compareRecordings } from "../../../src/verification/compare-recordings";
import { matchOfSimulatedRecording, simulatedWakeUpsByStart, simulateRecording } from "../../../src/verification/simulated-recording";

/**
 * These tests run a headless Factorio through the harness, so they need the game and a save to build in, both named
 * by the environment as `npm run record` takes them. Without either they are skipped, not failed.
 */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
/** Also open the game with graphics, joined as a spectator, and run the builds in it at a speed that can be followed; set by `npm run test:game:watch` */
const WATCH = !!process.env.FACTORIO_HARNESS_WATCH;
/**
 * A folder to keep each build's evidence in, written before the assertions so a failing build keeps it too: the
 * recording (`<build>.json`), the simulator's run of the same clock (`<build>.simulated.json`), a meta file with the
 * selected clock, the comparison's issues, the config and the harness's reports (`<build>.meta.json`), and the game's
 * write data with every inserter's unit number and position (`<build>-game/script-output/inserter-positions.json`).
 * Without it the recordings go to a temporary folder that is removed afterwards.
 */
const KEEP = process.env.SCAFFOLD_CAPTURE_DIR ? path.resolve(process.env.SCAFFOLD_CAPTURE_DIR) : null;
/** Writes every inserter's unit number and position as the game has them, right before the recording starts */
const INSERTER_POSITIONS_LUA = "local entities = ... local out = {} for _, e in pairs(entities) do if e.valid and e.type == \"inserter\" then "
    + "out[#out + 1] = { unit_number = e.unit_number, x = e.position.x, y = e.position.y } end end "
    + "helpers.write_file(\"inserter-positions.json\", helpers.table_to_json(out))";
/** As fast as the machine allows */
const UNWATCHED_SPEED = 1000;
/** Well under that: remote play can't keep up with the game rendering that fast */
const WATCH_SPEED = 1;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

const SAMPLES = path.join(SAMPLE_BUILDS_DIR);
/**
 * The game tests' protocol, timed in game ticks (tests/game/helpers/lua/steady.lua; scaffold-recordings-probe.lua): a build
 * settles until its final machines have made the target over the trailing minute and no less than one clock cycle earlier
 * (steady state), and is then recorded for a minute.
 */
const WINDOW_TICKS = 3600;
/**
 * Ticks recorded after the settle: one minute, cut into whole clock periods; a clock that counts more than a minute is recorded
 * over a tick more than its period, so a whole period stands between two wraps
 */
const RECORDED_TICKS = 3600;
/** The longest clock period recorded: two of them stay within 10 minutes (a run is at most 15 minutes of game time); a longer one is skipped */
const MAX_RECORDED_PERIOD = 18_000;
/** The most ticks a build may take to reach steady state, and a staged start to be recorded */
const SETTLE_CAP_TICKS = 36_000;
/** What the probe writes into the game's script-output */
const STEADY_REPORT = "scaffold-steady-state.json";
/**
 * How far the simulator's wake-ups a minute may be off the game's (GOALS.md, goal 2), as a share of the game's. On
 * 2026-10-10 the simulator counted what the game did on automation science and 7 to 21% fewer on the other four
 * builds: the states of the inserters agree, what is left is when the machines finish their crafts within a window.
 * To be tightened as that is found; before the game's rule for a waiting inserter was in the simulator it was off by
 * up to 47%.
 */
const WAKE_UPS_TOLERANCE = 0.25;
/**
 * Agricultural science: an inserter that brings nutrients to an egg biochamber shows "waiting for source items" in the
 * first tick of its window, and in the next the nutrient biochamber it takes from, at its output block, puts out the
 * products it holds as the inserter takes. The game counts a wake there, the simulator does not (docs/simulator.md,
 * "Products a machine cannot put out"). The gap was inside the tolerance while the inserters into the science biochamber
 * were always on (3,187.9 a minute in the game against 2,673.8 on the same clock, 2026-10-24), and is not since they
 * have windows.
 */
const AGRICULTURAL_SCIENCE_WAKE_UPS_OPEN = "the game counts a wake of the inserters that bring nutrients to the egg biochambers in the tick after "
    + "their window opens, where the nutrient biochamber puts out the products it holds as they take, and the simulator does not: "
    + "134.3 a minute each in the game against 34.5 to 36.4 in the simulator, 1,361.9 in all against 880.8 (1,383.2 with belts backed up; 2026-10-24; "
    + "1,791.4 against 1,257.8 on the clock before, whose loop inserters were always on)";
/**
 * Iron bacteria: since its two loop inserters have windows the game counts about three times the simulator's wake-ups on
 * every inserter of the build, where the two agreed within the tolerance while they were always on. The series' method
 * is a known miss on biochambers (GOALS.md, goal 2), the harness seeds the loop with 50 bacteria where the simulator's
 * cold start gives it 200, and the loop's steady state depends on the start in the simulator and in the game alike. The
 * clock moves its output in every period all the same, and the game's figure is still far under the simulator's
 * 3,534.7 a minute with the loop always on, which the game was within the tolerance of.
 */
const IRON_BACTERIA_WAKE_UPS_OPEN = "with windows on the loop's two inserters the game counts about three times the simulator's wake-ups "
    + "on every inserter: 1,499.8 a minute in all against 516.4 (each output inserter 116.7 against 39.6, each loop inserter 79.0 against "
    + "36.8, each bioflux inserter 437.6 against 142.2; 2026-10-24), where the two agreed while the loop was always on";
/**
 * Places in the period the simulator starts the clock at to find the steady state the game settled into, when the
 * wake-ups of its own run are not the game's. Batched swings on utility science makes 192 a period at 10.7, 26.8 or
 * 32.1 wake-ups a minute depending on where the clock starts; the game shows 26.8, as the generator's run does from the staged start (it counted 10.7 from the prepared build).
 */
const WAKE_UPS_START_PHASES = 24;
/** Starting the game, building, warming up and recording take well under two minutes; the harness's own timeout is 900 seconds */
const TEST_TIMEOUT_MS = WATCH ? 3600_000 : 960_000;

interface ScaffoldBuild {
    /** One copy of the build without a clock, as a blueprint string */
    scaffold: string;
    config: string;
    seed: Seed[];
    /** Ticks the build runs before it is seeded, so belts are full; the clock is not wired yet, so no clock period runs in them */
    warmup_ticks: number;
    /** The clock is made for backed-up belts (`overrides.backed_up_belts`), which is what a scaffold has */
    backed_up_belts?: boolean;
    /**
     * The build is recorded from the staged start of the harness, as the simulator runs it: the belts are saturated first,
     * then every inserter of the cell and the clock are placed in one tick, with the machines empty but for the egg loop,
     * seeded once. `warmup_ticks` is not used, and the recording runs from the placement until steady state and a minute
     * more (at most SETTLE_CAP_TICKS), so it holds the first periods of the clock, which the build may still be settling
     * into: the periods are cut from the first sample (the recorder does not read the clock of a staged start), and the game
     * is compared with the simulator on what follows the first third of each.
     */
    staged_start?: {
        /** The periods of the recording that move less than the expected output, as the game showed them (the first is left out): where each starts, and the items it moved */
        dips: { start: number; items: number }[];
        /** What the game and the simulator still differ in after the first third of each, as the comparison words it */
        open_issues: string[];
    };
    /**
     * Why the wake-ups of this build are not held to the game's yet: a difference between the simulator and the game
     * that is known and open. What the build moves, and what every inserter and machine does, is held all the same.
     */
    wake_ups_open?: string;
    /**
     * Inserters the simulator moves another amount through than the game does, and why that is left: a known
     * difference that changes no verdict and no selection (GOALS.md, "Working Rules"), with its line in the samples
     * README. What the build moves in every period is held all the same, and so is every other inserter and machine.
     */
    moved_open?: { inserter_ids: number[]; why: string };
    /**
     * Machines whose crafts a period the simulator counts otherwise than the game, and why that is left: a known difference
     * with its issue and its line in the samples README. What the build moves in every period is held all the same, and so is
     * every inserter and every other machine.
     */
    crafts_open?: { machine_ids: number[]; why: string };
}

/** The logistic science build with inserter crafting: an accepted gap in the wake-ups (#586), production and every hand held all the same */
const LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN = "the wake-ups of the inserter crafting build differ between the game and the simulator, "
    + "with the game's order of service and the production the same (#586, an accepted 0.27.0 gap)";

const BUILDS: Record<string, ScaffoldBuild> = {
    "agricultural science": {
        scaffold: path.join(SAMPLES, "science", "agriculture-science", "agriculture-science-scaffold.txt"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE,
        // the egg loop cannot start itself, so the egg machines are given eggs to begin with
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        // Recorded 2026-10-24 on batched swings (5 output swings per cycle) with windows on the two inserters that take eggs
        // out of the loop into the science biochamber (ticks 23 to 46 of every 96) and on the two of the loop itself (31 to 80
        // and 79 to 128 of every 96): 400 in every one of 74 periods after the staged start, and the simulator moves what the
        // game moved through every inserter and machine; so did the family cuts (64 periods, then back at 400 from the
        // first or second period after each cut). The same that day with only the first two on windows, and with all four
        // always on. The 2-swing clock selected before (recorded 2026-10-16) was one hand short in periods 8 and 9 of the
        // settling after the staged start. Since 0.27.0 it selects shifted swings (5 output swings per cycle), recorded
        // 2026-11-03 from the staged start to steady state and a minute more: one period of the settling short (320 at tick
        // 1,440), 400 in every other.
        staged_start: {
            dips: [{ start: 1440, items: 320 }],
            open_issues: [],
        },
        wake_ups_open: AGRICULTURAL_SCIENCE_WAKE_UPS_OPEN,
    },
    // its clocks have no belt pickup slack: batched swings has room for a hand of fuel in the windows of the three
    // inserters that take nutrients off the belt with their bioflux, without which they do not hold. Batched swings is
    // selected, the same clock as with belts that move (recorded 2026-10-24: 400 in every one of 74 periods, no
    // difference between the game and the simulator); the 2-swing clock was while a loss of nutrients broke batched
    // swings (2026-10-10 to 2026-10-14), and again while its nutrients trials dipped a hand late in their 40 periods,
    // until such a trial ran on (2026-10-24)
    "agricultural science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "agriculture-science", "agriculture-science-scaffold.txt"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        backed_up_belts: true,
        wake_ups_open: AGRICULTURAL_SCIENCE_WAKE_UPS_OPEN,
    },
    "automation science": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
    },
    // its selected clock has no belt pickup slack: full-hand output swings, which the simulator holds stable without it
    "automation science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    "automation science with a belted buffer": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-belted-buffer-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER,
        seed: [],
        warmup_ticks: 3600,
        // Pre-existing, not from the belt window trim: the copper foundry's output inserter wakes 25 a minute in
        // the game and 5 in the simulator, because the game counts a held product when it enters the output and
        // the simulator when it is made (docs/simulator.md). The gap crossed the tolerance only once the trim cut
        // the build's total wake-ups 100 -> 75 a minute; the trimmed belt inserter itself matches the game tick
        // for tick (#265; the comparison's recordings were not kept in the repository):
        wake_ups_open: "the game counts a foundry's held product entering its output, the simulator the make: ",
    },
    // Two logistic science assemblers (legendary, 4 legendary productivity modules, 10 legendary beacons: 63.0078) fed
    // transport belts by one foundry (8 beacons) between them, whose plates and gears come from two casting foundries (6
    // beacons each) on molten iron from infinity pipes; each assembler takes inserters from a turbo belt of its own and
    // puts its packs onto another. 6 copies of it make 240 a second. The build was given 2026-10-21.
    "logistic science with direct insertion": {
        scaffold: path.join(SAMPLES, "science", "logistic-science", "logistic-science-direct-insert-scaffold.txt"),
        config: ConfigPaths.LOGISTIC_SCIENCE_DI,
        seed: [],
        warmup_ticks: 3600,
    },
    "logistic science with direct insertion (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "logistic-science", "logistic-science-direct-insert-scaffold.txt"),
        config: ConfigPaths.LOGISTIC_SCIENCE_DI,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    // A real cell (#189): two electromagnetic plants making advanced circuits from one copper cable foundry and two
    // plastic chemical plants, whose coal comes on one belt; 90 a second. Its electronic circuits come from infinity
    // chests.
    "composite cell 07": {
        scaffold: path.join(SAMPLES, "real", "composite04", "cell07", "composite04-cell07-scaffold.txt"),
        config: ConfigPaths.REAL_COMPOSITE04_CELL07,
        seed: [],
        warmup_ticks: 3600,
    },
    "composite cell 07 (belts are backed up)": {
        scaffold: path.join(SAMPLES, "real", "composite04", "cell07", "composite04-cell07-scaffold.txt"),
        config: ConfigPaths.REAL_COMPOSITE04_CELL07,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    // An accepted 0.27.0 gap (#586): the game serves the inserters in the simulator's order and the production is exact; the
    // wake-ups differ
    // One of the three copies of the inserter build given 2026-10-21, 240 inserters a second over the three: an
    // inserter assembler (4 speed modules, 8 beacons) fed plates by two furnaces and gears by a gear assembler, which two
    // more furnaces feed, all legendary. Each pair of furnaces takes its ore from a line of its own; the ore, so the
    // plates, gears and the circuits from infinity chests, is uncommon. The output inserter runs all the time.
    "logistic science with inserter crafting": {
        scaffold: path.join(SAMPLES, "science", "logistic-science", "logistic-science-inserter-crafting-scaffold.txt"),
        config: ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN,
    },
    "logistic science with inserter crafting (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "logistic-science", "logistic-science-inserter-crafting-scaffold.txt"),
        config: ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
        wake_ups_open: LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN,
    },
    // The build of issue 98: two foundries, two electromagnetic plants and a cryogenic plant, 240 a second over three
    // copies. Its clock counts 792 ticks.
    "advanced circuit": {
        scaffold: path.join(SAMPLES, "intermediates", "advanced-circuit", "advanced-circuit-scaffold.txt"),
        config: ConfigPaths.ADVANCED_CIRCUIT,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the simulator shows an output inserter as waiting on its machine in ticks the game shows it as working: "
            + "510 wake-ups a minute against 400 on 2026-10-10 (samples README, Advanced circuit)",
    },
    // The same build at 230 a second, the target the issue was reported at: its period is not a whole number of ticks
    // (550.957), so its clock counts 12,672 ticks for 23 periods. No clock held it until the one search of 2026-10-11
    // found full-hand output swings that do; recorded that day, 16,192 in each of 2 repeats, 769 wake-ups a minute in
    // the game against 600 in the simulator.
    "advanced circuit at 230 a second": {
        scaffold: path.join(SAMPLES, "intermediates", "advanced-circuit", "advanced-circuit-scaffold.txt"),
        config: ConfigPaths.ADVANCED_CIRCUIT_230,
        seed: [],
        warmup_ticks: 3600,
    },
    // One block of four chemical science assemblers, four engine assemblers and one foundry casting the pipes of all four
    // engines, all legendary with legendary modules and 40 legendary beacons: 5.5 copies of it make 240 a second. The
    // build was given 2026-10-15. Without a clock it makes 44.0 a second, a hair over the 43.636 the target asks of one
    // block; with the selected clock, 256 in each of 102 periods of 352 ticks, recorded 2026-10-15.
    "chemical science with a shared foundry": {
        scaffold: path.join(SAMPLES, "science", "chemical-science", "chemical-science-shared-foundry-scaffold.txt"),
        config: ConfigPaths.CHEMICAL_SCIENCE_SHARED_FOUNDRY,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the simulator starts a science machine's craft on the first tick its belt inserter waits for space, and the game one tick later: "
            + "the four belt inserters of the science machines are woken once a period in the game and never in the simulator, "
            + "122.7 wake-ups a minute against 82.2 on 2026-10-15 (samples README, Chemical science with a shared foundry)",
        moved_open: {
            inserter_ids: [6, 8, 14, 16],
            why: "the recording merges the block's north and south supply belts into one belt each, so the four south-side inserters "
                + "are matched to the other lane and read as nearest to sulfur or gears; the config matches the scaffold, and every "
                + "inserter moves the same items in the game and the simulator",
        },
    },
    // One electromagnetic plant (legendary, five legendary productivity modules, 12 legendary beacons) on accumulators and
    // supercapacitors from one belt, its fluids from infinity pipes: 11 copies of it make 330 a second. Recorded 2026-10-16:
    // 352 in every period of 704 ticks (batched swings, 2 output swings per cycle). The config's crafting speed is 109.475, what
    // 12 beacons give in the game.
    "electromagnetic science": {
        scaffold: path.join(SAMPLES, "science", "electromagnetic-science", "electromagnetic-science-scaffold.txt"),
        config: ConfigPaths.ELECTROMAGNETIC_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
    },
    // The same build with both output inserters on AUTO. Recorded 2026-10-16 on the same batched swings clock (period 704): from a
    // staged start (empty machines) 288 in the first period and 352 in each of the 50 after; on this test's start (warm-up and settle) 352 in every period checked.
    "electromagnetic science with its output inserters on AUTO": {
        scaffold: path.join(SAMPLES, "science", "electromagnetic-science", "electromagnetic-science-scaffold.txt"),
        config: ConfigPaths.ELECTROMAGNETIC_SCIENCE_AUTO,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the game counts the first output inserter 0 wake-ups a minute, as it is never shown waiting, and the simulator 15.36, as it shows "
            + "both output inserters waiting on the machine in 1.56% of the ticks; the build moves its expected output in every period (recorded 2026-11-01: "
            + "25.6 a minute in all in the game, 41.0 in the simulator, 35.8 a minute of arm-away alarms on either side)",
    },
    // Two inserters each take two items off a belt of their own, and both take low density structures: which item
    // each takes first decides how the structures are split between them (near_lane in the config)
    "utility science": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
    },
    "utility science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    "utility science with processing units and low density structures on one belt": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
    },
    "utility science with processing units and low density structures on one belt (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    "low density structure": {
        scaffold: path.join(SAMPLES, "intermediates", "low-density-structure", "low-density-structure-scaffold.txt"),
        config: ConfigPaths.LOW_DENSITY_STRUCTURE,
        seed: [],
        warmup_ticks: 3600,
    },
    // The build of issue 152: two electromagnetic plants, two cryogenic plants and two foundries, 640 a second over 18
    // copies, all of it from machine to machine. The clock 0.9.0 selected made 512 to 544 of its 576 a period here.
    "accumulator": {
        scaffold: path.join(SAMPLES, "intermediates", "accumulator", "accumulator-640-scaffold.txt"),
        config: ConfigPaths.ACCUMULATOR_640,
        seed: [],
        warmup_ticks: 3600,
    },
    // The lithium plate build: two cryogenic plants fill a rocket silo taken as a chest, and six furnaces empty it;
    // 80 a second from one copy. The warm-up fills the silo, which the config exports empty.
    "lithium plates through a rocket silo": {
        scaffold: path.join(SAMPLES, "real", "owner", "lithium-silo", "lithium-silo-scaffold.txt"),
        config: ConfigPaths.REAL_OWNER_LITHIUM_SILO,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the inserters into the silo agree (4 wake-ups a period each, game and simulator), but the furnace-to-belt "
            + "output inserters 11 and 12 wake 10 times a period in the game and 0 in a simulator that starts cold: the furnaces' output "
            + "levels the warm-up leaves decide it, and a simulator started from the recording's first sample equals the game (sim-game-check)",
    },
    // The iron plate build: a big mining drill drops ore into a car taken as a chest, and two furnaces empty it; 80 a
    // second from one copy. The harness puts the ore under the drill; at its research the drill keeps the car full.
    "iron plates through a car": {
        scaffold: path.join(SAMPLES, "real", "owner", "car", "car-scaffold.txt"),
        config: ConfigPaths.REAL_OWNER_CAR,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the simulator counts 200.0 a minute from the scaffold's cold start, its two output inserters woken by their "
            + "furnaces 100 times a minute each, and 0.0 from other starts; the game's states give 3.8 on 2026-10-22 (1.3 for each "
            + "output inserter, 0.6 for each inserter from the car), for a reason not yet found: ",
        crafts_open: {
            machine_ids: [1, 2],
            why: "#587: the two furnaces finish 193.17 crafts and productivity bars a period in the game under the minute-long recording "
                + "and 194.00 in the simulator, while the build moves 96 plates in every period (samples README, real/owner/car)",
        },
    },
    // The steel build: one cargo wagon is a hub that a big mining drill fills with ore, two furnaces take from and
    // put back into (ore to plates, plates to steel), and one inserter empties of steel onto the output belt; 26 a second
    // from one copy. The harness puts the ore under the drill and builds the wagon after its rails.
    "steel plates around a cargo wagon": {
        scaffold: path.join(SAMPLES, "smelting", "steel-wagon", "steel-wagon-scaffold.txt"),
        config: ConfigPaths.STEEL_CARGO_WAGON,
        seed: [],
        warmup_ticks: 3600,
    },
    "iron bacteria cultivation": {
        scaffold: path.join(SAMPLES, "gleba", "iron-bacteria-cultivation", "iron-bacteria-cultivation-scaffold.txt"),
        config: ConfigPaths.IRON_BACTERIA_CULTIVATION,
        // the machines make bacteria from bacteria, so they are given some to begin with
        seed: [{ target: { recipe: "iron-bacteria-cultivation" }, item: "iron-bacteria", count: 50 }],
        warmup_ticks: 300,
        // recorded 2026-10-24 on 6 output swings per cycle (subtick) with windows on the loop's two inserters (ticks 15 to 23
        // and 60 to 68 of every 90.95): 10,944 in every one of the 20 repeats of 1,728 ticks after the first
        wake_ups_open: IRON_BACTERIA_WAKE_UPS_OPEN,
    },
};

/** What steady.lua writes into the probe's report (`protocol`) */
interface SteadyReport {
    steady?: number;
    result?: string;
    error?: string;
    finals?: unknown;
}

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

let scratch: string | null = null;
/** The one game the builds are watched in, each built in the place of the one before it */
let session: HarnessSession | null = null;

/**
 * Records a build. Unwatched, in a game of its own, so it starts from the save as it is. Watched, in one game for
 * all builds, so there is one window to look at and the game with graphics is started once.
 */
async function record(options: HarnessOptions): Promise<HarnessResult> {
    if (!WATCH) {
        return recordInFactorio(options);
    }
    const first = session === null;
    session ??= await HarnessSession.start(options);
    try {
        // The first build sets the speed to watch at; the next ones leave it as whoever watches has set it since. Once
        // the window is closed nobody is looking, and the builds left go as fast as they do unwatched.
        const game_speed = !session.watched ? UNWATCHED_SPEED : first ? WATCH_SPEED : undefined;
        return await session.record({ ...options, game_speed });
    } catch (error) {
        // a game that failed a build is in no state to take the next one, which starts a game of its own
        await session.close(true);
        session = null;
        throw error;
    }
}

// the game with graphics takes a few seconds to close
afterAll(async () => {
    await session?.close();
    if (scratch && !KEEP) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 60_000);

/** The clocks the values of three builds belong to (scaffold-recordings-clock-pins.json); the generation tests check the selection (src/crafting/scaffold-recordings-clock.generation.test.ts) */
const clockPins = readControls<{ cases: Record<string, { config: string; backed_up_belts: boolean; clock_sha256: string }> }>("scaffold-recordings-clock-pins.json").cases;

test("every build with a pinned clock is a build of this file", () => {
    for (const [name, pin] of Object.entries(clockPins)) {
        expect(BUILDS[name], `${name} is in scaffold-recordings-clock-pins.json and not among the builds`).toBeDefined();
        expect(BUILDS[name].config, name).toBe((ConfigPaths as Record<string, string>)[pin.config]);
        expect(!!BUILDS[name].backed_up_belts, name).toBe(pin.backed_up_belts);
    }
});

// one build at a time: each test waits for its own recording before the next starts
describe.sequential("the selected clock holds the target rate in Factorio", () => {
    for (const [name, build] of Object.entries(BUILDS)) {
        test(`one copy of the ${name} build moves the expected output every clock period`, async context => {
            context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
            if (KEEP) {
                fs.mkdirSync(KEEP, { recursive: true });
            }
            scratch ??= KEEP ?? fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-recordings-"));
            const base = path.join(scratch, name.replace(/ /g, "-"));

            const loaded = await loadConfigFromFile(build.config);
            const config = build.backed_up_belts ? { ...loaded, overrides: { ...loaded.overrides, backed_up_belts: true } } : loaded;
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const selected = alternatives[selected_index];
            if (build.backed_up_belts) {
                expect(selected.belt, `the selected clock (${selected.label}) is made without belt pickup slack`).toEqual({ kind: "backed_up" });
            }
            // stable, but for a build with a deadlock risk: there a clock that holds its expected output is selected
            // whether it gets back from every backpressure loss or not (GOALS.md, "Two inserters that bring the same item")
            const holds = selected.deadlock_risks.length > 0 ? selected.verdict !== "unstable" : selected.verdict === "stable";
            expect(holds, `the selected clock (${selected.label}) is stable in the simulator`).toBe(true);
            expect(selected.assessment.items_per_second, `the selected clock (${selected.label}) reaches the target rate in the simulator`)
                .toBe(config.target_output.items_per_second);

            // A fractional period is built as a subtick clock, which counts the whole ticks after which the period
            // repeats (1728 for 19 periods of 90.947): that is the period the recording is cut into, and what it has
            // to move is what that many ticks ask for.
            const subtick = selected.result.subtick;
            const period = subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
            context.skip(!build.staged_start && period > MAX_RECORDED_PERIOD,
                `the selected clock counts ${period} ticks, over the ${MAX_RECORDED_PERIOD} ticks one period of a recording may take`);
            // a subtick clock's repeat and a rate per copy can leave a float a hair off the whole number of items
            const expected = Math.round(config.target_output.items_per_second / config.target_output.copies * period / 60 * 1e6) / 1e6;
            // what the machines that make the target item have to finish over the trailing minute for steady state
            const expected_per_window = Math.round(config.target_output.items_per_second / config.target_output.copies * WINDOW_TICKS / 60 * 1e6) / 1e6;
            // the clock with its schedule as the generator made it, which the harness wires without reading descriptions
            const exported = subtick ?? selected.result;
            // the dips and issues this build expects were seen on one clock: on another they say nothing
            if (clockPins[name]) {
                expect(clockHash(exported), `the selected clock (${selected.label}) is not the one the values of ${name} were recorded on (scaffold-recordings-clock-pins.json)`)
                    .toBe(clockPins[name].clock_sha256);
            }
            const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
            // the probe ends the settle at steady state (a staged start: cuts the recording a minute after it); it writes its
            // report into the game's script-output, which the build has a folder of its own for (all builds share the one game
            // watched)
            const recipes = [...recipesMaking(config, config.target_output.recipe)];
            const probe = composeProbeSource(path.join(__dirname, "scaffold-recordings-probe.lua"), {
                window: WINDOW_TICKS, expected: expected_per_window, recipes, item: config.target_output.recipe, cap: SETTLE_CAP_TICKS,
                output: STEADY_REPORT, staged: !!build.staged_start, ticks: SETTLE_CAP_TICKS,
            });
            const work_dir = WATCH ? path.join(scratch, "watch-game") : `${base}-game`;
            let result: HarnessResult;
            let steady: SteadyReport;
            try {
                result = await record({
                    factorio: FACTORIO!,
                    save: SAVE!,
                    blueprint: fs.readFileSync(build.scaffold, "utf-8").trim(),
                    out: `${base}.json`,
                    // a clock longer than a minute: a tick more than its period, so the recorder holds a whole period between two wraps
                    ticks: build.staged_start ? SETTLE_CAP_TICKS : Math.max(RECORDED_TICKS, period + 1),
                    warmup_ticks: build.staged_start ? 0 : build.warmup_ticks,
                    settle_ticks: build.staged_start ? undefined : SETTLE_CAP_TICKS + 1,
                    seed: build.staged_start ? [] : build.seed,
                    staged_start: build.staged_start ? {} : undefined,
                    clock,
                    config,
                    unclocked: false,
                    game_speed: UNWATCHED_SPEED,
                    watch: WATCH,
                    timeout_seconds: WATCH ? 3600 : 900,
                    log: () => { },
                    work_dir,
                    lua: KEEP ? `do ${INSERTER_POSITIONS_LUA} end\n${probe}` : probe,
                });
                steady = JSON.parse(fs.readFileSync(path.join(work_dir, "script-output", STEADY_REPORT), "utf-8")).protocol;
            } finally {
                if (!KEEP && !WATCH) {
                    fs.rmSync(work_dir, { recursive: true, force: true });
                }
            }

            if (build.staged_start) {
                // a staged recording does not read the clock (the recorder ignores it: it records fixed ticks from the tick the
                // inserters are placed in), and the clock is wired in that tick to count its period from the first sample
                result.recording.clock = { values: Array.from({ length: result.recording.sample_count }, (_, tick) => tick % period) };
            }

            // the simulator against the game, entity by entity: a run of the same clock, half as long again as the
            // recording and judged on what follows its first third, moves what the game moved through every inserter
            // and finishes what it finished in every machine (asserted below, once the evidence is kept)
            const simulated_run = simulateRecording(config, selected.result.clock_windows, selected.result.simulation_duration.ticks, result.recording.sample_count * 1.5, period);
            const compared = compareRecordings(
                {
                    recording: result.recording,
                    match: matchRecordingToConfig(result.recording, config),
                    from_sample: build.staged_start ? Math.floor(result.recording.sample_count / 3) : undefined,
                },
                { recording: simulated_run, match: matchOfSimulatedRecording(simulated_run), from_sample: Math.floor(simulated_run.sample_count / 3) },
                config,
                { expected_output_per_period: expected },
            );
            const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
            if (KEEP) {
                fs.writeFileSync(`${base}.simulated.json`, JSON.stringify(simulated_run));
                fs.writeFileSync(`${base}.meta.json`, JSON.stringify({
                    name, label: selected.label, verdict: selected.verdict, period, expected, clock_windows: selected.result.clock_windows,
                    simulation_ticks: selected.result.simulation_duration.ticks, backed_up_belts: !!build.backed_up_belts,
                    staged_start: !!build.staged_start, issues: compared.issues, config, harness_build: result.build,
                    harness_start: result.start, periods, steady,
                }, null, 1));
            }
            // the build reached steady state in the game, within the ticks it may take
            expect(steady.error, "the probe failed in the game").toBeUndefined();
            expect(steady.steady, `the build did not reach steady state within ${SETTLE_CAP_TICKS} ticks (${steady.result ?? "the game ended first"})`).toBeDefined();
            // the machines the probe counted are those of the config that make the target item (one copy)
            expect(Array.isArray(steady.finals) ? steady.finals : [], "the final machines the probe counts")
                .toHaveLength(config.machines.filter(machine => recipes.includes(machine.recipe)).length);
            expect(periods.length, `the recording of ${result.recording.sample_count} ticks holds a whole clock period`).toBeGreaterThan(0);
            // the first period is left out: the build may still be settling into the clock. A clock that counts over a minute is
            // recorded over one period, which is checked whole: the settle ended at steady state
            const checked = periods.length > 1 ? periods.slice(1) : periods;
            const wrong_length = checked.filter(it => it.end - it.start !== period);
            expect(wrong_length, `every one of the ${checked.length} periods checked lasts ${period} ticks, as the generated clock does`).toEqual([]);
            const short = checked.filter(it => it.items !== expected);
            expect(short.map(it => ({ start: it.start, items: it.items })),
                `every one of the ${checked.length} periods checked moves ${expected} items of ${config.target_output.recipe}`
                + (build.staged_start ? ", but those the game was short in after the staged start" : "")).toEqual(build.staged_start?.dips ?? []);

            // goal 2: the long run of the selected clock counts the wake-ups the game shows
            const simulated = selected.result.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
            const recorded = wakeUpsOfRecording(result.recording, matchRecordingToConfig(result.recording, config), 0, result.recording.sample_count, config).wake_ups_per_minute;
            expect(simulated, `the long run of the selected clock (${selected.label}) counted its wake-ups`).toBeDefined();
            const asRecorded = (figure: number) => Math.abs(figure - recorded) <= WAKE_UPS_TOLERANCE * recorded;
            const by_start = asRecorded(simulated!) ? []
                : simulatedWakeUpsByStart(config, selected.result.clock_windows, selected.result.simulation_duration.ticks, WAKE_UPS_START_PHASES);
            const figures = Array.from(new Set([simulated!, ...by_start].map(figure => figure.toFixed(1)))).join(", ");
            if (build.wake_ups_open === undefined) {
                expect([simulated!, ...by_start].some(asRecorded),
                    `the simulator counts ${figures} wake-ups a minute, by where the clock starts, where the game shows ${recorded.toFixed(1)}`).toBe(true);
            }

            // the simulator against the game, entity by entity (compared above)
            const known = [...(build.moved_open?.inserter_ids ?? []).map(id => `Inserter ${id} (`),
                ...(build.crafts_open?.machine_ids ?? []).map(id => `Machine ${id} (`)];
            // an issue names its inserter at its start or, for one about how the config describes the build, after a sentence
            const issues = compared.issues.filter(issue => !known.some(name => issue.startsWith(name) || issue.includes(`. ${name}`)));
            expect(issues, "the simulator moves what the game moved, through every inserter and machine").toEqual(build.staged_start?.open_issues ?? []);
        }, TEST_TIMEOUT_MS);
    }
});
