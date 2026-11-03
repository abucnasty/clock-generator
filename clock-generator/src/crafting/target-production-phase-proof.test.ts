import {readFileSync} from "node:fs";
import path from "node:path";
import {afterAll, afterEach, expect, test, vi} from "vitest";
import {parseConfig} from "../config/loader";
import {OpenRange} from "../data-types";
import type {MutableTickProvider} from "../simulation/current-tick-provider";
import * as phases from "../simulation/tick-phases";
import type {SimulationContext} from "./sequence/simulation-context";
import * as planning from "./plan/plan-run";
import * as state from "./runner/steady-state";
import * as target from "./target-production";
import {exhaustiveStartPhases, runAsBuiltCheck} from "./trial";
import {quiet} from "./generate-blueprint-test-helpers";

// the strict target amount is on under the new dispatch only, which is read from the environment when the engine loads
const dispatch = vi.hoisted(() => {
    const before = process.env.CLOCK_NEW_DISPATCH;
    process.env.CLOCK_NEW_DISPATCH = "1";
    return before;
});
afterAll(() => {
    if (dispatch === undefined) delete process.env.CLOCK_NEW_DISPATCH;
    else process.env.CLOCK_NEW_DISPATCH = dispatch;
});

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/imp-sampled-output.json"), "utf8"));
const period = 96;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Synthetic phase measurements exercise the actual exhaustive acceptance/orbit paths. These tick counters and
// state keys deliberately isolate policy; they are not a native trajectory or a simulator-mechanics calibration.
async function measuredPhases(stride: number, bins: number[], cap: boolean, asBuilt = false) {
    const sample = await parseConfig(JSON.stringify(fixture.config));
    const config = {...sample, overrides: {...sample.overrides, lcm: 1, terminal_swing_count: 1}};
    const windows = new Map<string, OpenRange[]>(Object.entries(fixture.clock_windows as Record<string, {start: number; end: number}[]>)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const byContext = new WeakMap<SimulationContext, number>();
    const byTick = new WeakMap<MutableTickProvider, number>();
    let offset = 0;
    const cold = planning.coldControlledTrialBuild;
    vi.spyOn(planning, "coldControlledTrialBuild").mockImplementation((...args) => {
        const context = cold(...args);
        byContext.set(context, offset);
        byTick.set(context.tick_provider, offset++);
        return context;
    });
    vi.spyOn(planning, "provenRepeatBin").mockReturnValue({ticks: period * stride, periods: stride});
    const tick = phases.runTick;
    vi.spyOn(phases, "runTick").mockImplementation((world, tracer) => {
        const start = byTick.get(world.tick_provider);
        if (start === undefined) return tick(world, tracer);
        world.tick_provider.incrementTick();
        const elapsed = world.tick_provider.getCurrentTick() - start;
        if (elapsed > 0 && elapsed % (period * stride) === 0) {
            const bin = elapsed / (period * stride) - 1;
            world.inserters.find(hand => hand.entity_id.id === fixture.output_inserter)!.inserter_state.items_dropped
                += start === 0 ? 16 * stride : bins[bin % bins.length];
        }
    });
    const key = state.simulationStateKey;
    vi.spyOn(state, "simulationStateKey").mockImplementation(context => {
        const start = byContext.get(context);
        if (start === undefined) return key(context);
        const crossing = Math.floor((context.tick_provider.getCurrentTick() - start) / (period * stride));
        if (start === 0) return "valid unshifted orbit";
        if (cap) return `unresolved ${start}:${crossing}`;
        // Later starts meet the second phase's orbit. An under-target orbit must never seed their acceptance.
        return `other orbit:${crossing % bins.length}`;
    });
    if (asBuilt) {
        vi.stubEnv("CLOCK_PROOF_PHASES", "1");
        const build = planning.runBuild;
        vi.spyOn(planning, "runBuild").mockImplementation((prepared, options) => {
            const run = build(prepared, options);
            // Establish a successful default two-period measurement that a different phase must replace.
            return {...run, stability_check: {...run.stability_check, holds: true,
                actual_output_items: 16, repeat_periods: 2, repeat_output_items: 32}};
        });
        return runAsBuiltCheck(config, windows, period, quiet, 1, undefined, 1).check;
    }
    return exhaustiveStartPhases(config, windows, period, quiet)!;
}

test.each([
    {stride: 1, bins: [15], mean: 15},
    {stride: 2, bins: [31], mean: 15.5},
])("rejects a proven under-target phase and never reuses it (stride=$stride)", async ({stride, bins, mean}) => {
    const outcome = await measuredPhases(stride, bins, false);
    expect(outcome).toMatchObject({holds: false, phases_checked: 2, failed_start_offset: 1,
        failed_output_items: mean, proven: true, merged_phases: 0,
        failed_target_production: {valid: false, shortfall: 1, output_items_per_period: mean, evidence: "repeating-cycle"}});
});

test("rejects an unresolved cap sample's exact31/32 total without rounding15.5 to16", async () => {
    const outcome = await measuredPhases(2, [31], true);
    expect(outcome).toMatchObject({holds: false, failed_start_offset: 1, failed_output_items: 15.5,
        proven: false, unresolved_phases: 1,
        failed_target_production: {valid: false, shortfall: 1, output_items_per_period: 15.5, evidence: "sample"}});
});

test("keeps the complete15+17 repeat valid at mean16 and reuses only its proven valid orbit", async () => {
    const assessment = vi.spyOn(target, "assessTargetProduction");
    const outcome = await measuredPhases(1, [15, 17], false);
    expect(outcome).toMatchObject({holds: true, phases_checked: period, proven: true, merged_phases: period - 2});
    expect(assessment).toHaveBeenCalledWith({total: 32, expected_total: 32, output_items_per_period: 16}, true);
});

test.each([false, true])("an exhaustive failed measurement clears the unrelated default repeat (cap=%s)", async cap => {
    const check = await measuredPhases(2, [31], cap, true);
    expect(check).toMatchObject({holds: false, actual_output_items: 15.5,
        target_production: {valid: false, shortfall: 1, output_items_per_period: 15.5,
            evidence: cap ? "sample" : "repeating-cycle"}});
    expect(check).not.toHaveProperty("repeat_periods");
    expect(check).not.toHaveProperty("repeat_output_items");
});
