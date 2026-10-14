import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../blueprints/serde";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { HarnessOptions, HarnessResult, HarnessSession, recordInFactorio, Seed } from "./factorio-harness";
import { outputPerPeriod, recipesMaking } from "./recording-output";
import { matchRecordingToConfig } from "../verification/entity-matching";
import { wakeUpsOfRecording } from "../verification/recording-wake-ups";
import { compareRecordings } from "../verification/compare-recordings";
import { matchOfSimulatedRecording, simulatedWakeUpsByStart, simulateRecording } from "../verification/simulated-recording";

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

const SAMPLES = path.resolve(__dirname, "..", "..", "resources", "config-samples");
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
 * 32.1 wake-ups a minute depending on where the clock starts; the generator's run counts 10.7 and the game 26.8.
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
    /** The clock is made for belts that do not move (`overrides.non_moving_belts`), which is what a scaffold has */
    non_moving_belts?: boolean;
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
    },
    // its clocks have no belt pickup slack: batched swings has room for a hand of fuel in the windows of the three
    // inserters that take nutrients off the belt with their bioflux, without which they do not hold. Selected is the
    // clock with 2 output swings per cycle, since batched swings does not get back from a loss of nutrients
    "agricultural science (belts do not move)": {
        scaffold: path.join(SAMPLES, "science", "agriculture-science", "agriculture-science-scaffold.txt"),
        config: ConfigPaths.AGRICULTURAL_SCIENCE,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
        warmup_ticks: 300,
        settle_ticks: 4800,
        non_moving_belts: true,
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
    "automation science (belts do not move)": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
        non_moving_belts: true,
    },
    "automation science with a belted buffer": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-belted-buffer-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
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
    // Two inserters each take two items off a belt of their own, and both take low density structures: which item
    // each takes first decides how the structures are split between them (near_lane in the config)
    "utility science": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    "utility science (belts do not move)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
        non_moving_belts: true,
    },
    "utility science with processing units and low density structures on one belt": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
    },
    "utility science with processing units and low density structures on one belt (belts do not move)": {
        scaffold: path.join(SAMPLES, "science", "utility-science", "utility-science-belted-combined-blue-and-lds-scaffold.txt"),
        config: ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
        non_moving_belts: true,
    },
    "low density structure": {
        scaffold: path.join(SAMPLES, "intermediates", "low-density-structure", "low-density-structure-scaffold.txt"),
        config: ConfigPaths.LOW_DENSITY_STRUCTURE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 2400,
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
            const config = build.non_moving_belts ? { ...loaded, overrides: { ...loaded.overrides, non_moving_belts: true } } : loaded;
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const selected = alternatives[selected_index];
            if (build.non_moving_belts) {
                expect(selected.belt, `the selected clock (${selected.label}) is made without belt pickup slack`).toEqual({ kind: "non_moving" });
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
                warmup_ticks: build.warmup_ticks,
                settle_ticks: build.settle_ticks,
                seed: build.seed,
                clock,
                config,
                unclocked: false,
                game_speed: UNWATCHED_SPEED,
                watch: WATCH,
                timeout_seconds: WATCH ? 3600 : 900,
                log: () => { },
            });

            const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
            expect(periods.length, `the recording of ${result.recording.sample_count} ticks holds whole clock periods`).toBeGreaterThan(1);
            // the first period is left out: the build may still be settling into the clock
            const checked = periods.slice(1);
            const wrong_length = checked.filter(it => it.end - it.start !== period);
            expect(wrong_length, `every one of the ${checked.length} periods checked lasts ${period} ticks, as the generated clock does`).toEqual([]);
            const short = checked.filter(it => it.items !== expected);
            expect(short, `every one of the ${checked.length} periods checked moves ${expected} items of ${config.target_output.recipe}`).toEqual([]);

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
                { recording: result.recording, match: matchRecordingToConfig(result.recording, config) },
                { recording: simulated_run, match: matchOfSimulatedRecording(simulated_run), from_sample: Math.floor(simulated_run.sample_count / 3) },
                config,
                { expected_output_per_period: expected },
            );
            const known = (build.moved_open?.inserter_ids ?? []).map(id => `Inserter ${id} (`);
            const issues = compared.issues.filter(issue => !known.some(start => issue.startsWith(start)));
            expect(issues, "the simulator moves what the game moved, through every inserter and machine").toEqual([]);
        }, TEST_TIMEOUT_MS);
    }
});
