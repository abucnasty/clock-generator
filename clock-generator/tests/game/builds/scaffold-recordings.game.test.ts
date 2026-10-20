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
/** As fast as the machine allows */
const UNWATCHED_SPEED = 1000;
/** Well under that: remote play can't keep up with the game rendering that fast */
const WATCH_SPEED = 1;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

const SAMPLES = path.join(SAMPLE_BUILDS_DIR);
/** Ticks to record: ten minutes of game time, as a build with a loop is checked for in the simulator */
const RECORDED_TICKS = 36_000;
/**
 * How far the simulator's wake-ups a minute may be off the game's (GOALS.md, goal 2), as a share of the game's. On
 * 2026-10-10 the simulator counted what the game did on automation science and 7 to 21% fewer on the other four
 * builds: the states of the inserters agree, what is left is when the machines finish their crafts within a window.
 * To be tightened as that is found; before the game's rule for a waiting inserter was in the simulator it was off by
 * up to 47%.
 */
const WAKE_UPS_TOLERANCE = 0.25;
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
    /** Ticks the build runs before it is seeded, so belts are full */
    warmup_ticks: number;
    /** Ticks the build runs on the generated clock before the recording starts, so its start-up is left out */
    settle_ticks: number;
    /** The clock is made for backed-up belts (`overrides.backed_up_belts`), which is what a scaffold has */
    backed_up_belts?: boolean;
    /**
     * The build is recorded from the staged start of the harness, as the simulator runs it: the belts are saturated first,
     * then every inserter of the cell and the clock are placed in one tick, with the machines empty but for the egg loop,
     * seeded once. `warmup_ticks` and `settle_ticks` are not used, and the recording holds the first periods of the clock,
     * which the build may still be settling into: the periods are cut from the first sample (the recorder does not read the
     * clock of a staged start), and the game is compared with the simulator on what follows the first third of each.
     */
    staged_start?: {
        /** The periods of the recording that move less than the expected output, as the game showed them: where each starts, and the items it moved */
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
}

const BUILDS: Record<string, ScaffoldBuild> = {
    "agricultural science": {
        scaffold: path.join(SAMPLES, "science", "agriculture-science", "agriculture-science-scaffold.txt"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE,
        // the egg loop cannot start itself, so the egg machines are given eggs to begin with
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        settle_ticks: 4800,
        // Recorded 2026-10-16 (swings-2 is the selected clock): 800 in every period but two in a row, one hand (16) short each
        // time, in periods 8 and 9 of the settling after the staged start; the same clock in the game a run before gave the
        // same two, and the batched clock holds its 400 in all 119 periods of a run of 57,600 ticks. The simulator has such a
        // one-hand dip too, in other periods (its 2nd period after the first third), and Inserter 11 moves 371.33 items a
        // period in the game against 368.00 in the simulator.
        staged_start: {
            dips: [{ start: 7680, items: 784 }, { start: 8640, items: 784 }],
            open_issues: [
                "Inserter 11 (belt 1 -> machine 5) moves 371.33 items a period in the game and 368.00 in the simulator.",
                "The simulator put out something other than the expected 800 items in 1 of 18 clock periods (2: 784).",
            ],
        },
    },
    // its clocks have no belt pickup slack: batched swings has room for a hand of fuel in the windows of the three
    // inserters that take nutrients off the belt with their bioflux, without which they do not hold. Since the rules of
    // issue 152 (2026-10-14) batched swings gets back from every loss and is selected; from 2026-10-10 until then the
    // clock with 2 output swings per cycle was, since batched swings did not get back from a loss of nutrients
    "agricultural science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "agriculture-science", "agriculture-science-scaffold.txt"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        settle_ticks: 4800,
        backed_up_belts: true,
        moved_open: {
            inserter_ids: [3, 4, 6, 7],
            why: "under the 2-swing clock the inserters that bring nutrients to the egg biochambers move 979.89 nutrients a period in "
                + "the game and 980.85 in the simulator, of which 800 packs come out in both",
        },
    },
    "automation science": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
    },
    // its selected clock has no belt pickup slack: full-hand output swings, which the simulator holds stable without it
    "automation science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
        backed_up_belts: true,
    },
    "automation science with a belted buffer": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-belted-buffer-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
        // Pre-existing, not from the belt window trim: the copper foundry's output inserter wakes 25 a minute in
        // the game and 5 in the simulator, because the game counts a held product when it enters the output and
        // the simulator when it is made (docs/simulator.md). The gap crossed the tolerance only once the trim cut
        // the build's total wake-ups 100 -> 75 a minute; the trimmed belt inserter itself matches the game tick
        // for tick (work/belt-pickup-parity/belted-buffer-wakeups/REPORT.md):
        wake_ups_open: "the game counts a foundry's held product entering its output, the simulator the make: ",
    },
    // The build of issue 98: two foundries, two electromagnetic plants and a cryogenic plant, 240 a second over three
    // copies. Its clock of 792 ticks takes two periods more than the others to settle.
    "advanced circuit": {
        scaffold: path.join(SAMPLES, "intermediates", "advanced-circuit", "advanced-circuit-scaffold.txt"),
        config: ConfigPaths.ADVANCED_CIRCUIT,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 4800,
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
        settle_ticks: 4800,
    },
    // One block of four chemical science assemblers, four engine assemblers and one foundry casting the pipes of all four
    // engines, all legendary with legendary modules and 40 legendary beacons: 5.5 copies of it make 240 a second. The
    // owner's build of 2026-10-15. Without a clock it makes 44.0 a second, a hair over the 43.636 the target asks of one
    // block; with the selected clock, 256 in each of 102 periods of 352 ticks, recorded 2026-10-15.
    "chemical science with a shared foundry": {
        scaffold: path.join(SAMPLES, "science", "chemical-science", "chemical-science-shared-foundry-scaffold.txt"),
        config: ConfigPaths.CHEMICAL_SCIENCE_SHARED_FOUNDRY,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 4800,
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
        settle_ticks: 2400,
    },
    // The same build with both output inserters on AUTO. Recorded 2026-10-16 on the same batched swings clock (period 704): from a
    // staged start (empty machines) 288 in the first period and 352 in each of the 50 after; on this test's start (warm-up and settle) 352 in every period checked.
    "electromagnetic science with its output inserters on AUTO": {
        scaffold: path.join(SAMPLES, "science", "electromagnetic-science", "electromagnetic-science-scaffold.txt"),
        config: ConfigPaths.ELECTROMAGNETIC_SCIENCE_AUTO,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    // Two inserters each take two items off a belt of their own, and both take low density structures: which item
    // each takes first decides how the structures are split between them (near_lane in the config)
    "utility science": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    "utility science (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
        backed_up_belts: true,
    },
    "utility science with processing units and low density structures on one belt": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    "utility science with processing units and low density structures on one belt (belts are backed up)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
        backed_up_belts: true,
    },
    "low density structure": {
        scaffold: path.join(SAMPLES, "intermediates", "low-density-structure", "low-density-structure-scaffold.txt"),
        config: ConfigPaths.LOW_DENSITY_STRUCTURE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    // The build of issue 152: two electromagnetic plants, two cryogenic plants and two foundries, 640 a second over 18
    // copies, all of it from machine to machine. The clock 0.9.0 selected made 512 to 544 of its 576 a period here.
    // It settles from the scaffold's start over 4 periods of 972 ticks after the 2,400 the others take.
    "accumulator": {
        scaffold: path.join(SAMPLES, "intermediates", "accumulator", "accumulator-640-scaffold.txt"),
        config: ConfigPaths.ACCUMULATOR_640,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 7200,
    },
    "iron bacteria cultivation": {
        scaffold: path.join(SAMPLES, "gleba", "iron-bacteria-cultivation", "iron-bacteria-cultivation-scaffold.txt"),
        config: ConfigPaths.IRON_BACTERIA_CULTIVATION,
        // the machines make bacteria from bacteria, so they are given some to begin with
        seed: [{ target: { recipe: "iron-bacteria-cultivation" }, item: "iron-bacteria", count: 50 }],
        warmup_ticks: 300,
        settle_ticks: 3600,
    },
};

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
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 60_000);

// one build at a time: each test waits for its own recording before the next starts
describe.sequential("the selected clock holds the target rate in Factorio", () => {
    for (const [name, build] of Object.entries(BUILDS)) {
        test(`one copy of the ${name} build moves the expected output every clock period`, async context => {
            context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
            scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-recordings-"));

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
            // a subtick clock's repeat and a rate per copy can leave a float a hair off the whole number of items
            const expected = Math.round(config.target_output.items_per_second / config.target_output.copies * period / 60 * 1e6) / 1e6;
            // the clock with its schedule as the generator made it, which the harness wires without reading descriptions
            const exported = subtick ?? selected.result;
            const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
            const result = await record({
                factorio: FACTORIO!,
                save: SAVE!,
                blueprint: fs.readFileSync(build.scaffold, "utf-8").trim(),
                out: path.join(scratch, `${name.replace(/ /g, "-")}.json`),
                ticks: RECORDED_TICKS,
                warmup_ticks: build.staged_start ? 0 : build.warmup_ticks,
                settle_ticks: build.staged_start ? undefined : build.settle_ticks,
                seed: build.staged_start ? [] : build.seed,
                staged_start: build.staged_start ? {} : undefined,
                clock,
                config,
                unclocked: false,
                game_speed: UNWATCHED_SPEED,
                watch: WATCH,
                timeout_seconds: WATCH ? 3600 : 900,
                log: () => { },
            });

            if (build.staged_start) {
                // a staged recording does not read the clock (the recorder ignores it: it records fixed ticks from the tick the
                // inserters are placed in), and the clock is wired in that tick to count its period from the first sample
                result.recording.clock = { values: Array.from({ length: result.recording.sample_count }, (_, tick) => tick % period) };
            }
            const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
            expect(periods.length, `the recording of ${result.recording.sample_count} ticks holds whole clock periods`).toBeGreaterThan(1);
            // the first period is left out: the build may still be settling into the clock
            const checked = periods.slice(1);
            const wrong_length = checked.filter(it => it.end - it.start !== period);
            expect(wrong_length, `every one of the ${checked.length} periods checked lasts ${period} ticks, as the generated clock does`).toEqual([]);
            const short = checked.filter(it => it.items !== expected);
            expect(short.map(it => ({ start: it.start, items: it.items })),
                `every one of the ${checked.length} periods checked moves ${expected} items of ${config.target_output.recipe}`
                + (build.staged_start ? ", but those the game was short in after the staged start" : "")).toEqual(build.staged_start?.dips ?? []);

            // goal 2: the long run of the selected clock counts the wake-ups the game shows
            const simulated = selected.result.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
            const recorded = wakeUpsOfRecording(result.recording, matchRecordingToConfig(result.recording, config)).wake_ups_per_minute;
            expect(simulated, `the long run of the selected clock (${selected.label}) counted its wake-ups`).toBeDefined();
            const asRecorded = (figure: number) => Math.abs(figure - recorded) <= WAKE_UPS_TOLERANCE * recorded;
            const by_start = asRecorded(simulated!) ? []
                : simulatedWakeUpsByStart(config, selected.result.clock_windows, selected.result.simulation_duration.ticks, WAKE_UPS_START_PHASES);
            const figures = Array.from(new Set([simulated!, ...by_start].map(figure => figure.toFixed(1)))).join(", ");
            if (build.wake_ups_open === undefined) {
                expect([simulated!, ...by_start].some(asRecorded),
                    `the simulator counts ${figures} wake-ups a minute, by where the clock starts, where the game shows ${recorded.toFixed(1)}`).toBe(true);
            }

            // the simulator against the game, entity by entity: a run of the same clock, half as long again as the
            // recording and judged on what follows its first third, moves what the game moved through every inserter
            // and finishes what it finished in every machine
            const simulated_run = simulateRecording(config, selected.result.clock_windows, selected.result.simulation_duration.ticks, RECORDED_TICKS * 1.5, period);
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
            const known = (build.moved_open?.inserter_ids ?? []).map(id => `Inserter ${id} (`);
            // an issue names its inserter at its start or, for one about how the config describes the build, after a sentence
            const issues = compared.issues.filter(issue => !known.some(name => issue.startsWith(name) || issue.includes(`. ${name}`)));
            expect(issues, "the simulator moves what the game moved, through every inserter and machine").toEqual(build.staged_start?.open_issues ?? []);
        }, TEST_TIMEOUT_MS);
    }
});
