import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { clockFromWindows, clockVerdictOf, type BlueprintGenerationResult, type SerializableClockWindows } from "./generate-blueprint";
import { backpressureLossOf } from "./trial";
import { verdictOf } from "./backpressure-loss";
import { quiet } from "./generate-blueprint-test-helpers";

// Thaeln's cell has a coal inserter that moves 15/8 hands a cycle, which stretches the period of every clock made from
// the plan to eight cycles (1,344 ticks); no clock for it is stable at 480 a second. Without the coal in the period (the
// config's `ignored_lcm_ingredients`) it is two cycles (336 ticks), the coal inserter staying clocked. The observed-windows
// search finds a clock for that period in about ten minutes, which a test does not wait for: these are the windows it
// found on 2026-10-16, saved, and judged here as the generator judges its own.
const COAL_OUT_OF_PERIOD_WINDOWS: Record<string, string> = {
    "inserter:3": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:4": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:9": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:13": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:18": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:21": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:24": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:27": "1-35,57-91,113-147,169-203,225-259,281-315",
    "inserter:1": "111-140,271-289",
    "inserter:10": "0-26,117-127,212-246,317-335",
    "inserter:11": "0-34,213-247,323-335",
    "inserter:12": "0-25,116-126,211-245,316-335",
    "inserter:14": "116-145,276-294",
    "inserter:15": "115-144,275-293",
    "inserter:16": "109-138,269-287",
    "inserter:17": "108-137,268-286",
    "inserter:19": "0-24,115-125,210-244,315-333,335-335",
    "inserter:2": "110-139,270-288",
    "inserter:20": "0-23,114-124,209-243,314-332,335-335",
    "inserter:22": "109-119,209-219,309-319",
    "inserter:23": "108-118,208-218,308-318",
    "inserter:25": "24-27,136-139,248-251",
    "inserter:26": "23-26,135-138,247-250",
    "inserter:28": "114-143,274-292",
    "inserter:29": "113-142,273-291",
    "inserter:5": "111-121,211-221,311-321",
    "inserter:6": "110-120,210-220,310-320",
    "inserter:7": "0-6,116-126,216-231,316-326,335-335",
    "inserter:8": "0-5,115-125,215-230,315-325,335-335",
};

const PERIOD = 336;

/** "1-35,57-91" as windows */
const windowsOf = (text: string) => text.split(",").map(range => {
    const [start, end] = range.split("-").map(Number);
    return { start, end };
});

describe("a saved clock for a shorter period, on the Thaeln sample", () => {
    let config: Config;
    let result: BlueprintGenerationResult;
    const windows: SerializableClockWindows = Object.fromEntries(Object.entries(COAL_OUT_OF_PERIOD_WINDOWS).map(([id, text]) => [id, windowsOf(text)]));

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
        // the config the clock was planned on: the coal is out of the period, and the output swings per cycle are those of the clock
        config = { ...sample, overrides: { ...sample.overrides, ignored_lcm_ingredients: ["coal"], terminal_swing_count: 3 } };
        result = clockFromWindows(config, windows, PERIOD, quiet);
    });

    it("holds the target, from every start phase and over the long run, in a period of 336 ticks", () => {
        expect(result.simulation_duration.ticks).toBe(PERIOD);
        const as_built = result.stability_check.as_built!;
        expect(as_built.holds).toBe(true);
        expect(as_built.actual_output_items).toBe(result.stability_check.expected_output_items);
        expect(result.stability_check.expected_output_items).toBe(768);
        // 768 items in 336 ticks over all the copies is the target rate, 480 a second
        const per_second = result.stability_check.expected_output_items * 60 / PERIOD * (config.target_output.copies ?? 1);
        expect(config.target_output.items_per_second).toBe(480);
        expect(per_second).toBeCloseTo(480, 6);
    });

    it("names the coal loss that settles into unequal periods, despite keeping the average target rate", () => {
        const report = backpressureLossOf(config, result.clock_windows, PERIOD, result.stability_check.expected_output_items, quiet);
        const coal = report.losses.find(outcome => outcome.loss.kind === "supply" && outcome.loss.item === "coal")!;
        const failures = coal.trials.filter(trial => !trial.recovers);
        expect(failures).toHaveLength(1);
        // An unused belt-pickup counter used to delay repeat detection and change later trials' starting states.
        // The behavior-based key exposes this valid recurring outcome. Recovery still requires each period's
        // exact output: a 768 average does not make the 764/772 periods pass that existing rule.
        expect(failures[0]).toMatchObject({cut_at: 84, restore_at: 198, loss_ticks: 786,
            proven: true, ends_in: [764, 772, 764, 772]});
        expect(failures[0].ends_in.reduce((sum, amount) => sum + amount, 0) / failures[0].ends_in.length).toBe(768);
        const backpressure_loss = verdictOf(report);
        // the losses after coal are not tried, and the failing trial is the last of its loss
        expect(coal.trials[coal.trials.length - 1]).toBe(failures[0]);
        expect(backpressure_loss).toEqual({survives: false, broken_by: ["coal stops arriving"], broken_at_other_lane_phases: [],
            not_tried: ["utility-science-pack is not taken away"], recovered_after_periods: null});
        const verdict = clockVerdictOf({ holds: true, backpressure_loss, items_per_second: 480, wake_ups_per_minute: null, start_dependence: null });
        expect(verdict).toBe("no recovery");
    });
});
