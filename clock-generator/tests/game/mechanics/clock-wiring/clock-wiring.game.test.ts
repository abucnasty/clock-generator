import { SAMPLE_BUILDS_DIR } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { generateClockAlternatives } from "../../../../src/crafting/generate-blueprint";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { outputPerWindowCycle, recipesMaking } from "../../../../src/harness/recording-output";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

const SCAFFOLD = path.join(SAMPLE_BUILDS_DIR, "science", "automation", "automation-240.scaffold");
/** Several clock periods of automation science after the warmup and settling */
const RECORDED_TICKS = 7_200;
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** The scaffold with the condition a farmed inserter keeps from its real base on every inserter: signal-P = 1, a signal the clock never sends */
function scaffoldWithBaseConditions(): string {
    const text = fs.readFileSync(SCAFFOLD, "utf-8").trim();
    const file = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString("utf-8"));
    for (const entity of file.blueprint.entities) {
        if (entity.name.includes("inserter")) {
            entity.control_behavior = {
                circuit_enabled: true,
                circuit_condition: { first_signal: { type: "virtual", name: "signal-P" }, constant: 1, comparator: "=" },
            };
        }
    }
    return encodeBlueprintFile(file);
}

let scratch: string | null = null;
afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

describe("the harness wires the clock to the build", () => {
    test("an inserter that keeps a condition from the base it was cut from is enabled by the clock alone", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "clock-wiring-"));

        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        const selected = alternatives[selected_index];
        const subtick = selected.result.subtick;
        const window_cycle_ticks = subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks;
        const expected = Math.round(config.setpoint.items_per_second / config.setpoint.copies * window_cycle_ticks / 60 * 1e6) / 1e6;
        // the clock with its schedule as the generator made it, which the harness wires without reading descriptions
        const exported = subtick ?? selected.result;
        const result = await recordInFactorio({
            factorio: FACTORIO!,
            save: SAVE!,
            blueprint: scaffoldWithBaseConditions(),
            out: path.join(scratch, "automation-science-base-conditions.json"),
            ticks: RECORDED_TICKS,
            warmup_ticks: 3600,
            settle_ticks: 1200,
            seed: [],
            clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule },
            config,
            unclocked: false,
            game_speed: 1000,
            watch: false,
            timeout_seconds: 900,
            log: () => { },
        });

        const window_cycles = outputPerWindowCycle(result.recording, recipesMaking(config, config.setpoint.recipe));
        // the first period is left out: the build may still be settling into the clock
        const checked = window_cycles.slice(1);
        expect(checked.length, `the recording of ${result.recording.sample_count} ticks holds whole clock periods after the first`).toBeGreaterThan(1);
        const wrong_length = checked.filter(it => it.end - it.start !== window_cycle_ticks);
        expect(wrong_length, `every one of the ${checked.length} periods checked lasts ${window_cycle_ticks} ticks`).toEqual([]);
        const short = checked.filter(it => it.items !== expected);
        expect(short, `every one of the ${checked.length} periods checked moves ${expected} items of ${config.setpoint.recipe}`).toEqual([]);
    }, 960_000);
});
