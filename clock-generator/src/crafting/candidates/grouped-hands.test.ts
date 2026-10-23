import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { quiet } from "../generate-blueprint-test-helpers";
import { planRun } from "../plan/plan-run";
import { GroupedHandsNotApplicable, groupedHandsWindows } from "./grouped-hands";

// The owner's grenade build (REAL_OWNER_GRENADE), one copy: a foundry (3) fills four assembling machines (1, 2, 4, 5) with iron
// plates through inserters 4, 3, 6 and 5, five hands of 16 a period each; a drill into each machine brings the coal; inserters 1,
// 2, 7 and 8 take 16 grenades from the machines onto a belt. The period is 112 ticks, the hand cycle 8.
const windowsOf = (config: Config) => {
    const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 1 } }, { logger: quiet });
    const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
    return () => groupedHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, plan.unslacked_windows);
};
const ranges = (windows: Map<string, { start_inclusive: number; end_inclusive: number }[]>, id: string) =>
    windows.get(id)!.map(range => [range.start_inclusive, range.end_inclusive]);

describe("hands in groups", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    });

    it("splits the four takers of the foundry into two groups half a period apart, each taker one window for its five hands", () => {
        const windows = windowsOf(config)();
        // 4 x 80 plates in a window of 42 ticks are more than the foundry holds (100) and makes (3.74 a tick); 2 x 80 are not
        expect(ranges(windows, "inserter:4")).toEqual([[2, 43]]);
        expect(ranges(windows, "inserter:6")).toEqual([[2, 43]]);
        expect(ranges(windows, "inserter:3")).toEqual([[58, 99]]);
        expect(ranges(windows, "inserter:5")).toEqual([[58, 99]]);
        // one tick for the hand of grenades, at the start of the machine's group
        expect(ranges(windows, "inserter:1")).toEqual([[0, 0]]);
        expect(ranges(windows, "inserter:7")).toEqual([[0, 0]]);
        expect(ranges(windows, "inserter:2")).toEqual([[56, 56]]);
        expect(ranges(windows, "inserter:8")).toEqual([[56, 56]]);
        // a drill's window opens with its machine's inputs
        expect(ranges(windows, "drill:1")[0][0]).toBe(2);
        expect(ranges(windows, "drill:2")[0][0]).toBe(58);
    });

    it("is one group where the foundry can serve every taker at once", () => {
        const fast = { ...config, machines: config.machines.map(machine => machine.recipe === "casting-iron" ? { ...machine, crafting_speed: machine.crafting_speed * 2 } : machine) };
        const windows = windowsOf(fast)();
        for (const id of [3, 4, 5, 6]) expect(ranges(windows, `inserter:${id}`)).toEqual([[2, 43]]);
        for (const id of [1, 2, 7, 8]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 0]]);
    });

    it("does not apply to a build of machines that hand products on by several hands a period, or with a belt pickup", async () => {
        const accumulator = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640);
        expect(windowsOf(accumulator)).toThrow(GroupedHandsNotApplicable);
        const belted = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        expect(windowsOf(belted)).toThrow(GroupedHandsNotApplicable);
    });
});
