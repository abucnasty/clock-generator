import { describe, it, expect } from "vitest";
import { combineClockAlternativeRuns, type ClockAlternativeRun, type ClockRanking } from "./generate-blueprint";

type Ranked = ClockRanking & { id: string };

const clock = (id: string, ranking: Partial<ClockRanking> = {}): Ranked => ({
    id,
    meets_target_rate: true,
    keeps_belt_pickup_slack: true,
    rank_first: false,
    wake_ups_per_minute: 100,
    window_count: 10,
    ...ranking,
});

/** Each clock is a run of its own with windows of its own, unless it is given the signature of another */
const selectedOf = (clocks: Ranked[], signatures: Record<string, string> = {}): string => {
    const runs: ClockAlternativeRun<Ranked>[] = clocks.map(it => ({ signature: signatures[it.id] ?? it.id, alternatives: [it] }));
    const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
    return alternatives[selected_index].id;
};

describe("combineClockAlternativeRuns", () => {
    it("selects the clock with the fewest wake-ups among those that meet the target rate", () => {
        expect(selectedOf([
            clock("first", { wake_ups_per_minute: 80 }),
            clock("more-windows", { wake_ups_per_minute: 30, window_count: 25 }),
            clock("off-target", { wake_ups_per_minute: 0, meets_target_rate: false }),
        ])).toBe("more-windows");
    });

    it("selects a clock that keeps belt pickup slack over one with fewer wake-ups that leaves it out", () => {
        expect(selectedOf([
            clock("slack", { wake_ups_per_minute: 80 }),
            clock("no-slack", { wake_ups_per_minute: 30, keeps_belt_pickup_slack: false }),
        ])).toBe("slack");
    });

    it("selects a clock without belt pickup slack when no clock with it meets the target rate", () => {
        expect(selectedOf([
            clock("slack", { meets_target_rate: false }),
            clock("no-slack", { keeps_belt_pickup_slack: false }),
        ])).toBe("no-slack");
    });

    it("selects a clock that is ranked first whatever its wake-ups", () => {
        expect(selectedOf([
            clock("fewest", { wake_ups_per_minute: 30 }),
            clock("ranked-first", { wake_ups_per_minute: 80, rank_first: true }),
        ])).toBe("ranked-first");
    });

    it("selects the fewest windows among clocks with the same wake-ups, and the first listed among equals", () => {
        expect(selectedOf([
            clock("first", { window_count: 12 }),
            clock("fewer-windows", { window_count: 9, wake_ups_per_minute: 100.0004 }),
            clock("same", { window_count: 9 }),
        ])).toBe("fewer-windows");
    });

    it("ranks a clock whose wake-ups were not counted after one whose were", () => {
        expect(selectedOf([
            clock("not-counted", { wake_ups_per_minute: null, window_count: 1 }),
            clock("counted", { wake_ups_per_minute: 500 }),
        ])).toBe("counted");
    });

    it("selects the first listed when no clock meets the target rate and the windows are the same", () => {
        expect(selectedOf([
            clock("first", { meets_target_rate: false }),
            clock("second", { meets_target_rate: false }),
        ])).toBe("first");
    });

    it("lists runs with the same windows once", () => {
        const runs: ClockAlternativeRun<Ranked>[] = [
            { signature: "a", alternatives: [clock("first")] },
            { signature: "a", alternatives: [clock("duplicate", { wake_ups_per_minute: 0 })] },
        ];
        const { alternatives, selected_index } = combineClockAlternativeRuns([...runs, null], it => it);
        expect(alternatives.map(it => it.id)).toEqual(["first"]);
        expect(selected_index).toBe(0);
    });
});
