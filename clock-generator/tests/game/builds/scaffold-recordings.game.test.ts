import { SAMPLE_BUILDS_DIR } from "../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../src/blueprints/serde";
import { ConfigPaths } from "../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../src/config/loader";
import { generateClockAlternatives } from "../../../src/crafting/generate-blueprint";
import { builtCopies, clockWindowCycleTicks, HarnessOptions, HarnessResult, HarnessSession, partCopiesOf, recordInFactorio, Seed } from "../../../src/harness/factorio-harness";
import { outputInserters, outputPerWindowCycle, recipesMaking } from "../../../src/harness/recording-output";
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
/** abucnasty's whole chemical science build, both sides, with the clock it came with (a blueprint string, as he gave it) */
const CHEMICAL_SCIENCE_WHOLE_BUILD = path.join(__dirname, "chemical-science-240-shared-foundry-full-build.blueprint");
/**
 * The game tests' protocol, timed in game ticks (tests/game/helpers/lua/steady.lua; scaffold-recordings-probe.lua): a build
 * settles until its final machines have made the target over the trailing minute and no less than one clock cycle earlier
 * (steady state), and is then recorded for a minute.
 */
const WINDOW_TICKS = 3600;
/**
 * Ticks recorded after the settle: one minute, cut into whole window cycles; a clock that counts more than a minute is recorded
 * over a tick more than its window cycle, so a whole window cycle stands between two wraps
 */
const RECORDED_TICKS = 3600;
/** The longest window cycle recorded: two of them stay within 10 minutes (a run is at most 15 minutes of game time); a longer one is skipped */
const MAX_RECORDED_WINDOW_CYCLE = 18_000;
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
 * clock moves its output in every window cycle all the same, and the game's figure is still far under the simulator's
 * 3,534.7 a minute with the loop always on, which the game was within the tolerance of.
 */
const IRON_BACTERIA_WAKE_UPS_OPEN = "with windows on the loop's two inserters the game counts about three times the simulator's wake-ups "
    + "on every inserter: 1,499.8 a minute in all against 516.4 (each output inserter 116.7 against 39.6, each loop inserter 79.0 against "
    + "36.8, each bioflux inserter 437.6 against 142.2; 2026-10-24), where the two agreed while the loop was always on";
/**
 * Places in the window cycle the simulator starts the clock at to find the steady state the game settled into, when the
 * wake-ups of its own run are not the game's. Takt Batches on utility science makes 192 a window cycle at 10.7, 26.8 or
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
    /** Ticks the build runs before it is seeded, so belts are full; the clock is not wired yet, so no window cycle runs in them */
    warmup_ticks: number;
    /** The clock is made for backed-up belts (`overrides.backed_up_belts`), which is what a scaffold has */
    backed_up_belts?: boolean;
    /**
     * How many times the scaffold holds the config (default 1): a build of several copies that share belts. The harness is told
     * (`HarnessOptions.copies`) and wires the clock to every copy; what the build has to make in a window cycle and in the settle's
     * window is that of one copy times this, and every row of copies (output inserters at one height) and every copy (found as the
     * harness finds them to wire the clock) is judged on its own too, the whole build against the target times the copies over the
     * config's copies. The simulator's entity-by-entity comparison and
     * the wake-ups are of one copy and are not made for such a build.
     */
    copies?: number;
    /**
     * The build's own clock, kept as the blueprint has it (a clock described "Clock for ...", which the recorder cuts the
     * recording by), in place of the clock the generator selects; with the copies it leaves short in the game, by number as
     * the copies are found (the order of their lowest machine ids), and why. An expected shortfall: it shows that the check of
     * each copy sees a copy the others starve, where the build's total hides it. Nothing is asserted of steady state or of the
     * total; every other copy is held to its target.
     */
    own_clock?: { short_copies: number[]; why: string };
    /**
     * The build is recorded from the staged start of the harness, as the simulator runs it: the belts are saturated first,
     * then every inserter of the cell and the clock are placed in one tick, with the machines empty but for the egg loop,
     * seeded once. `warmup_ticks` is not used, and the recording runs from the placement until steady state and a minute
     * more (at most SETTLE_CAP_TICKS), so it holds the first window cycles of the clock, which the build may still be settling
     * into: the window cycles are cut from the first sample (the recorder does not read the clock of a staged start), and the game
     * is compared with the simulator on what follows the first third of each.
     */
    staged_start?: {
        /** The window cycles of the recording that move less than the expected output, as the game showed them (the first is left out): where each starts, and the items it moved */
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
     * README. What the build moves in every window cycle is held all the same, and so is every other inserter and machine.
     */
    moved_open?: { inserter_ids: number[]; why: string };
    /**
     * Machines whose crafts a window cycle the simulator counts otherwise than the game, and why that is left: a known difference
     * with its issue and its line in the samples README. What the build moves in every window cycle is held all the same, and so is
     * every inserter and every other machine.
     */
    crafts_open?: { machine_ids: number[]; why: string };
}

/** The logistic science build with inserter crafting: an accepted gap in the wake-ups (#586), production and every hand held all the same */
const LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN = "the wake-ups of the inserter crafting build differ between the game and the simulator, "
    + "with the game's order of service and the production the same (#586, an accepted 0.27.0 gap)";

const BUILDS: Record<string, ScaffoldBuild> = {
    "agricultural science": {
        scaffold: path.join(SAMPLES, "science", "agricultural", "agricultural-250.scaffold"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE_250,
        // the egg loop cannot start itself, so the egg machines are given eggs to begin with
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        // Recorded 2026-10-24 on batched swings (Takt Batches: 5 output swings each output cycle) with windows on the two inserters that take eggs
        // out of the loop into the science biochamber (ticks 23 to 46 of every 96) and on the two of the loop itself (31 to 80
        // and 79 to 128 of every 96): 400 in every one of 74 window cycles after the staged start, and the simulator moves what the
        // game moved through every inserter and machine; so did the family cuts (64 window cycles, then back at 400 from the
        // first or second window cycle after each cut). The same that day with only the first two on windows, and with all four
        // always on. The 2-swing clock selected before (recorded 2026-10-16) was one hand short in window cycles 8 and 9 of the
        // settling after the staged start. Since 0.27.0 it selects shifted swings (Takt Batches: 5 output swings each output cycle), recorded
        // 2026-11-03 from the staged start to steady state and a minute more: one window cycle of the settling short (320 at tick
        // 1,440), 400 in every other.
        staged_start: {
            dips: [{ start: 1440, items: 320 }],
            open_issues: [],
        },
        wake_ups_open: AGRICULTURAL_SCIENCE_WAKE_UPS_OPEN,
    },
    // its clocks have no belt pickup slack: batched swings has room for a hand of fuel in the windows of the three
    // inserters that take nutrients off the belt with their bioflux, without which they do not hold. Takt Batches is
    // selected, the same clock as with belts that move (recorded 2026-10-24: 400 in every one of 74 window cycles, no
    // difference between the game and the simulator); the 2-swing clock was while a loss of nutrients broke batched
    // swings (2026-10-10 to 2026-10-14), and again while its nutrients trials dipped a hand late in their 40 window cycles,
    // until such a trial ran on (2026-10-24)
    "agricultural science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "agricultural", "agricultural-250.scaffold"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE_250,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        backed_up_belts: true,
        wake_ups_open: AGRICULTURAL_SCIENCE_WAKE_UPS_OPEN,
    },
    // abucnasty's build of nine copies (2026-11-11), 9 tiles apart in one row on one input belt whose two lanes are dead
    // ends (gears left, copper right). The copies' packs go onto one shared line into a loader and a void chest: copies 1-4
    // and 6-8 side-load from short stubs, copy 5 drops onto the line, and copy 9 joins it through a splitter. 26.67 a second
    // a copy, 240 over nine. The scaffold before was one copy.
    "automation science": {
        scaffold: path.join(SAMPLES, "science", "automation", "automation-240.scaffold"),
        config: ConfigPaths.AUTOMATION_SCIENCE_240,
        seed: [],
        warmup_ticks: 3600,
        copies: 9,
    },
    // its selected clock has no belt pickup slack: full-hand output swings, which the simulator holds stable without it
    "automation science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "automation", "automation-240.scaffold"),
        config: ConfigPaths.AUTOMATION_SCIENCE_240,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
        copies: 9,
    },
    "automation science with a belted buffer": {
        scaffold: path.join(SAMPLES, "science", "automation", "automation-120-foundries-feed-belt-to-assembler.scaffold"),
        config: ConfigPaths.AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER,
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
        scaffold: path.join(SAMPLES, "science", "logistic", "logistic-240-direct-insert.scaffold"),
        config: ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT,
        seed: [],
        warmup_ticks: 3600,
    },
    "logistic science with direct insertion (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "logistic", "logistic-240-direct-insert.scaffold"),
        config: ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    // The owner's full build (2026-11-04): 22 legendary assemblers in two rows of 11 (6 tiles apart), 120 beacons and 10 infinity
    // chests, the hand-made clock removed. The config is one row: 240 a second over 11 copies; the build is two of them, 480 over 22.
    // The bottom row is a mirror of the top (its inserters stand north of the belt: near lane 1, with the inserters on lane 1, where
    // the config has near lane 2 and the inserters on lane 2), accepted as the same pickup by the owner: the near lane holds the
    // inserter item in both rows.
    "logistic science (22 assemblers in two rows)": {
        scaffold: path.join(SAMPLES, "science", "logistic", "logistic-240.scaffold"),
        config: ConfigPaths.LOGISTIC_SCIENCE_240,
        seed: [],
        warmup_ticks: 3600,
        copies: 22,
    },
    // An accepted 0.27.0 gap (#586): the game serves the inserters in the simulator's order and the production is exact; the
    // wake-ups differ
    // The first of the three copies of the inserter build, 240 inserters a second over the three, as abucnasty gave it
    // (2026-11-10): an inserter assembler (4 speed modules, 8 beacons) fed plates by two furnaces and gears by a gear
    // assembler (5 beacons), which two more furnaces feed, all legendary. Each pair of furnaces takes its ore from a line
    // of its own; the ore and the circuits come from infinity chests, normal. The ore lines and the circuit belt end at an
    // underground entrance with nothing beyond; the product goes into a void chest. The output inserter runs all the time.
    "logistic science with inserter crafting": {
        scaffold: path.join(SAMPLES, "intermediates", "inserter-crafting", "inserter-crafting-240-shared-signal-clock.scaffold"),
        config: ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN,
    },
    "logistic science with inserter crafting (belts are backed up)": {
        scaffold: path.join(SAMPLES, "intermediates", "inserter-crafting", "inserter-crafting-240-shared-signal-clock.scaffold"),
        config: ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
        wake_ups_open: LOGISTIC_INSERTER_CRAFTING_WAKE_UPS_OPEN,
    },
    // The build of issue 98: two foundries, two electromagnetic plants and a cryogenic plant, 240 a second over three
    // copies. Its clock counts 792 ticks.
    "advanced circuit": {
        scaffold: path.join(SAMPLES, "intermediates", "advanced-circuit", "advanced-circuit.scaffold"),
        config: ConfigPaths.ADVANCED_CIRCUIT_240,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the simulator shows an output inserter as waiting on its machine in ticks the game shows it as working: "
            + "510 wake-ups a minute against 400 on 2026-10-10 (samples README, Advanced circuit)",
    },
    // The same build at 230 a second, the target the issue was reported at: its window cycle is not a whole number of ticks
    // (550.957), so its clock counts 12,672 ticks for 23 window cycles. No clock held it until the one search of 2026-10-11
    // found full-hand output swings that do; recorded that day, 16,192 in each of 2 repeats, 769 wake-ups a minute in
    // the game against 600 in the simulator.
    "advanced circuit at 230 a second": {
        scaffold: path.join(SAMPLES, "intermediates", "advanced-circuit", "advanced-circuit.scaffold"),
        config: ConfigPaths.ADVANCED_CIRCUIT_230,
        seed: [],
        warmup_ticks: 3600,
    },
    // One block of four chemical science assemblers, four engine assemblers and one foundry casting the pipes of all four
    // engines, all legendary with legendary modules and 40 legendary beacons: 5.5 copies of it make 240 a second. The
    // build was given 2026-10-15. Without a clock it makes 44.0 a second, a hair over the 43.636 the target asks of one
    // block; with the selected clock, 256 in each of 102 window cycles of 352 ticks, recorded 2026-10-15.
    "chemical science with a shared foundry": {
        scaffold: path.join(SAMPLES, "science", "chemical", "chemical-240-shared-foundry.scaffold"),
        config: ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY,
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
    // abucnasty's whole chemical science build (#725, 2026-11-09), as he gave it: both mirrored sides, 22 science and 22 engine
    // machines and 6 pipe foundries on the centre line 18 tiles apart, 5 whole blocks of the config and a half block at the east
    // end (a pipe foundry, the engine machine above and below it and the science machine each feeds), and two foundries at the
    // west end that cast the gears and the steel of both engine lines. Every input line ends in an underground entrance with
    // nothing beyond; the packs of both sides go onto one belt into a void chest. The config's 5.5 copies: 5 whole copies and
    // the part copy the generator lays out on the shared lanes (the first taker of each lane, with what it needs: half a block),
    // held to its share, half a copy's packs. The half block's pipe foundry has 5 beacons where the others have 8 (199.75 against
    // 236.78, computed from the blueprint); the config does not say it. Engine line 3 holds gears on the lane taken first,
    // where the config states steel: a difference not yet confirmed, and the config is as committed.
    "chemical science with a shared foundry (abucnasty's whole build, 5.5 copies)": {
        scaffold: CHEMICAL_SCIENCE_WHOLE_BUILD,
        config: ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY,
        seed: [],
        warmup_ticks: 3600,
        copies: 5.5,
    },
    // The same build on the clock it came with (made for one side of the build by the generator of 0.28.1, Coordinated Sources,
    // 352 ticks): it opens the advanced circuit takers of all the copies of a side together, and the dead-ended circuit lane
    // refills too late for the copy where the refill's edge stands, which makes too few packs (#725, measured in the game then:
    // 22, 12 and 30 of 32 in turn). Recorded 2026-11-11 at Factorio 2.1.24: the third science machine of each side from the
    // west moves 464 of 704 over the recording, and its copy, the second, 224, 192, 224 of its 256 in turn; every other copy
    // its target, the part copy 128, the build 1,376 or 1,344 of 1,408. An expected shortfall, kept as the proof that the check
    // of each copy sees it.
    "chemical science with a shared foundry (abucnasty's whole build on the clock it came with)": {
        scaffold: CHEMICAL_SCIENCE_WHOLE_BUILD,
        config: ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY,
        seed: [],
        warmup_ticks: 3600,
        copies: 5.5,
        own_clock: { short_copies: [2], why: "the circuit lane refills too late for one copy on each side (#725)" },
    },
    // One electromagnetic plant (legendary, five legendary productivity modules, 12 legendary beacons) on accumulators and
    // supercapacitors from one belt, its fluids from infinity pipes: 11 copies of it make 330 a second. A fully automatic config
    // (no override). The config's crafting speed is 109.475, what 12 beacons give in the game. The config states the copies 10 tiles
    // apart and both lanes of the belt as dead ends. The scaffold is abucnasty's two-copy blueprint at 10 tiles tiled to all 11
    // copies (its shared beacon columns, underground belts and infinity pipes are that blueprint's own): one belt from two stack
    // inserters a lane at infinity chests, running east past the 11 plants and ending in an underground entrance with nothing
    // beyond. Before, the scaffold was one copy: 1,056 in every window cycle checked on the selected clock (window cycle 2,112).
    "electromagnetic science": {
        scaffold: path.join(SAMPLES, "science", "electromagnetic", "electromagnetic-330.scaffold"),
        config: ConfigPaths.ELECTROMAGNETIC_SCIENCE_330,
        seed: [],
        warmup_ticks: 3600,
        copies: 11,
        wake_ups_open: "the game counts the first output inserter 0 wake-ups a minute, as it is never shown waiting, and the simulator 15.36, as it shows "
            + "both output inserters waiting on the machine in 1.56% of the ticks; the build moves its expected output in every period (recorded 2026-11-01: "
            + "25.6 a minute in all in the game, 41.0 in the simulator, 35.8 a minute of arm-away alarms on either side)",
    },
    // Two inserters each take two items off a belt of their own, and both take low density structures: which item
    // each takes first decides how the structures are split between them (near_lane in the config)
    "utility science": {
        scaffold: path.join(SAMPLES, "science", "utility", "utility-120.scaffold"),
        config: ConfigPaths.UTILITY_SCIENCE_120,
        seed: [],
        warmup_ticks: 3600,
    },
    "utility science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility", "utility-120.scaffold"),
        config: ConfigPaths.UTILITY_SCIENCE_120,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
    },
    // abucnasty's two copies of the build (2026-11-10), 9 tiles apart in one row: each a legendary utility science assembler (4
    // legendary productivity modules, 10 legendary beacons: 63.0078) taking flying robot frames from one turbo belt and low density
    // structures and processing units (one lane each) from another; both belts come from stack inserters at infinity chests, run
    // east past the two copies and end at an underground entrance with nothing beyond. The packs go onto a belt into a void chest.
    // 17.14 a second a copy, 120 over seven.
    "utility science with processing units and low density structures on one belt": {
        scaffold: path.join(SAMPLES, "science", "utility", "utility-120-processing-unit-and-lds-on-one-belt.scaffold"),
        config: ConfigPaths.UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT,
        seed: [],
        warmup_ticks: 3600,
        copies: 2,
    },
    "utility science with processing units and low density structures on one belt (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility", "utility-120-processing-unit-and-lds-on-one-belt.scaffold"),
        config: ConfigPaths.UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT,
        seed: [],
        warmup_ticks: 3600,
        backed_up_belts: true,
        copies: 2,
    },
    "low density structure": {
        scaffold: path.join(SAMPLES, "intermediates", "lds", "lds-240.scaffold"),
        config: ConfigPaths.LDS_240,
        seed: [],
        warmup_ticks: 3600,
    },
    // abucnasty's build of nine copies (2026-11-10), 16 tiles apart in one row: each copy is two electromagnetic plants, two
    // cryogenic plants and two foundries, all of it from machine to machine, the fluids from infinity pipes. The upper plants
    // drop onto one line and the lower plants onto another; on each line the drops of the first four copies are side-loaded onto
    // the other lane before the last five drop, and the line ends in a loader into a void chest. 35.56 a second a copy, 320 over
    // nine. The scaffold before was the build of issue 152 (one copy of 18 at 640 a second), where the clock 0.9.0 selected
    // made 512 to 544 of its 576 a window cycle.
    "accumulator": {
        scaffold: path.join(SAMPLES, "intermediates", "accumulator", "accumulator-320.scaffold"),
        config: ConfigPaths.ACCUMULATOR_320,
        seed: [],
        warmup_ticks: 3600,
        copies: 9,
    },
    // The lithium plate build: two cryogenic plants fill a rocket silo taken as a chest, and six furnaces empty it;
    // 80 a second from one copy. The warm-up fills the silo, which the config exports empty.
    "lithium plates through a rocket silo": {
        scaffold: path.join(SAMPLES, "smelting", "lithium-plate", "lithium-plate-80-silo-chest.scaffold"),
        config: ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the inserters into the silo agree (4 wake-ups a period each, game and simulator), but the furnace-to-belt "
            + "output inserters 11 and 12 wake 10 times a period in the game and 0 in a simulator that starts cold: the furnaces' output "
            + "levels the warm-up leaves decide it, and a simulator started from the recording's first sample equals the game (sim-game-check)",
    },
    // The iron plate build: a big mining drill drops ore into a car taken as a chest, and two furnaces empty it; 80 a
    // second from one copy. The harness puts the ore under the drill; at its research the drill keeps the car full.
    "iron plates through a car": {
        scaffold: path.join(SAMPLES, "smelting", "iron-plate", "iron-plate-80-car-chest.scaffold"),
        config: ConfigPaths.IRON_PLATE_80_CAR_CHEST,
        seed: [],
        warmup_ticks: 3600,
        wake_ups_open: "the simulator counts 200.0 a minute from the scaffold's cold start, its two output inserters woken by their "
            + "furnaces 100 times a minute each, and 0.0 from other starts; the game's states give 3.8 on 2026-10-22 (1.3 for each "
            + "output inserter, 0.6 for each inserter from the car), for a reason not yet found: ",
        crafts_open: {
            machine_ids: [1, 2],
            why: "#587: the two furnaces finish 193.17 crafts and productivity bars a period in the game under the minute-long recording "
                + "and 194.00 in the simulator, while the build moves 96 plates in every period (samples README, smelting/iron-plate)",
        },
    },
    // The steel build: one cargo wagon is a hub that a big mining drill fills with ore, two furnaces take from and
    // put back into (ore to plates, plates to steel), and one inserter empties of steel onto the output belt; 26 a second
    // from one copy. The harness puts the ore under the drill and builds the wagon after its rails.
    "steel plates around a cargo wagon": {
        scaffold: path.join(SAMPLES, "smelting", "steel-plate", "steel-plate-26-wagon-chest.scaffold"),
        config: ConfigPaths.STEEL_PLATE_26_WAGON_CHEST,
        seed: [],
        warmup_ticks: 3600,
    },
    // The owner's rocket fuel build (2026-11-04): jellynut processing between two rocket fuel biochambers (legendary, four
    // legendary productivity modules each, 13 legendary beacons), 60 a second from one copy. Bioflux and jellynut come on one
    // moving turbo belt from infinity chests and drain into a void chest; nutrients come on a belt of their own whose end lets
    // 8 ticks in 61 through, and the seeds return on its other lane; water comes from an infinity pipe.
    "rocket fuel": {
        scaffold: path.join(SAMPLES, "gleba", "rocket-fuel", "rocket-fuel-60.scaffold"),
        config: ConfigPaths.ROCKET_FUEL_60,
        seed: [],
        warmup_ticks: 3600,
    },
    // The owner's stone brick build (2026-11-04): a drill (6 beacons, no modules) drops its stone straight into an electric
    // furnace (two legendary productivity modules, 8 beacons) whose one output inserter puts the bricks on a moving belt that
    // drains into a void chest; 40 a second from one copy, 120 over three. The harness puts the ore under the drill.
    "stone bricks from a drill into a furnace": {
        scaffold: path.join(SAMPLES, "smelting", "stone-brick", "stone-brick-120-drill-direct-insert.scaffold"),
        config: ConfigPaths.STONE_BRICK_120_DRILL_DIRECT_INSERT,
        seed: [],
        warmup_ticks: 3600,
    },
    // abucnasty's production science build (2026-11-05), one copy of it as abucnasty gave it (2026-11-10): one science assembler
    // (legendary, 63.0078) fed rails by a rail assembler (four legendary speed modules, 2 beacons: 46.3713), whose steel comes from
    // one foundry and whose iron sticks come from another, both on molten iron from infinity pipes; a drill drops stone straight
    // into the rail assembler. Electric furnaces and productivity modules come on one turbo belt (one lane each) from two infinity
    // chests; it ends at an underground entrance with nothing beyond, and one inserter takes both. The packs go onto a belt that
    // runs through an underground belt to a loader into a void chest. 17.14 a second from one copy, 120 over seven, 10 tiles apart.
    "production science with a drill into the rail assembler": {
        scaffold: path.join(SAMPLES, "science", "production", "production-120-two-belts.scaffold"),
        config: ConfigPaths.PRODUCTION_SCIENCE_120_TWO_BELTS,
        seed: [],
        warmup_ticks: 3600,
    },
    // The owner's processing unit build (2026-11-05): one electromagnetic plant (legendary, 90.372) between two infinity chests, one
    // chest of circuits (200 of each kind) and one that voids the units, each through one inserter; the sulfuric acid comes from an
    // infinity pipe. 15 a second from one copy (the build's most is 36.1). The game's inserter takes advanced circuits first from the
    // chest, the item its inventory order puts last (#617); the clock selected before that rule (Takt Batches: 1 output swing each output cycle) made half.
    "processing units between two chests": {
        scaffold: path.join(SAMPLES, "intermediates", "processing-unit", "processing-unit-15-chest-fed.scaffold"),
        config: ConfigPaths.PROCESSING_UNIT_15_CHEST_FED,
        seed: [],
        warmup_ticks: 3600,
    },
    // abucnasty's military science build (2026-11-09), the whole of it: five copies 9 tiles apart, each a mirrored pair around one
    // foundry (a military science assembler fed grenades by a grenade assembler above the foundry, and the same below it), 48 a second
    // a copy, 240 over the five. Each half has a belt of stone walls and piercing rounds and a coal belt from stack inserters at
    // infinity chests, both ending in a dead end, and a packs belt into a void chest. Each half's coal comes on two belts that three
    // priority splitters join, which the config does not model: it gives each copy coal lanes of its own.
    "military science with grenades (five mirrored pairs)": {
        scaffold: path.join(SAMPLES, "science", "military", "military-240.scaffold"),
        config: ConfigPaths.MILITARY_SCIENCE_240,
        seed: [],
        warmup_ticks: 3600,
        copies: 5,
    },
    // abucnasty's flying robot frame build (2026-11-09): 12 legendary assemblers (68.8906) in two rows of 6, 6 tiles apart. Each
    // input belt is one line that runs past one row, turns, runs back past the other row and ends in a dead end: steel and
    // engine units on one, circuits and batteries on the other, from stack inserters at infinity chests. 8 of the 12 copies take
    // steel and engine units from an underground belt's half tile. Each row puts its frames onto a belt of its own into a void
    // chest. The config is the whole build: 80 a second over 12 copies, 6.67 a copy. The full design is two of these builds,
    // mirrored, 160 a second.
    "flying robot frames (12 assemblers in two rows)": {
        scaffold: path.join(SAMPLES, "intermediates", "flying-robot-frame", "flying-robot-frame-80.scaffold"),
        config: ConfigPaths.FLYING_ROBOT_FRAME_80,
        seed: [],
        warmup_ticks: 3600,
        copies: 12,
    },
    // The owner's electric furnace build (2026-11-05): an electric furnace assembler (57.8125) taking steel from a foundry (185),
    // stone bricks from three furnaces (80.0375) that each have a drill of their own dropping stone into them (speed bonuses 15.3075,
    // 12.5 and 13.975), and advanced circuits from two infinity chests on one backed-up belt. The furnaces go onto a moving belt into
    // a void chest. 10 a second from one copy, 20 over two.
    "electric furnaces with a drill for each brick furnace": {
        scaffold: path.join(SAMPLES, "intermediates", "electric-furnace", "electric-furnace-20.scaffold"),
        config: ConfigPaths.ELECTRIC_FURNACE_20,
        seed: [],
        warmup_ticks: 3600,
    },
    "iron bacteria cultivation": {
        scaffold: path.join(SAMPLES, "gleba", "iron-bacteria", "iron-bacteria-380-cultivation.scaffold"),
        config: ConfigPaths.IRON_BACTERIA_380_CULTIVATION,
        // the machines make bacteria from bacteria, so they are given some to begin with
        seed: [{ target: { recipe: "iron-bacteria-cultivation" }, item: "iron-bacteria", count: 50 }],
        warmup_ticks: 300,
        // recorded 2026-10-24 on Takt Batches: 6 output swings each output cycle (subtick) with windows on the loop's two inserters (ticks 15 to 23
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

/**
 * What a row of output inserters of a build of copies moves at the least in a window cycle: one copy's output times the
 * row's output inserters over the output inserters of one copy. A copy with one output inserter gives its row the whole
 * of its output; a copy with an output inserter in each of two rows gives each row half of it.
 */
function rowTarget(copy_output: number, row_output_inserters: number, copy_output_inserters: number): number {
    return Math.round(copy_output * row_output_inserters / copy_output_inserters * 1e6) / 1e6;
}

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

/** The clocks the values of eight builds belong to (scaffold-recordings-clock-pins.json); clock-controls.test.ts checks the selection against the record, and clock-belt.generation.test.ts the build with backed-up belts */
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
        const title = build.own_clock
            ? `the ${name} build leaves copy ${build.own_clock.short_copies.join(", ")} short, as it is known to, and every other copy at its target`
            : `one copy of the ${name} build moves the expected output every clock period`;
        test(title, async context => {
            context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
            if (KEEP) {
                fs.mkdirSync(KEEP, { recursive: true });
            }
            scratch ??= KEEP ?? fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-recordings-"));
            const base = path.join(scratch, name.replace(/ /g, "-"));

            const loaded = await loadConfigFromFile(build.config);
            const config = build.backed_up_belts ? { ...loaded, overrides: { ...loaded.overrides, backed_up_belts: true } } : loaded;
            const blueprint = fs.readFileSync(build.scaffold, "utf-8").trim();
            // the build's own clock is kept and nothing is generated; else the clock the generator selects
            const generated = build.own_clock ? null : generateClockAlternatives(config, { logger: quiet });
            const selected = generated?.alternatives[generated.selected_index];
            if (selected) {
            if (build.backed_up_belts) {
                expect(selected.belt, `the selected clock (${selected.label}) is made without belt pickup slack`).toEqual({ kind: "backed_up" });
            }
            // stable, but for a build with a deadlock risk: there a clock that holds its expected output is selected
            // whether it gets back from every backpressure loss or not (GOALS.md, "Two inserters that bring the same item")
            const holds = selected.deadlock_risks.length > 0 ? selected.verdict !== "unstable" : selected.verdict === "stable";
            expect(holds, `the selected clock (${selected.label}) is stable in the simulator`).toBe(true);
            // a clock of fractional swings can leave the rate a hair off the whole number (240 reads 239.99999999999997)
            expect(selected.assessment.items_per_second, `the selected clock (${selected.label}) reaches the target rate in the simulator`)
                .toBeCloseTo(config.setpoint.items_per_second, 6);
            }

            // A fractional window cycle is built as a subtick clock, which counts the whole ticks after which the window cycle
            // repeats (1728 for 19 window cycles of 90.947): that is the window cycle the recording is cut into, and what it has
            // to move is what that many ticks ask for.
            const subtick = selected?.result.subtick;
            const window_cycle_ticks = selected ? subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks : clockWindowCycleTicks(blueprint);
            expect(window_cycle_ticks, "the build's own clock is a clock the recorder reads (\"Clock for ...\")").not.toBeNull();
            if (window_cycle_ticks === null) return;
            context.skip(!build.staged_start && window_cycle_ticks > MAX_RECORDED_WINDOW_CYCLE,
                `the selected clock counts ${window_cycle_ticks} ticks, over the ${MAX_RECORDED_WINDOW_CYCLE} ticks one period of a recording may take`);
            // a subtick clock's repeat and a rate per copy can leave a float a hair off the whole number of items
            const copies = build.copies ?? 1;
            const recipes = [...recipesMaking(config, config.setpoint.recipe)];
            const finals_per_copy = config.machines.filter(machine => recipes.includes(machine.recipe)).length;
            // a count with a fraction is whole copies and one part copy, held to its share of a copy's output (partCopiesOf, the
            // generator's part copy); the build's output and its final machines are the whole copies' and the part copy's
            const whole_copies = Math.floor(copies + 1e-9);
            const part = copies - whole_copies > 1e-9 ? partCopiesOf(config)[0] : undefined;
            expect(part !== undefined || copies === whole_copies, `the config has a part copy for the ${copies - whole_copies} of a copy the build holds`).toBe(true);
            const counted_copies = whole_copies + (part?.share ?? 0);
            const part_finals = part ? config.machines.filter(machine => recipes.includes(machine.recipe) && part.ids.has(`machine:${machine.id}`)).length : 0;
            const expected_per_copy = Math.round(config.setpoint.items_per_second / config.setpoint.copies * window_cycle_ticks / 60 * 1e6) / 1e6;
            const expected = Math.round(expected_per_copy * counted_copies * 1e6) / 1e6;
            // what the machines that make the target item have to finish over the trailing minute for steady state
            const expected_per_window = Math.round(config.setpoint.items_per_second / config.setpoint.copies * counted_copies * WINDOW_TICKS / 60 * 1e6) / 1e6;
            // the clock with its schedule as the generator made it, which the harness wires without reading descriptions
            const exported = selected ? subtick ?? selected.result : null;
            // the dips and issues this build expects were seen on one clock: on another they say nothing
            if (clockPins[name] && exported) {
                expect(clockHash(exported), `the selected clock (${selected!.label}) is not the one the values of ${name} were recorded on (scaffold-recordings-clock-pins.json)`)
                    .toBe(clockPins[name].clock_sha256);
            }
            const clock = exported ? { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule } : undefined;
            // the probe ends the settle at steady state (a staged start: cuts the recording a minute after it); it writes its
            // report into the game's script-output, which the build has a folder of its own for (all builds share the one game
            // watched)
            const probe = composeProbeSource(path.join(__dirname, "scaffold-recordings-probe.lua"), {
                window: WINDOW_TICKS, expected: expected_per_window, recipes, item: config.setpoint.recipe, cap: SETTLE_CAP_TICKS,
                output: STEADY_REPORT, staged: !!build.staged_start, ticks: SETTLE_CAP_TICKS,
            });
            const work_dir = WATCH ? path.join(scratch, "watch-game") : `${base}-game`;
            let result: HarnessResult;
            let steady: SteadyReport;
            let inserter_positions: { unit_number: number; x: number; y: number }[] = [];
            try {
                result = await record({
                    factorio: FACTORIO!,
                    save: SAVE!,
                    blueprint,
                    out: `${base}.json`,
                    // a clock longer than a minute: a tick more than its window cycle, so the recorder holds a whole window cycle between two wraps
                    ticks: build.staged_start ? SETTLE_CAP_TICKS : Math.max(RECORDED_TICKS, window_cycle_ticks + 1),
                    warmup_ticks: build.staged_start ? 0 : build.warmup_ticks,
                    settle_ticks: build.staged_start ? undefined : SETTLE_CAP_TICKS + 1,
                    seed: build.staged_start ? [] : build.seed,
                    staged_start: build.staged_start ? {} : undefined,
                    clock,
                    config,
                    // the copies are named to wire a generated clock to each; the build's own clock is wired as it came
                    copies: clock ? build.copies : undefined,
                    unclocked: false,
                    game_speed: UNWATCHED_SPEED,
                    watch: WATCH,
                    timeout_seconds: WATCH ? 3600 : 900,
                    log: () => { },
                    work_dir,
                    lua: KEEP || copies > 1 ? `do ${INSERTER_POSITIONS_LUA} end\n${probe}` : probe,
                });
                steady = JSON.parse(fs.readFileSync(path.join(work_dir, "script-output", STEADY_REPORT), "utf-8")).protocol;
                if (copies > 1) {
                    inserter_positions = JSON.parse(fs.readFileSync(path.join(work_dir, "script-output", "inserter-positions.json"), "utf-8"));
                }
            } finally {
                if (!KEEP && !WATCH) {
                    fs.rmSync(work_dir, { recursive: true, force: true });
                }
            }

            if (build.staged_start) {
                // a staged recording does not read the clock (the recorder ignores it: it records fixed ticks from the tick the
                // inserters are placed in), and the clock is wired in that tick to count its window cycle from the first sample
                result.recording.clock = { values: Array.from({ length: result.recording.sample_count }, (_, tick) => tick % window_cycle_ticks) };
            }

            // the simulator against the game, entity by entity: a run of the same clock, half as long again as the
            // recording and judged on what follows its first third, moves what the game moved through every inserter
            // and finishes what it finished in every machine (asserted below, once the evidence is kept)
            // (a build of copies has no run of one copy to compare entity by entity)
            const simulated_run = selected && copies === 1
                ? simulateRecording(config, selected.result.clock_windows, selected.result.simulation_duration.ticks, result.recording.sample_count * 1.5, window_cycle_ticks) : null;
            const compared = simulated_run === null ? null : compareRecordings(
                {
                    recording: result.recording,
                    match: matchRecordingToConfig(result.recording, config),
                    from_sample: build.staged_start ? Math.floor(result.recording.sample_count / 3) : undefined,
                },
                { recording: simulated_run, match: matchOfSimulatedRecording(simulated_run), from_sample: Math.floor(simulated_run.sample_count / 3) },
                config,
                { expected_output_per_window_cycle: expected },
            );
            const window_cycles = outputPerWindowCycle(result.recording, recipesMaking(config, config.setpoint.recipe));
            // a build of copies: what each row of copies (the output inserters at one height) moved in each window cycle, as the game recorded it
            const row_of = new Map(inserter_positions.map(it => [it.unit_number, it.y]));
            const output_unit_numbers = outputInserters(result.recording, recipesMaking(config, config.setpoint.recipe)).map(it => it.unit_number!);
            const row_ys = Array.from(new Set(output_unit_numbers.map(unit => row_of.get(unit)))).filter((y): y is number => y !== undefined).sort((a, b) => a - b);
            const outputs = outputInserters(result.recording, recipesMaking(config, config.setpoint.recipe));
            /** What the given output inserters moved in each window cycle, as the game recorded their hands */
            const movedPerWindowCycle = (members: typeof outputs) => window_cycles.map(window_cycle => ({ start: window_cycle.start, end: window_cycle.end, items: members.reduce((sum, inserter) => {
                const held = inserter.samples.held_count;
                let moved = 0;
                for (let i = Math.max(window_cycle.start, 1); i < window_cycle.end; i++) {
                    if (held[i] < held[i - 1]) moved += held[i - 1] - held[i];
                }
                return sum + moved;
            }, 0) }));
            const rows = copies > 1 ? row_ys.map(y => {
                const members = outputs.filter(it => row_of.get(it.unit_number!) === y);
                return { y, output_inserters: members.length, per_window_cycle: movedPerWindowCycle(members) };
            }) : [];
            // a build of copies: what each copy moved in each window cycle, the copies found as the harness found them to wire the
            // clock (machines that inserters join, matched to the config one by one), in the order of their lowest machine ids, and
            // the part copy last, with its share of a copy's output as its target
            const found = copies > 1 ? builtCopies({
                config: result.recording.config,
                inserters: Object.fromEntries(result.recording.inserters.map(row => [row.id, row])),
                machines: Object.fromEntries(result.recording.machines.map(row => [row.id, row])),
            }, config, copies) : null;
            const per_copy = (found?.inserters ?? []).map((unit_numbers, index) => {
                const units = new Set(unit_numbers.values());
                const members = outputs.filter(it => units.has(it.unit_number!));
                const is_part = found!.part?.index === index;
                const target = Math.round(expected_per_copy * (is_part ? found!.part!.share : 1) * 1e6) / 1e6;
                return { copy: index + 1, part: is_part, target, output_inserters: members.length, per_window_cycle: movedPerWindowCycle(members) };
            });
            if (KEEP) {
                if (simulated_run) fs.writeFileSync(`${base}.simulated.json`, JSON.stringify(simulated_run));
                fs.writeFileSync(`${base}.meta.json`, JSON.stringify({
                    name, label: selected?.label ?? "the build's own clock", verdict: selected?.verdict ?? null, period: window_cycle_ticks, expected,
                    clock_windows: selected?.result.clock_windows ?? null, simulation_ticks: selected?.result.simulation_duration.ticks ?? null, backed_up_belts: !!build.backed_up_belts,
                    staged_start: !!build.staged_start, issues: compared?.issues ?? [], config, harness_build: result.build,
                    harness_start: result.start, periods: window_cycles, steady, copies, expected_per_copy, rows, per_copy,
                }, null, 1));
            }
            // the build reached steady state in the game, within the ticks it may take (the build's own clock that leaves a copy short need not)
            expect(steady.error, "the probe failed in the game").toBeUndefined();
            if (!build.own_clock) {
                expect(steady.steady, `the build did not reach steady state within ${SETTLE_CAP_TICKS} ticks (${steady.result ?? "the game ended first"})`).toBeDefined();
            }
            // the machines the probe counted are those of the config that make the target item, in every whole copy and the part copy
            expect(Array.isArray(steady.finals) ? steady.finals : [], "the final machines the probe counts")
                .toHaveLength(finals_per_copy * whole_copies + part_finals);
            expect(window_cycles.length, `the recording of ${result.recording.sample_count} ticks holds a whole clock period`).toBeGreaterThan(0);
            // the first window cycle is left out: the build may still be settling into the clock. A clock that counts over a minute is
            // recorded over one window cycle, which is checked whole: the settle ended at steady state
            const checked = window_cycles.length > 1 ? window_cycles.slice(1) : window_cycles;
            const wrong_length = checked.filter(it => it.end - it.start !== window_cycle_ticks);
            expect(wrong_length, `every one of the ${checked.length} periods checked lasts ${window_cycle_ticks} ticks, as the clock does`).toEqual([]);
            /** The window cycles checked of a copy in which it moved less than its target */
            const shortOf = (copy: typeof per_copy[number]) => (copy.per_window_cycle.length > 1 ? copy.per_window_cycle.slice(1) : copy.per_window_cycle)
                .filter(it => it.items < copy.target - 1e-6).map(it => ({ start: it.start, items: it.items }));
            if (build.own_clock) {
                // the copies the build's own clock leaves short, and no other: the check of each copy sees what the total hides
                expect(per_copy.length, `the build holds ${copies} copies`).toBe(Math.ceil(copies - 1e-9));
                expect(per_copy.filter(copy => shortOf(copy).length > 0).map(copy => copy.copy),
                    `the copies short of their target in a window cycle checked (${per_copy.map(copy => `${copy.copy}: ${shortOf(copy).map(it => it.items).join("/") || "none"}`).join("; ")})`)
                    .toEqual(build.own_clock.short_copies);
                return;
            }
            if (copies > 1) {
                // 100% or more of the target, each row on its own (copies of the row at one height) and the whole build; recorded raw.
                // A build whose copies all stand in one row is one row, whose share is the whole build's output.
                const per_row = config.setpoint.copies;
                expect(rows.length, `the output inserters of the build stand in one row or more (heights: ${row_ys.join(", ")})`).toBeGreaterThanOrEqual(1);
                const wholes = per_copy.filter(copy => !copy.part);
                const copy_output_inserters = wholes[0]?.output_inserters ?? 0;
                expect(wholes.map(copy => copy.output_inserters),
                    `the build's ${output_unit_numbers.length} output inserters are the same number in each of its ${wholes.length} whole copies`).toEqual(wholes.map(() => copy_output_inserters));
                expect(copy_output_inserters).toBeGreaterThan(0);
                for (const row of rows) {
                    const row_expected = rowTarget(expected_per_copy, row.output_inserters, copy_output_inserters);
                    const row_checked = row.per_window_cycle.length > 1 ? row.per_window_cycle.slice(1) : row.per_window_cycle;
                    expect(row_checked.map(it => ({ start: it.start, items: it.items })).filter(it => it.items < row_expected - 1e-6),
                        `every one of the ${row_checked.length} periods checked of the row at y=${row.y} (${row.output_inserters} output inserters, ${per_row} copies wanted) moves ${row_expected} items of ${config.setpoint.recipe} or more`).toEqual([]);
                }
                // each copy on its own: a copy the others starve on a lane they share is short here, whatever the rows and the build make;
                // the part copy against its share
                expect(per_copy.length, `the build holds ${copies} copies`).toBe(Math.ceil(copies - 1e-9));
                for (const copy of per_copy) {
                    expect(shortOf(copy), `every period checked of ${copy.part ? "the part copy" : "copy"} ${copy.copy} of ${copies} moves ${copy.target} items of ${config.setpoint.recipe} or more`).toEqual([]);
                }
                expect(checked.filter(it => it.items < expected - 1e-6).map(it => ({ start: it.start, items: it.items })),
                    `every one of the ${checked.length} periods checked moves ${expected} items of ${config.setpoint.recipe} or more over the ${copies} copies`).toEqual([]);
                return;
            }
            const short = checked.filter(it => it.items !== expected);
            expect(short.map(it => ({ start: it.start, items: it.items })),
                `every one of the ${checked.length} periods checked moves ${expected} items of ${config.setpoint.recipe}`
                + (build.staged_start ? ", but those the game was short in after the staged start" : "")).toEqual(build.staged_start?.dips ?? []);

            // goal 2: the long run of the selected clock counts the wake-ups the game shows (a build of one copy, on a generated clock)
            if (!selected || !compared) throw new Error("a build of one copy is recorded on the selected clock");
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
            const issues = compared!.issues.filter(issue => !known.some(name => issue.startsWith(name) || issue.includes(`. ${name}`)));
            expect(issues, "the simulator moves what the game moved, through every inserter and machine").toEqual(build.staged_start?.open_issues ?? []);
        }, TEST_TIMEOUT_MS);
    }
});
