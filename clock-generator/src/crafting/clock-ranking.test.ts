import { describe, it, expect } from "vitest";
import { combineClockAlternativeRuns, searchesAreNeeded, type ClockAlternativeRun, type ClockRanking } from "./generate-blueprint";

type Ranked = ClockRanking & { id: string };

const clock = (id: string, ranking: Partial<ClockRanking> = {}): Ranked => ({
    id,
    meets_target_rate: true,
    rate_off_target: 0,
    holds_expected_output: true,
    matches_belt_choice: true,
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
            clock("no-slack", { wake_ups_per_minute: 30, matches_belt_choice: false }),
        ])).toBe("slack");
    });

    it("selects a clock without belt pickup slack when no clock with it meets the target rate", () => {
        expect(selectedOf([
            clock("slack", { meets_target_rate: false }),
            clock("no-slack", { matches_belt_choice: false }),
        ])).toBe("no-slack");
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

    // the processing unit sample with a belt export: no clock holds 40 a second, and the one with the fewest windows
    // made 18.4 where another made 34.3
    it("selects the clock nearest to the target rate when none meets it, whatever its windows and its belt", () => {
        expect(selectedOf([
            clock("fewest-windows", { meets_target_rate: false, rate_off_target: -21.64, window_count: 5 }),
            clock("nearest", { meets_target_rate: false, rate_off_target: -5.69, window_count: 40, matches_belt_choice: false }),
            clock("between", { meets_target_rate: false, rate_off_target: -8.57, window_count: 60 }),
        ])).toBe("nearest");
    });

    // the metallurgic science sample: the full-hand subtick clock holds 45 a second and does not get back from a loss
    // of tungsten ore; the plain 1-swing clock at the same rate fails the long run, with fewer wake-ups
    it("selects, of two clocks equally near a target rate no clock meets, the one that holds its expected output", () => {
        expect(selectedOf([
            clock("drifts", { meets_target_rate: false, rate_off_target: 0, holds_expected_output: false, wake_ups_per_minute: 30 }),
            clock("holds", { meets_target_rate: false, rate_off_target: 0, wake_ups_per_minute: 80 }),
        ])).toBe("holds");
    });

    it("does not look at whether a clock holds while another is nearer to the target rate", () => {
        expect(selectedOf([
            clock("holds-far", { meets_target_rate: false, rate_off_target: -5 }),
            clock("drifts-near", { meets_target_rate: false, rate_off_target: -1, holds_expected_output: false }),
        ])).toBe("drifts-near");
    });

    it("counts a rate above the target as far off as one below it", () => {
        expect(selectedOf([
            clock("over", { meets_target_rate: false, rate_off_target: 3 }),
            clock("under", { meets_target_rate: false, rate_off_target: -2 }),
        ])).toBe("under");
    });

    it("does not look at how near a clock is to the target rate while one meets it", () => {
        expect(selectedOf([
            clock("meets", { wake_ups_per_minute: 500 }),
            clock("near", { meets_target_rate: false, rate_off_target: 0.01, wake_ups_per_minute: 0 }),
        ])).toBe("meets");
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

describe("searchesAreNeeded", () => {
    const needed = (clocks: (Ranked | null)[]): boolean =>
        searchesAreNeeded(clocks.map(it => it && { signature: it.id, alternatives: [it] }), it => it);

    it("is not, once a clock made without a search meets the target rate for the belt asked", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), null, clock("stable", { wake_ups_per_minute: 900 })])).toBe(false);
    });

    it("is, when no clock made without a search meets the target rate", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), clock("no-recovery", { meets_target_rate: false })])).toBe(true);
    });

    // military science: its one stable clock leaves belt pickup slack out, on a config that does not say the input belts are backed up
    it("is, when the only clock that meets the target rate is not made for the belt asked", () => {
        expect(needed([clock("slack", { meets_target_rate: false }), clock("no-slack", { matches_belt_choice: false })])).toBe(true);
    });

    it("is, when every clock made without a search failed", () => {
        expect(needed([null, null])).toBe(true);
    });

    // the subtick clock of a period of part ticks and the same clock rounded come from one run
    it("looks at every clock of a run", () => {
        const subtick = clock("subtick");
        const rounded = clock("rounded", { meets_target_rate: false, rate_off_target: 0.2 });
        expect(searchesAreNeeded([{ signature: "one", alternatives: [rounded, subtick] }], it => it)).toBe(false);
    });
});
