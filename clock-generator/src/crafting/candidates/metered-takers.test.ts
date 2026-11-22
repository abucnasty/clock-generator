import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { CodedError, MAKER_REASON_CODES, reasonOfError } from "../maker-log";
import { runClockAlternativeTask } from "../alternatives";
import { meteredTakersClock } from "./metered-takers";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

/** The maker's refusal, as the error it throws */
function refusalOf(make: () => unknown): Error {
    try {
        make();
    } catch (error) {
        return error as Error;
    }
    throw new Error("the maker made a clock");
}

// Called directly, as the generation calls it where no clock made before it is stable
describe("the metered takers maker", () => {
    it("makes nothing where no machine hands an ingredient to two or more of the machines that make the target, and gives a code with numbers", async () => {
        // MILITARY_SCIENCE_240: two machines make the target, and no machine feeds both
        const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(error).toBeInstanceOf(CodedError);
        expect(error.message).toBe("no machine hands an ingredient to two or more of the machines that make the target");
        expect(reasonOfError(error)).toEqual({ code: "no_metered_takers", target_machines: 2 });
        expect(MAKER_REASON_CODES.no_metered_takers).toEqual(["target_machines"]);
    });

    it("refuses an explicit recipe LCM outside the metered whole-craft plan", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LDS_240);
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(reasonOfError(error)).toEqual({ code: "metered_plan_override", terminal_swing_count: null, lcm: 3 });
    });

    it("refuses a source with another drawer on an uncontrolled route", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.LDS_240);
        // The cryogenic plant supplies the same plastic through chests as well as direct arms.
        const config = { ...sample, overrides: { ...sample.overrides, lcm: 1 } };
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(reasonOfError(error)).toEqual({ code: "metered_window_unproved", inserter: 3, cause: "shared_route" });
    });

    it("makes a clock on the first count whose windows hold, where the generation would ask it", async () => {
        // ADVANCED_CIRCUIT_240: a job of the record whose clock made before the fallbacks is stable, so the generation never asks it
        const config = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240);
        const clock = meteredTakersClock(config, quiet);
        expect([clock.used_terminal_swing_count, clock.simulation_duration.ticks, clock.stability_check.as_built?.holds]).toEqual([11, 264, true]);
    });
});

const utility = () => loadConfigFromFile(path.join(__dirname, "../fixtures/utility-science-320-metered-takers.json"));

describe("metered taker window bounds", () => {
    it.each([
        { id: 6, stack_size: 8, rate: 320, cause: "overlap" }, // [72,73] coincides with taker 9
        { id: 5, stack_size: 1, rate: 270, cause: "return" }, // a last-tick fill needs 8 more ticks, the cadence is 8
    ])("refuses an unproved $cause bound on a changed utility route", async ({ id, stack_size, rate, cause }) => {
        const config = await utility();
        config.overrides = { ...config.overrides, terminal_swing_count: 6, lcm: 1 };
        config.setpoint.items_per_second = rate;
        config.inserters.find(it => it.id === id)!.stack_size = stack_size;
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(reasonOfError(error)).toEqual({ code: "metered_window_unproved", inserter: id, cause });
    });

    it("refuses a taker that is set to always enabled", async () => {
        const config = await utility();
        const inserter = config.inserters.find(it => it.id === 5)!;
        inserter.overrides = { ...inserter.overrides, enable_control: { mode: "ALWAYS" } };
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(reasonOfError(error)).toMatchObject({ code: "metered_window_unproved", inserter: 5, cause: "control" });
    });
});

describe("the metered fallback task with an explicit planning override", () => {
    // The primary's internal count may travel through the worker alongside the caller's config.
    const context = { swings: 6, primary_stable: false, window_cycle_ticks: 324,
        secondary_planning: { source: "primitive-primary" as const, terminal_swing_count: 6 } };

    it("uses the requested compatible count and LCM even with a different primary count", async () => {
        const config = await utility();
        const result = runClockAlternativeTask({ ...config, overrides: { ...config.overrides, terminal_swing_count: 6, lcm: 1 } },
            { ...context, secondary_planning: { source: "primitive-primary", terminal_swing_count: 1 } }, "metered-takers", { logger: quiet });
        const clock = result?.alternatives[0]?.result;
        expect([clock?.used_terminal_swing_count, clock?.used_lcm]).toEqual([6, 1]);
    });

    it.each([
        { overrides: { terminal_swing_count: 1 }, reason: /1 output swing/ },
        { overrides: { lcm: 2 }, reason: /LCM.*2/i },
    ])("keeps the caller's $overrides when the worker attempts the fallback", async ({ overrides, reason }) => {
        const config = await utility();
        const messages: string[] = [];
        const result = runClockAlternativeTask({ ...config, overrides: { ...config.overrides, ...overrides } }, context,
            "metered-takers", { logger: quiet, on_not_made: entry => { messages.push(entry.reason); } });
        expect(result === null).toBe(true);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(reason);
    });
});
