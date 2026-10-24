import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { OpenRange } from "../../data-types";
import { quiet } from "../generate-blueprint-test-helpers";
import { planRun } from "../plan/plan-run";
import { GroupedHandsOptions, groupedHandsPlan } from "./grouped-hands";
import { handsInWindow, handsInWindows, supplyShortfall } from "./hand-walks";

const ranges = (windows: Map<string, OpenRange[]>, id: string) => windows.get(id)!.map(range => [range.start_inclusive, range.end_inclusive]);
const COMPUTED: GroupedHandsOptions = { surplus_guard: false, feeder_offset: 1, share_windows: false, computed: true };

describe("hands a window starts", () => {
    it("starts one hand every cycle from its first tick", () => {
        expect([0, 1, 8, 9, 41, 42].map(ticks => handsInWindow(ticks, 8))).toEqual([0, 1, 1, 2, 6, 6]);
    });

    it("counts a window that runs over the end of the period as one with the start of the next", () => {
        expect(handsInWindows([OpenRange.from(100, 111), OpenRange.from(0, 5)], 8, 112)).toBe(3);
        expect(handsInWindows([OpenRange.from(2, 19), OpenRange.from(44, 61)], 8, 112)).toBe(6);
        expect(handsInWindows(undefined, 8, 112)).toBe(14);
    });
});

describe("the supply walk", () => {
    // the grenade build's foundry: a stack of 100 plates, 3.74 a tick; four takers of five hands of 16, a cycle of 8, a period of 112
    const foundry = { stock: 100, rate: 3.7434895833333335 };
    const takers = [3, 4, 5, 6].map(n => ({ id: `inserter:${n}`, hand: 16, hands: 5, cycle: 8 }));
    const same = (...windows: [number, number][]) => new Map(takers.map(taker => [taker.id, windows.map(([from, to]) => OpenRange.from(from, to))]));

    it("finds the foundry short when the four takers draw their 320 plates together in 42 ticks", () => {
        expect(supplyShortfall(foundry, takers, same([2, 43]), 112)).toMatchObject({ hands: 5 });
    });

    it("finds it able to serve two groups of two takers half a period apart", () => {
        const windows = new Map(takers.map((taker, index) => [taker.id, [index < 2 ? OpenRange.from(2, 43) : OpenRange.from(58, 99)]]));
        expect(supplyShortfall(foundry, takers, windows, 112)).toBeNull();
    });

    it("refuses windows that start fewer hands than a taker moves", () => {
        expect(supplyShortfall(foundry, takers, same([2, 30]), 112)).toEqual({ id: "inserter:3", hands: 5, reached: 4 });
    });

    it("passes bursts that the foundry refills between", () => {
        expect(supplyShortfall(foundry, takers, same([2, 19], [44, 61], [86, 95]), 112)).toBeNull();
    });
});

describe("the computed placement of hands", () => {
    let grenade: Config;
    let bursts: Config;
    beforeAll(async () => {
        grenade = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
        bursts = await loadConfigFromFile(path.join(__dirname, "../../../tests/configs/bursts-solid-fuel-rocket-fuel.json"));
    });
    const planOf = (config: Config) => {
        const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        return (way: GroupedHandsOptions = COMPUTED) => groupedHandsPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true, way);
    };

    it("makes the grenade build's two groups, as the inequality of a source's stock and rate does", () => {
        const made = planOf(grenade);
        expect(made().windows).toEqual(made({ surplus_guard: false, feeder_offset: 16, share_windows: false }).windows);
        expect(ranges(made().windows, "inserter:4")).toEqual([[2, 43]]);
        expect(ranges(made().windows, "inserter:3")).toEqual([[58, 99]]);
    });

    it("splits the hands of a taker its source cannot serve in one run into bursts, with pauses for the source to refill", () => {
        // a chemical plant holds a stack of 50 solid fuel and makes 0.4 a tick; the rocket fuel assembler takes ten hands of 16 a period of 600
        // ticks. One run of ten hands in 82 ticks gets 50 + 0.4 x 72 = 79 of the 160 at most; a burst of three hands needs 48 of the 50 + 0.4 x 16,
        // so four bursts of 3, 3, 2 and 2 hands a quarter of the period apart: a burst of three leaves about 8, and 104 ticks refill it to
        // 50, where the next burst opens 124 ticks after the last one closes
        const made = planOf(bursts);
        expect(() => made({ surplus_guard: false, feeder_offset: 16, share_windows: false })).toThrow("a source cannot serve even one machine at a time");
        expect(ranges(made().windows, "inserter:1")).toEqual([[2, 27], [152, 177], [302, 319], [452, 469]]);
        expect(ranges(made().windows, "inserter:2")).toEqual([[0, 0]]);
    });
});
