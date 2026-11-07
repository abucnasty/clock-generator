import { describe, expect, test } from "vitest";
import { FactorioBlueprint } from "../blueprints/blueprint";
import type { ChestDrillClock } from "./chest-drill-windows";
import { signalsPerMinuteOf } from "./clock-signals";
import type { InserterCounters } from "./inserter-counters";

// Signals a minute are the activation signals of the window deciders: one a window opening, shared by the inserters of a decider.
const decider = (tags?: { inserters?: number[]; drills?: number[] }) => ({ name: "decider-combinator", ...(tags && { tags: { clock_generator: tags } }) });
const blueprint = (...entities: object[]) => ({ entities }) as unknown as FactorioBlueprint;
const counters = (switch_ons: Record<number, number>) => ({
    inserters: Object.entries(switch_ons).map(([number, switch_ons_per_minute]) => ({ inserter_id: `inserter:${number}`, switch_ons_per_minute })),
}) as unknown as InserterCounters;

describe("signalsPerMinuteOf", () => {
    test("is null where there is no long run to count on", () => {
        expect(signalsPerMinuteOf(undefined, blueprint(decider({ inserters: [1] })), undefined, 100)).toBeNull();
    });

    test("counts a decider once, however many inserters it switches", () => {
        // inserters 1 and 2 share a decider; inserter 3 has one of its own
        const made = blueprint(decider({ inserters: [1, 2] }), decider({ inserters: [3] }), decider());
        expect(signalsPerMinuteOf(counters({ 1: 20, 2: 20, 3: 5 }), made, undefined, 100)).toBe(25);
    });

    test("counts the most of a decider's inserters when one found itself enabled at an opening", () => {
        expect(signalsPerMinuteOf(counters({ 1: 20, 2: 18 }), blueprint(decider({ inserters: [1, 2] })), undefined, 100)).toBe(20);
    });

    test("counts a decider of drills by the windows of its drills in a period, over the period", () => {
        const drills = [{ drill_id: 4, window_count: 3 }, { drill_id: 5, window_count: 3 }] as ChestDrillClock[];
        // 3 windows in a window cycle of 360 ticks: 30 a minute of 3,600 ticks
        expect(signalsPerMinuteOf(counters({ 1: 10 }), blueprint(decider({ inserters: [1] }), decider({ drills: [4, 5] })), drills, 360)).toBe(40);
    });

    test("is 0 for a clock with no window decider", () => {
        expect(signalsPerMinuteOf(counters({ 1: 0 }), blueprint(decider()), undefined, 100)).toBe(0);
    });
});
