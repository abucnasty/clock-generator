import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { quiet } from "../generate-blueprint-test-helpers";
import { planRun } from "../plan/plan-run";
import { dropSpacing, dropTieBreak } from "../../config/drop-spacing";
import { GroupedHandsNotApplicable, groupedHandsCycles, groupedHandsWindows } from "./grouped-hands";

// The grenade build (REAL_OWNER_GRENADE), one copy: a foundry (3) fills four assembling machines (1, 2, 4, 5) with iron
// plates through inserters 4, 3, 6 and 5, five hands of 16 a period each; a drill into each machine brings the coal; inserters 1,
// 2, 7 and 8 take 16 grenades from the machines onto a belt. The period is 112 ticks, the hand cycle 8.
const windowsOf = (config: Config, by_drops = false) => {
    const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 1 } }, { logger: quiet });
    const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
    const drops = by_drops ? dropTieBreak(config, duration.ticks) : null;
    return () => groupedHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, plan.unslacked_windows, true, undefined, drops);
};
/** The ticks at which each output inserter of a window set starts its hand */
const outputStarts = (windows: Map<string, { start_inclusive: number }[]>) =>
    new Map([1, 2, 7, 8].map(id => [id, [windows.get(`inserter:${id}`)![0].start_inclusive]] as const));
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

    it("puts the machines whose hands drop side by side on a shared belt in a group, where the places of the inserters are known", () => {
        // the machines of inserters 1 and 2 stand in one row of the belt and 7 and 8 in the other: dealt out in the order of
        // their ids, a group has one of each row and the second hand of every copy lands on the first one's tile
        const by_ids = windowsOf(config)();
        expect(dropSpacing(config, outputStarts(by_ids), 112)!.lines.map(line => line.pairs)).toEqual([7, 7]);
        const by_belt = windowsOf(config, true)();
        expect(dropSpacing(config, outputStarts(by_belt), 112)!.lines.map(line => line.pairs)).toEqual([0, 0]);
        for (const id of [1, 2]) expect(ranges(by_belt, `inserter:${id}`)).toEqual([[0, 0]]);
        for (const id of [7, 8]) expect(ranges(by_belt, `inserter:${id}`)).toEqual([[56, 56]]);
        // the input windows follow their machines: the group of the first row is served first, each window of 42 ticks
        for (const id of [4, 3, 6, 5].map(it => `inserter:${it}`)) expect([[2, 43], [58, 99]]).toContainEqual(ranges(by_belt, id)[0]);
        expect(new Set([4, 3, 6, 5].map(id => ranges(by_belt, `inserter:${id}`)[0][0]))).toEqual(new Set([2, 58]));
    });

    it("keeps the dealing by ids where no other dealing puts fewer hands on each other", () => {
        // copies 11 tiles apart: two pairs of hands land on each other for either dealing
        const gapped = { ...config, target_output: { ...config.target_output, copy_offset: { x: 11, y: 0 } } };
        const by_ids = windowsOf(gapped)();
        const by_belt = windowsOf(gapped, true)();
        const pairs = (windows: typeof by_ids) => dropSpacing(gapped, outputStarts(windows), 112)!.lines.reduce((sum, line) => sum + line.pairs, 0);
        expect(pairs(by_ids)).toBe(2);
        expect(pairs(by_belt)).toBe(2);
        expect(Array.from(by_belt)).toEqual(Array.from(by_ids));
    });

    it("has nothing to choose by where the inserters have no places", () => {
        const placeless = { ...config, inserters: config.inserters.map(({ position: _position, ...inserter }) => inserter) };
        expect(dropTieBreak(placeless, 112)).toBeNull();
    });

    it("is one group where the foundry can serve every taker at once", () => {
        const fast = { ...config, machines: config.machines.map(machine => machine.recipe === "casting-iron" ? { ...machine, crafting_speed: machine.crafting_speed * 2 } : machine) };
        const windows = windowsOf(fast)();
        for (const id of [3, 4, 5, 6]) expect(ranges(windows, `inserter:${id}`)).toEqual([[2, 43]]);
        for (const id of [1, 2, 7, 8]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 0]]);
    });

    it("does not apply to a build of machines that hand products on by several hands a period", async () => {
        const accumulator = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640);
        expect(windowsOf(accumulator)).toThrow(GroupedHandsNotApplicable);
    });
});

// Thaeln's cell 09 (REAL_THAELN_CELL09): thirteen machines in a chain, a cryogenic plant (7) fills four foundries' worth of plastic
// through inserters 10, 12, 19 and 20 and has coal from a belt (11); foundries (3, 4, 10, 11) fill the eight assemblers with low
// density structure; units and frames come off two belts; eight inserters take the packs out onto belts. The cycle is 168 ticks.
describe("hands in a chain of machines", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
    });

    it("asks for one cycle: the hands of the inserters that fill a machine are rounded up, only the output's must be whole", () => {
        const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        // the plan itself needs 8 cycles for the coal inserter's 15/8 hands
        expect(plan.run.recipe_lcm).toBe(8);
        expect(groupedHandsCycles(plan.run.simulation_context.entity_registry, plan.run.swing_counts)).toBe(1);
    });

    it("puts the windows in the order of the chain: output, units, low density structure, plastic and coal a tick behind", () => {
        const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        expect(duration.ticks).toBe(168);
        // the way the sample's clock is made: a hand's worth for the plastic, whose foundries would keep a surplus hand, and the compact order
        const windows = groupedHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, plan.unslacked_windows, true,
            { surplus_guard: true, feeder_offset: 1 });
        // three hands of 12 ticks onto the belt; then, as the last of them starts, the units and frames (two hands of 11, a third start the
        // limit refuses, and the belt pickup slack of 4); the low density structure behind them (two hands of 8 and a third start); the plastic
        // a tick after it (four hands of 8: no more than four) and the coal after that (two hands of 11 and a third start, and the slack)
        for (const id of [3, 4, 9, 13, 18, 21, 24, 27]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 36]]);
        for (const id of [1, 2, 14, 15, 16, 17, 28, 29]) expect(ranges(windows, `inserter:${id}`)).toEqual([[26, 53]]);
        for (const id of [5, 6, 7, 8, 22, 23, 25, 26]) expect(ranges(windows, `inserter:${id}`)).toEqual([[54, 71]]);
        for (const id of [10, 12, 19, 20]) expect(ranges(windows, `inserter:${id}`)).toEqual([[55, 80]]);
        expect(ranges(windows, "inserter:11")).toEqual([[56, 83]]);
    });
});
