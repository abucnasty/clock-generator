import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { generateClockAlternatives } from "../../../../src/crafting/generate-blueprint";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { gearRow } from "../../../configs/gear-row";

const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

/** The clock of every row: the windows of the 96-tick clock of two machines, and of the 144-tick clock of three, that the generator weighs as "euclidean_swings" */
const EUCLIDEAN = "euclidean_swings";
/** The clock the generator selects for the row */
const SELECTED = "selected";

/**
 * A row of gear assemblers takes iron plate from one dead-end belt that four chest feeders keep full, with one clock. Two
 * assemblers at 30 gears a second each, or three at 20, ask the lane for all 120 plates a second it carries. The first
 * input inserter's hand leaves a gap in the lane that reaches the second input inserter's pickup while the second one
 * is open, so the second assembler makes less than the first: 5 crafts of every 6 where the input inserters stand too close
 * together for the clock (3 tiles for two assemblers, 6 for three), and the same crafts as the first where they stand
 * further apart (6 and 9 tiles) or where the clock is the one the generator selects. See README.md, "Results".
 *
 * `first` and `second`: the finished crafts of the first and second assembler from the first tick of the window to its last,
 * in ticks from the unlock of the clock, over whole clock cycles. Every phase of the start gave the same crafts.
 */
interface Row {
    name: string;
    machines: 2 | 3;
    pitch: number;
    /** The gears each assembler makes a second */
    gears_each: number;
    clock: typeof EUCLIDEAN | typeof SELECTED;
    /** The window cycle time of the clock */
    window_cycle: number;
    /** The ticks after the empty build at which the clock is unlocked */
    phases: number[];
    window: [number, number];
    first: number;
    second: number;
}

const ROWS: Row[] = [
    // the clock that two input inserters 3 tiles apart do not fit, and the same clock 3 tiles further apart
    { name: "2 assemblers, input inserters 3 tiles apart, a clock they do not fit", machines: 2, pitch: 3, gears_each: 30, clock: EUCLIDEAN, window_cycle: 96, phases: [0, 48], window: [1440, 3552], first: 1056, second: 880 },
    { name: "2 assemblers, input inserters 6 tiles apart, the same clock", machines: 2, pitch: 6, gears_each: 30, clock: EUCLIDEAN, window_cycle: 96, phases: [0, 48], window: [1440, 3552], first: 1056, second: 1056 },
    { name: "3 assemblers, input inserters 6 tiles apart, a clock they do not fit", machines: 3, pitch: 6, gears_each: 20, clock: EUCLIDEAN, window_cycle: 144, phases: [0, 72], window: [1440, 3600], first: 720, second: 600 },
    { name: "3 assemblers, input inserters 9 tiles apart, the same clock", machines: 3, pitch: 9, gears_each: 20, clock: EUCLIDEAN, window_cycle: 144, phases: [0, 72], window: [1440, 3600], first: 720, second: 720 },
    // the clock the generator selects for the rows that the first clock fails on
    { name: "2 assemblers, input inserters 3 tiles apart, the selected clock", machines: 2, pitch: 3, gears_each: 30, clock: SELECTED, window_cycle: 32, phases: [0, 48], window: [1440, 3552], first: 1056, second: 1056 },
    { name: "3 assemblers, input inserters 6 tiles apart, the selected clock", machines: 3, pitch: 6, gears_each: 20, clock: SELECTED, window_cycle: 96, phases: [0, 72], window: [1440, 3552], first: 704, second: 704 },
];

/** The ticks a trial is watched from its unlock, which is long enough for the lane to settle and then for the window above */
const TRIAL_TICKS = 3600;
/** Crafts are recorded in this many ticks: it divides every window cycle and window above */
const EVERY = 48;

interface Trial { phase: number; clock_at_unlock: number; crafts: [number, number[]][]; swings: [number, number, number, number, number][][] }

for (const row of ROWS) test(row.name, async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.INPUT_LANE_GAP_CAPTURE_DIR;
    const scratch = retained ? path.join(path.resolve(retained), row.name.replace(/[^a-z0-9]+/gi, "-")) : fs.mkdtempSync(path.join(os.tmpdir(), "input-lane-gap-"));
    fs.mkdirSync(scratch, { recursive: true });
    try {
        const config = gearRow({ machines: row.machines, pitch: row.pitch, items_per_second_each: row.gears_each });
        const generated = generateClockAlternatives(config, { logger: quiet });
        const alternative = row.clock === SELECTED ? generated.alternatives[generated.selected_index] : generated.alternatives.find(it => it.id === EUCLIDEAN)!;
        expect(alternative.result.simulation_duration.ticks, "the clock").toBe(row.window_cycle);
        const total = 1 + row.phases.reduce((sum, phase) => sum + phase + 1 + TRIAL_TICKS, 0);
        const work_dir = path.join(scratch, "game");
        await recordInFactorio({
            factorio: factorio!, save: save!, blueprint: fs.readFileSync(path.join(GameFixturePaths.INPUT_LANE_GAP, `gear-row-${row.machines}-at-${row.pitch}.scaffold`), "utf8").trim(),
            config, clock: { blueprint: encodeBlueprintFile({ blueprint: alternative.result.blueprint }), schedule: alternative.result.schedule },
            out: path.join(scratch, "capture.json"), work_dir, ticks: total + 30, warmup_ticks: 600, settle_ticks: 0, record_at_once: true,
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500, log() {},
            lua: composeProbeSource(path.join(__dirname, "input-lane-gap.lua"),
                { trials: row.phases.map(phase => ({ phase })), ticks: TRIAL_TICKS, every: EVERY, total, output: "input-lane-gap.json" }),
        });
        const report = JSON.parse(fs.readFileSync(path.join(work_dir, "script-output", "input-lane-gap.json"), "utf8")) as { trials: Trial[]; machines: number };
        expect(report.machines).toBe(row.machines);
        expect(report.trials.map(trial => trial.phase)).toEqual(row.phases);
        for (const trial of report.trials) {
            // the clock is at its start when it is unlocked, whatever the phase
            expect({ phase: trial.phase, clock: trial.clock_at_unlock }).toEqual({ phase: trial.phase, clock: 1 });
            const at = (tick: number) => trial.crafts.find(([since]) => since === tick)![1];
            const made = at(row.window[1]).map((crafts, index) => crafts - at(row.window[0])[index]);
            expect({ phase: trial.phase, crafts: made.slice(0, 2) }, `crafts of the first and second assembler from tick ${row.window[0]} to ${row.window[1]} after the unlock`)
                .toEqual({ phase: trial.phase, crafts: [row.first, row.second] });
            // the third assembler, where there is one, makes what the first does: the gap reaches the second input only
            if (row.machines === 3) expect({ phase: trial.phase, third: made[2] }).toEqual({ phase: trial.phase, third: row.first });
        }
    } finally {
        if (!retained) fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 1_560_000);
