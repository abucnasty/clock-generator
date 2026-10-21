import { describe, expect, it } from "vitest";
import { NotMadeClock, whyNotStable, WhyNotStableBuild, WhyNotStableClock, whyNotStableClockOf } from "./why-not-stable";

/** A clock at the target that holds and recovers, changed by `overrides` */
function clock(overrides: Partial<WhyNotStableClock> = {}): WhyNotStableClock {
    return {
        label: "Batched swings: 2 output swings per cycle",
        verdict: "stable",
        meets_target_rate: true,
        assessment: { holds: true, items_per_second: 7.5, backpressure_loss: { survives: true, broken_by: [], broken_at_other_lane_phases: [] } },
        moving_belt: false,
        expected_output_items: 176,
        as_built_output: { items: 176 },
        spare_time: null,
        ...overrides,
    };
}

/** A clock that holds the target and does not get back after the `broken_by` losses */
function noRecovery(broken_by: string[], other_phases: string[] = [], overrides: Partial<WhyNotStableClock> = {}): WhyNotStableClock {
    return clock({
        verdict: "no recovery",
        meets_target_rate: false,
        assessment: { holds: true, items_per_second: 7.5, backpressure_loss: { survives: false, broken_by, broken_at_other_lane_phases: other_phases } },
        ...overrides,
    });
}

const moving: WhyNotStableBuild = { target_items_per_second: 7.5, backed_up_belts: false, not_made: [] };

const BACKED_UP_ADVICE = " If the input belts back up at their pickups, answer Backed up for the belts and generate again: a clock may hold then.";

describe("why the selected clock does not meet goal 1", () => {
    it("is not said of a clock that meets it", () => {
        expect(whyNotStable([clock()], 0, moving)).toBeNull();
        // on a build with a deadlock risk a clock that does not recover meets it too (see ClockRanking.meets_target_rate)
        expect(whyNotStable([noRecovery(["coal stops arriving"], [], { meets_target_rate: true })], 0, moving)).toBeNull();
        expect(whyNotStable([], 0, moving)).toBeNull();
    });

    it("is the moving lane phases of a moving-belt clock that holds from the modeled start and not from another lane phase", () => {
        const unstable = clock({
            label: "1 output swing per cycle", verdict: "unstable", meets_target_rate: false, moving_belt: true,
            assessment: { holds: false, items_per_second: 7.5, backpressure_loss: null },
            failed_pickup_phases: { "inserter:2": [3, 0] },
            as_built_output: { items: 176, repeat_periods: 6, repeat_output_items: 880 },
        });
        expect(whyNotStable([unstable], 0, moving)).toEqual({
            cause: "moving lane phases",
            message: "The selected clock (1 output swing per cycle) is made for a moving belt. It holds the target rate from the "
                + "modeled start, but not when the lanes reach inserter 2 in another phase: from such a start it moves 880 of 1056 "
                + "items over 6 periods. In the game a belt's lanes reach the pickups in whatever phase they happen to have, so the "
                + `build can fall short.${BACKED_UP_ADVICE}`,
        });
        // a config that already says its belts are backed up is not told to say so
        expect(whyNotStable([unstable], 0, { ...moving, backed_up_belts: true })?.message).not.toContain("answer Backed up");
        // without the as-built output the shortfall is left out; a failure of one period is told per period
        expect(whyNotStable([{ ...unstable, as_built_output: undefined }], 0, moving)?.message).toContain("in another phase. In the game");
        expect(whyNotStable([{ ...unstable, as_built_output: { items: 160 }, failed_pickup_phases: { "inserter:2": [1, 5], "inserter:4": [0, 0] } }], 0, moving)?.message)
            .toContain("reach inserters 2 and 4 in another phase: from such a start it moves 160 of 176 items a period.");
    });

    it("is the moving lane phases of a moving-belt clock that gets back from every loss from the modeled start only", () => {
        const losses = ["accumulator stops arriving", "electromagnetic-science-pack is not taken away"];
        expect(whyNotStable([noRecovery(losses, losses, { moving_belt: true, label: "Observed windows: 3 output swings per cycle" })], 0, moving)).toEqual({
            cause: "moving lane phases",
            message: "The selected clock (Observed windows: 3 output swings per cycle) is made for a moving belt. It holds the target "
                + "rate from the modeled start and gets back to it from there after every loss, but not when the lanes come back in "
                + "another phase after accumulator stops arriving, or after electromagnetic-science-pack is not taken away. In the "
                + `game a belt's lanes reach the pickups in whatever phase they happen to have, so the build can fall short.${BACKED_UP_ADVICE}`,
        });
    });

    it("is no recovery for a clock that holds the target and does not get back after the losses it names", () => {
        expect(whyNotStable([noRecovery(["coal stops arriving"])], 0, moving)).toEqual({
            cause: "no recovery",
            message: "The selected clock (Batched swings: 2 output swings per cycle) holds the target rate, but does not get back to "
                + "it by itself after coal stops arriving. A buffer, or a faster machine, lets it catch up.",
        });
        // a moving-belt clock that misses a loss from the modeled start itself is no recovery too
        expect(whyNotStable([noRecovery(["tungsten-ore stops arriving"], [], { moving_belt: true })], 0, moving)?.cause).toBe("no recovery");
    });

    it("names only the losses it does not get back from, of a clock that gets back from some", () => {
        // the verdict lists the losses that break it; the ones it gets back from are not in it (see verdictOf)
        const message = whyNotStable([noRecovery(["iron-ore stops arriving", "iron-gear-wheel is not taken away"])], 0, moving)!.message;
        expect(message).toContain("after iron-ore stops arriving, or after iron-gear-wheel is not taken away.");
        expect(message).not.toContain("coal");
    });

    it("tells both causes of a moving-belt clock that misses one loss from the modeled start and another only from other lane phases", () => {
        const several = noRecovery(["tungsten-ore stops arriving", "coal stops arriving"], ["coal stops arriving"], { moving_belt: true });
        expect(whyNotStable([several], 0, moving)).toEqual({
            cause: "no recovery",
            message: "The selected clock (Batched swings: 2 output swings per cycle) holds the target rate, but does not get back to "
                + "it by itself after tungsten-ore stops arriving. After coal stops arriving it gets back to it from the modeled start, "
                + "but not when a moving belt's lanes come back in another phase. A buffer, or a faster machine, lets it catch up.",
        });
    });

    it("adds the spare time of a machine that takes longer to make up a period than a build is given to get back", () => {
        const spare = (spare_ticks: number, working_ticks: number) => whyNotStable(
            [noRecovery(["tungsten-ore stops arriving"], [], { spare_time: { machine: "Machine 3 (metallurgic-science-pack)", spare_ticks, working_ticks, recovery_periods: 40 } })],
            0, moving)!.message;
        expect(spare(1, 319)).toContain("after tungsten-ore stops arriving. Machine 3 (metallurgic-science-pack) crafts 319 ticks of a period "
            + "and has 1 tick to spare: making up one period it lost takes it 319 periods, more than the 40 a build is given to get back. "
            + "That is too little to make up what it lost. A buffer, or a faster machine, lets it catch up.");
        expect(spare(0, 320)).toContain("making up one period it lost takes it forever");
        // 146 ticks of crafting made up at 14 a period take 11 periods: within the 40
        expect(spare(14, 146)).not.toContain("to spare");
        expect(spare(8, 320)).not.toContain("to spare");
    });

    it("says so of a clock off its expected output in the run the losses are tried on", () => {
        expect(whyNotStable([noRecovery([])], 0, moving)?.message).toBe("The selected clock (Batched swings: 2 output swings per cycle) holds "
            + "the target rate, but was off its expected output in the run the losses are tried on, so whether it gets back after one "
            + "is not known. A buffer, or a faster machine, lets it catch up.");
    });

    it("is nothing holds where no clock holds the target, with the closest rate and the clocks that could not be made", () => {
        const not_made: NotMadeClock[] = [
            { id: "even-hands", label: "Even hands", reason: "even hands are only made where every inserter takes from a machine or a chest; inserter:6 does not" },
            { id: "shifted-swings", label: "Shifted swings", reason: "no shifted round of swings passes the clock-only check" },
        ];
        const short = clock({ label: "1 output swing per cycle", verdict: "unstable", meets_target_rate: false,
            assessment: { holds: false, items_per_second: 30.363636, backpressure_loss: null } });
        expect(whyNotStable([clock({ verdict: "unstable", meets_target_rate: false, assessment: { holds: false, items_per_second: 20, backpressure_loss: null } }), short],
            1, { target_items_per_second: 40, backed_up_belts: true, not_made })).toEqual({
            cause: "nothing holds",
            message: "No clock holds the target rate of 40 a second. The closest, 1 output swing per cycle, moves 30.36 a second, 9.64 "
                + "under the target. Not made: Even hands (even hands are only made where every inserter takes from a machine or a chest; "
                + "inserter:6 does not); Shifted swings (no shifted round of swings passes the clock-only check).",
        });
        const over = { ...short, assessment: { ...short.assessment, items_per_second: 126.09375 } };
        expect(whyNotStable([over], 0, { target_items_per_second: 120, backed_up_belts: false, not_made: [] })?.message)
            .toBe("No clock holds the target rate of 120 a second. The closest, 1 output swing per cycle, moves 126.09 a second, 6.09 over the target.");
    });

    it("is nothing holds for a clock at the target that does not keep it up, one that is not made for a moving belt", () => {
        const start_dependent = clock({ verdict: "unstable", meets_target_rate: false, assessment: { holds: true, items_per_second: 7.5, backpressure_loss: null } });
        expect(whyNotStable([start_dependent], 0, moving)).toEqual({
            cause: "nothing holds",
            message: "No clock holds the target rate of 7.5 a second. The closest, Batched swings: 2 output swings per cycle, moves 7.5 a "
                + "second from the modeled start, and does not keep it up from every start.",
        });
        // a moving-belt clock that fails a clock offset, not a lane phase, is not told as the lane phases
        expect(whyNotStable([{ ...start_dependent, moving_belt: true }], 0, moving)?.cause).toBe("nothing holds");
    });

    it("is nothing holds for a stable clock off the target, and for one that does not recover at another rate", () => {
        expect(whyNotStable([clock({ meets_target_rate: false, assessment: { holds: true, items_per_second: 7.4, backpressure_loss: null } })], 0, moving)?.message)
            .toContain("moves 7.4 a second, 0.1 under the target.");
        expect(whyNotStable([noRecovery(["coal stops arriving"], [], { assessment: { holds: true, items_per_second: 8,
            backpressure_loss: { survives: false, broken_by: ["coal stops arriving"], broken_at_other_lane_phases: [] } } })], 0, moving)?.cause).toBe("nothing holds");
    });
});

describe("what the summary reads of a clock", () => {
    it("reads the alternative's fields under their names", () => {
        const assessment = { holds: false, items_per_second: 7.5, backpressure_loss: null };
        expect(whyNotStableClockOf({
            label: "1 output swing per cycle", verdict: "unstable", ranking: { meets_target_rate: false }, assessment,
            belt: { kind: "moving", slack_ticks: [4] },
            as_built: { holds: false, actual_output_items: 176, start_phases_checked: 1, failed_start_offset: 0,
                failed_pickup_phases: { "inserter:2": [3, 0] }, repeat_periods: 6, repeat_output_items: 880 },
            expected_output_items: 176,
            insights: [{}, { spare_time: { machine: "Machine 1 (assembling-machine)", spare_ticks: 3, working_ticks: 160, recovery_periods: 40 } }],
        })).toEqual({
            label: "1 output swing per cycle", verdict: "unstable", meets_target_rate: false, assessment, moving_belt: true,
            failed_pickup_phases: { "inserter:2": [3, 0] }, expected_output_items: 176,
            as_built_output: { items: 176, repeat_periods: 6, repeat_output_items: 880 },
            spare_time: { machine: "Machine 1 (assembling-machine)", spare_ticks: 3, working_ticks: 160, recovery_periods: 40 },
        });
    });

    it("takes a clock without a belt, or kept before its belt was, for one not made for a moving belt", () => {
        const view = { label: "Observed windows", verdict: "stable" as const, ranking: { meets_target_rate: true },
            assessment: { holds: true, items_per_second: 1, backpressure_loss: null }, as_built: null, expected_output_items: 4, insights: [] };
        expect(whyNotStableClockOf(view)).toEqual({ label: "Observed windows", verdict: "stable", meets_target_rate: true,
            assessment: view.assessment, moving_belt: false, expected_output_items: 4, spare_time: null });
        expect(whyNotStableClockOf({ ...view, belt: { kind: "backed_up" } }).moving_belt).toBe(false);
    });
});
