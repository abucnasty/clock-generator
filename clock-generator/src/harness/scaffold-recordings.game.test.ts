import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../blueprints/serde";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { recordInFactorio, Seed } from "./factorio-harness";
import { outputPerPeriod, recipesMaking } from "./recording-output";

/**
 * These tests run a headless Factorio through the harness, so they need the game and a save to build in, both named
 * by the environment as `npm run record` takes them. Without either they are skipped, not failed.
 */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

const SAMPLES = path.resolve(__dirname, "..", "..", "resources", "config-samples");
/** Ticks to record: ten minutes of game time, as a build with a loop is checked for in the simulator */
const RECORDED_TICKS = 36_000;
/** Starting the game, building, warming up and recording take well under two minutes; the harness's own timeout is 900 seconds */
const TEST_TIMEOUT_MS = 960_000;

interface ScaffoldBuild {
    /** One copy of the build without a clock, as a blueprint string */
    scaffold: string;
    config: string;
    seed: Seed[];
    /** Ticks the build runs before it is seeded, so belts are full */
    warmup_ticks: number;
    /** Ticks the build runs on the generated clock before the recording starts, so its start-up is left out */
    settle_ticks: number;
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
    "automation science": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
    },
    "automation science with a belted buffer": {
        scaffold: path.join(SAMPLES, "science", "automation-science", "automation-science-belted-buffer-scaffold.txt"),
        config: ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER,
        seed: [],
        warmup_ticks: 3600,
        settle_ticks: 1200,
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

afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

// one Factorio at a time: each test waits for its own recording before the next starts
describe.sequential("the selected clock holds the target rate in Factorio", () => {
    for (const [name, build] of Object.entries(BUILDS)) {
        test(`one copy of the ${name} build moves the expected output every clock period`, async context => {
            context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
            scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-recordings-"));

            const config = await loadConfigFromFile(build.config);
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const selected = alternatives[selected_index];
            expect(selected.is_stable, `the selected clock (${selected.label}) is stable in the simulator`).toBe(true);
            expect(selected.items_per_second, `the selected clock (${selected.label}) reaches the target rate in the simulator`)
                .toBe(config.target_output.items_per_second);

            // A fractional period is built as a subtick clock, which counts the whole ticks after which the period
            // repeats (1728 for 19 periods of 90.947): that is the period the recording is cut into, and what it has
            // to move is what that many ticks ask for.
            const subtick = selected.result.subtick;
            const period = subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
            const expected = config.target_output.items_per_second / config.target_output.copies * period / 60;
            const clock = encodeBlueprintFile({ blueprint: subtick?.blueprint ?? selected.result.blueprint });
            const result = await recordInFactorio({
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
                game_speed: 1000,
                timeout_seconds: 900,
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
        }, TEST_TIMEOUT_MS);
    }
});
