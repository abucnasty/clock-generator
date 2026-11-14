import { describe, expect, it } from "vitest";
import { costKey, distanceFromSetpointKey, holdsOutputKey, recoveryKey, signalsKey, tierKey, windowsKey, type ClockRanking } from "./rank";

/** A clock that meets the target rate exactly and was tried, unless told otherwise */
const ranking = (overrides: Partial<ClockRanking> = {}): ClockRanking => ({
    meets_target_rate: true, rate_off_target: 0, holds_expected_output: true, wake_ups_per_minute: 100, window_count: 10, ...overrides,
});

describe("the keys of the selection's order, each alone", () => {
    it("tierKey: exact and tried, rounded, recovery not tried, stable over the setpoint, the rest", () => {
        expect([
            ranking(),
            ranking({ runs_fast: 0.0002 }),
            ranking({ recovery_untried: true }),
            ranking({ meets_target_rate: false, stable_above_target: true, rate_off_target: 2 }),
            ranking({ meets_target_rate: false, rate_off_target: -1 }),
        ].map(tierKey)).toEqual([0, 1, 2, 3, 4]);
    });

    it("distanceFromSetpointKey: none for a clock that meets the target, else the distance to a thousandth, above as below", () => {
        expect(distanceFromSetpointKey(ranking({ rate_off_target: 0.5 }))).toBe(0);
        expect(distanceFromSetpointKey(ranking({ meets_target_rate: false, rate_off_target: -0.4004 }))).toBe(400);
        expect(distanceFromSetpointKey(ranking({ meets_target_rate: false, rate_off_target: 0.4 }))).toBe(400);
    });

    it("holdsOutputKey: 1 only for a clock that neither meets the target nor holds its output", () => {
        expect(holdsOutputKey(ranking({ holds_expected_output: false }))).toBe(0);
        expect(holdsOutputKey(ranking({ meets_target_rate: false }))).toBe(0);
        expect(holdsOutputKey(ranking({ meets_target_rate: false, holds_expected_output: false }))).toBe(1);
    });

    it("costKey: the wake-ups to a thousandth, none counted last", () => {
        expect(costKey(ranking({ wake_ups_per_minute: 452.0004 }))).toBe(452000);
        expect(costKey(ranking({ wake_ups_per_minute: null }))).toBe(Infinity);
    });

    it("signalsKey: the signals to a thousandth, none counted or none kept last", () => {
        expect(signalsKey(ranking({ signals_per_minute: 100.0004 }))).toBe(100000);
        expect(signalsKey(ranking({ signals_per_minute: null }))).toBe(Infinity);
        expect(signalsKey(ranking())).toBe(Infinity);
    });

    it("recoveryKey: the window cycles to recover, none last", () => {
        expect(recoveryKey(ranking({ recovery_window_cycles: 6 }))).toBe(6);
        expect(recoveryKey(ranking({ recovery_window_cycles: null }))).toBe(Infinity);
        expect(recoveryKey(ranking())).toBe(Infinity);
    });

    it("windowsKey: the window count", () => {
        expect(windowsKey(ranking({ window_count: 7 }))).toBe(7);
    });
});
