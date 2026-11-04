import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { parseConfig } from "../config/loader";
import { OpenRange } from "../data-types";
import * as planning from "./plan/plan-run";
import * as competing from "../simulation/competing-takers";
import * as moving from "./moving-pickup-phase-starts";
import { runAsBuiltCheck } from "./trial";
import { judgeLongRun, wholeOutputRepeats } from "./long-run";
import { quiet } from "./generate-blueprint-test-helpers";

afterEach(() => vi.restoreAllMocks());

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/imp-sampled-output.json"), "utf8"));

async function preparedFixture() {
    const config = await parseConfig(JSON.stringify(fixture.config));
    return {
        config: { ...config, overrides: { ...config.overrides,
            lcm: fixture.used_lcm, terminal_swing_count: fixture.used_terminal_swing_count } },
        windows: new Map<string, OpenRange[]>(Object.entries(fixture.clock_windows as Record<string, {start: number; end: number}[]>)
            .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))])),
    };
}

/** The long run's recording replaced by hands of `bins` items a period; `proven` makes them a repeating cycle */
function recordedRun(bins: number[], periods: number, proven: boolean) {
    const original = planning.trialRunOf;
    vi.spyOn(planning, "trialRunOf").mockImplementation(run => {
        const result = original(run);
        if (run.machine_stock === undefined) return result;
        const held = new Array<number>(fixture.period * periods).fill(0);
        for (let period = 0; period < periods; period++) {
            for (let left = bins[period % bins.length], tick = period * fixture.period + 1; left > 0; tick += 3) {
                held[tick] = Math.min(left, 16);
                held[tick + 1] = held[tick];
                left -= held[tick];
            }
        }
        return { ...result, state_repeat: proven ? {bin_ticks: fixture.period, periods_per_bin: 1, from_bin: 0, cycle_bins: periods} : undefined,
            machine_stock: {ticks: held.length, detail: "hands", machines: [], inserters: [{
                inserter_id: fixture.output_inserter, held, held_item: [], status: [], factorio_state: [],
            }]} };
    });
}

// The archived imp plan (fixtures/imp-sampled-output.md): it falls short in the game too (237.18 of 240/s). Its standard
// long run is within a hand, which the tolerance alone let through.
test("rejects the archived imp plan's measured shortfall without changing either horizon", async () => {
    const { config, windows } = await preparedFixture();
    const standard = runAsBuiltCheck(config, windows, fixture.period, quiet, 12);
    const diagnostic = runAsBuiltCheck(config, windows, fixture.period, quiet, 12, undefined, 72_000);
    for (const run of [standard, diagnostic]) {
        const judged = judgeLongRun([run.stock!.inserters.find(hand => hand.inserter_id === fixture.output_inserter)!.held],
            run.stock!.ticks, fixture.period, null, 16, 16);
        expect(judged.total).toBeLessThan(judged.expected_total);
        expect(run.check).toMatchObject({ holds: false, failed_start_offset: 0, long_run_proven: false,
            output_basis: "long-run mean", actual_output_items: judged.output_items_per_period,
            target_production: { valid: false, evidence: "sample" } });
    }
    expect(standard.check.actual_output_items).toBe(15.8);
    expect(diagnostic.check.actual_output_items).toBe(15.808);
    // the standard 80 bins never repeat: all of them, 1264 of 1280
    expect(standard.check.target_production).toEqual({ valid: false, shortfall: 16, output_items_per_period: 15.8, evidence: "sample" });
    // the diagnostic's 500 bins repeat every 89 periods, 16 short in each: five whole repeats, 7040 of 7120
    expect(diagnostic.check.target_production).toEqual({ valid: false, shortfall: 80, output_items_per_period: 7040 / 445, evidence: "sample" });
});

// These synthetic recorded hands isolate the policy: the ordinary first-period check still runs, and only the long run's
// recording and repeat are supplied. They make no claim about the game or the simulator's mechanics.
test.each([
    { name: "an under-target repeating cycle", bins: [15, 16], holds: false, mean: 15.5, shortfall: 1 },
    { name: "jitter that catches up over the repeating cycle", bins: [0, 32], holds: true, mean: 16, shortfall: 0 },
])("a proven long run is judged on its amount apart from its recurrence: $name", async ({ bins, holds, mean, shortfall }) => {
    const { config, windows } = await preparedFixture();
    recordedRun(bins, 2, true);
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(check.holds).toBe(holds);
    if (holds) {
        expect(check.target_production).toBeUndefined();
    } else {
        expect(check).toMatchObject({ actual_output_items: mean, output_basis: "long-run mean",
            target_production: { valid: false, shortfall, output_items_per_period: mean, evidence: "repeating-cycle" } });
    }
});

test.each([
    { name: "one measured period", repeat: undefined, total: undefined, mean: 15, shortfall: 1, evidence: "sample", basis: "one period" },
    { name: "an under-target complete repeat", repeat: 2, total: 31, mean: 15.5, shortfall: 1, evidence: "repeating-cycle", basis: "long-run mean" },
    { name: "a complete 15+17 repeat", repeat: 2, total: 32, mean: 16, shortfall: 0, evidence: "repeating-cycle", basis: "long-run mean" },
])("a shifted start of a final check is judged on its own amount: $name", async measurement => {
    const { config, windows } = await preparedFixture();
    recordedRun([16, 16], 2, true); // the unshifted run holds; it says nothing of another start
    const original = planning.runBuild;
    vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
        const run = original(prepared, options);
        if (options?.factorio_states !== false || options.machine_stock || options.moving_pickup_phases
            || options.competing_takers_order !== undefined) return run;
        return { ...run, stability_check: { ...run.stability_check, holds: true, actual_output_items: 15,
            repeat_periods: measurement.repeat, repeat_output_items: measurement.total } };
    });
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 2, undefined, 36_000, undefined, false, "hands");
    if (measurement.shortfall === 0) {
        expect(check.holds).toBe(true);
        expect(check.failed_start_offset).toBeUndefined();
        return;
    }
    expect(check).toMatchObject({ holds: false, failed_start_offset: 48, actual_output_items: measurement.mean,
        output_basis: measurement.basis, target_production: { valid: false, shortfall: measurement.shortfall,
            output_items_per_period: measurement.mean, evidence: measurement.evidence } });
    // the unshifted long run is not the run the check failed on
    expect(check.long_run_proven).toBeUndefined();
    expect(check.first_judged_tick).toBeUndefined();
    expect(check.long_run_cycle_periods).toBeUndefined();
});

test.each([0, 1])("a final check with no long run is strict, a quick trial stays a screen (long run ticks %s)", async ticks => {
    const { config, windows } = await preparedFixture();
    const original = planning.runBuild;
    vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
        const run = original(prepared, options);
        return { ...run, stability_check: { ...run.stability_check, holds: true, actual_output_items: 15,
            repeat_periods: undefined, repeat_output_items: undefined } };
    });
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, ticks);
    if (ticks === 0) {
        expect(check.holds).toBe(true);
        expect(check.target_production).toBeUndefined();
    } else {
        expect(check).toMatchObject({ holds: false, actual_output_items: 15, output_basis: "one period",
            target_production: { valid: false, shortfall: 1, output_items_per_period: 15, evidence: "sample" } });
    }
});

test("another taker order cannot pass a final check with no long run below its amount", async () => {
    const { config, windows } = await preparedFixture();
    vi.spyOn(competing, "independentTakerOrdersToCheck").mockReturnValue(["descending", "ascending"]);
    const original = planning.runBuild;
    vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
        const run = original(prepared, options);
        if (options?.competing_takers_order !== "ascending") return run;
        return { ...run, stability_check: { ...run.stability_check, holds: true, actual_output_items: 15,
            repeat_periods: undefined, repeat_output_items: undefined } };
    });
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 1);
    expect(check).toMatchObject({ holds: false, failed_taker_order: "ascending", actual_output_items: 15,
        output_basis: "one period", target_production: { valid: false, shortfall: 1, evidence: "sample" } });
});

test("a final check runs again the lane starts a quick trial held without the amount", async () => {
    const { config, windows } = await preparedFixture();
    // a synthetic lane-start measurement at the policy boundary; no lane trajectory is asserted
    vi.spyOn(moving, "movingPickupPhaseStarts").mockImplementation(function* () { yield new Map<string, readonly [number, number]>(); });
    recordedRun([16, 16], 2, true);
    const original = planning.runBuild;
    let lane_runs = 0;
    vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
        const run = original(prepared, options);
        if (options?.moving_pickup_phases === undefined) return run;
        lane_runs++;
        return { ...run, stability_check: { ...run.stability_check, holds: true, actual_output_items: 15,
            repeat_periods: undefined, repeat_output_items: undefined } };
    });
    const quick = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 0);
    expect(quick.check.holds).toBe(true);
    const confirmed = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000,
        { run: quick, long_run_ticks: 0 }, false, "hands");
    expect(lane_runs).toBe(2);
    expect(confirmed.check).toMatchObject({ holds: false, actual_output_items: 15, failed_pickup_phases: {},
        target_production: { valid: false, shortfall: 1, output_items_per_period: 15, evidence: "sample" } });
});

test("a final check takes over the lane starts of a final check that held", async () => {
    const { config, windows } = await preparedFixture();
    vi.spyOn(moving, "movingPickupPhaseStarts").mockImplementation(function* () { yield new Map<string, readonly [number, number]>(); });
    recordedRun([16, 16], 2, true);
    const original = planning.runBuild;
    let lane_runs = 0;
    vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
        if (options?.moving_pickup_phases !== undefined) lane_runs++;
        return original(prepared, options);
    });
    const first = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(first.check.holds).toBe(true);
    const confirmed = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000,
        { run: first, long_run_ticks: 36_000 }, false, "hands");
    expect(confirmed.check.holds).toBe(true);
    expect(lane_runs).toBe(1);
});

// The span rule of a sampled long run: its judged bins (80 of 120 periods here) are no whole number of a three-period
// output repeat. Judged from the 16 of 17, 16, 15, a clock steady at its target would show 1279 of 1280; over whole
// repeats it shows its amount from any start, and a repeat that is short stays short.
test.each([
    { name: "steady at target over a repeat the span cuts", bins: [17, 16, 15], holds: true },
    { name: "short over every repeat", bins: [16, 15, 16], holds: false },
])("a sampled long run is judged over whole repeats of its output: $name", async ({ bins, holds }) => {
    const { config, windows } = await preparedFixture();
    recordedRun(bins, 120, false);
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(check.holds).toBe(holds);
    if (!holds) {
        expect(check.target_production).toEqual({ valid: false, shortfall: 26, output_items_per_period: 47 / 3, evidence: "sample" });
    }
});

test("whole output repeats of judged bins", () => {
    const cut = Array.from({ length: 80 }, (_, index) => [16, 15, 17][index % 3]);
    expect(cut.reduce((sum, items) => sum + items, 0)).toBe(1279);
    expect(wholeOutputRepeats(cut)).toEqual({ bins: 78, total: 1248 });
    expect(wholeOutputRepeats([16, 16, 15, 16, 16])).toEqual({ bins: 5, total: 79 });
    expect(wholeOutputRepeats([16])).toEqual({ bins: 1, total: 16 });
});

/**
 * Long runs replaced in turn: the n-th run with a recording takes the n-th of `runs`, as long as the run asked for. `dip`
 * puts 15 of 16 in that period of the run (a loss of the start-up); `repeat` proves the repeat from that period on.
 */
function recordedRuns(runs: { dip?: number; short_every?: number; repeat?: number }[]) {
    const original = planning.trialRunOf;
    let next = 0;
    const lengths: number[] = [];
    vi.spyOn(planning, "trialRunOf").mockImplementation(run => {
        const result = original(run);
        if (run.machine_stock === undefined) return result;
        const spec = runs[Math.min(next++, runs.length - 1)];
        const periods = Math.floor(result.machine_stock!.ticks / fixture.period);
        lengths.push(periods);
        const held = new Array<number>(fixture.period * periods).fill(0);
        for (let period = 0; period < periods; period++) {
            const short = period === spec.dip || (spec.short_every !== undefined && period % spec.short_every === spec.short_every - 1);
            const tick = period * fixture.period + 1;
            held[tick] = short ? 15 : 16;
            held[tick + 1] = held[tick];
        }
        return { ...result, state_repeat: spec.repeat === undefined ? undefined
                : { bin_ticks: fixture.period, periods_per_bin: 1, from_bin: spec.repeat, cycle_bins: periods - spec.repeat },
            machine_stock: { ticks: held.length, detail: "hands", machines: [], inserters: [{
                inserter_id: fixture.output_inserter, held, held_item: [], status: [], factorio_state: [],
            }] } };
    });
    return lengths;
}

// Settled means a proven repeat. A sample short by a hand or less is run on to the long run's lengthening cap: a proven
// repeat is judged alone, the loss before it kept as a start-up shortfall; without one the sample stands.
test("a sample short by a hand is run on and judged on the repeat it proves", async () => {
    const { config, windows } = await preparedFixture();
    const lengths = recordedRuns([{ dip: 50 }, { dip: 50, repeat: 60 }]);
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(lengths.slice(0, 2)).toEqual([120, 1125]);
    expect(check.holds).toBe(true);
    expect(check.target_production).toBeUndefined();
    expect(check.start_up_shortfall).toEqual({ orbit_start_period: 60, items: 1 });
});

test("a sample short by a hand that proves no repeat in the longer run stands as judged", async () => {
    const { config, windows } = await preparedFixture();
    const lengths = recordedRuns([{ dip: 50 }, { dip: 50 }]);
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(lengths).toEqual([120, 1125]);
    expect(check).toMatchObject({ holds: false, actual_output_items: 1279 / 80,
        target_production: { valid: false, shortfall: 1, evidence: "sample" } });
    expect(check.start_up_shortfall).toBeUndefined();
});

test("a sample short by more than a hand is not run on", async () => {
    const { config, windows } = await preparedFixture();
    const lengths = recordedRuns([{ short_every: 4 }]);
    const { check } = runAsBuiltCheck(config, windows, fixture.period, quiet, 1, undefined, 36_000, undefined, false, "hands");
    expect(lengths).toEqual([120]);
    expect(check).toMatchObject({ holds: false, target_production: { valid: false, shortfall: 20, evidence: "sample" } });
});
