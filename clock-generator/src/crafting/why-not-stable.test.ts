import { describe, expect, it } from "vitest";
import { ChestType } from "../common/entity-types";
import type { ExportShortfall } from "./export-delivery";
import type { FullOutputChest } from "./full-output-chests";
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
        full_output_chests: [],
        export_shortfalls: [],
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

    it("names the losses that were not tried once one broke the clock", () => {
        const stopped = noRecovery(["coal stops arriving"], [], {
            assessment: { holds: true, items_per_second: 7.5, backpressure_loss: { survives: false, broken_by: ["coal stops arriving"],
                broken_at_other_lane_phases: [], not_tried: ["iron-plate stops arriving", "iron-gear-wheel is not taken away"] } },
        });
        expect(whyNotStable([stopped], 0, moving)?.message).toBe("The selected clock (Batched swings: 2 output swings per cycle) holds "
            + "the target rate, but does not get back to it by itself after coal stops arriving. Not tried, since one failure is enough: "
            + "iron-plate stops arriving, iron-gear-wheel is not taken away. A buffer, or a faster machine, lets it catch up.");
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

const chest1: FullOutputChest = { chest_id: 1, chest_type: ChestType.BUFFER_CHEST, name: "Chest 1", item: "electromagnetic-science-pack",
    item_label: "electromagnetic science pack", held: 9600, capacity: 9600, inserter_ids: [1, 2] };

describe("an output chest that fills up", () => {
    const full = (chests: FullOutputChest[], overrides: Partial<WhyNotStableClock> = {}) => clock({ verdict: "unstable", meets_target_rate: false,
        assessment: { holds: false, items_per_second: 0, backpressure_loss: null }, full_output_chests: chests, ...overrides });
    const build: WhyNotStableBuild = { target_items_per_second: 48, backed_up_belts: false, not_made: [{ id: "even-hands", label: "Even hands", reason: "not made." }] };

    it("is told as the cause, with the chest as the form names it, its numbers with thousands separators and the clocks not made", () => {
        expect(whyNotStable([full([chest1])], 0, build)).toEqual({
            cause: "output chest full",
            message: "No clock holds the target rate of 48 a second: Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, "
                + "so it holds 9,600 of 9,600 and inserters 1 and 2 have nowhere to drop. The closest, Batched swings: 2 output swings per "
                + "cycle, moves 0 a second, 48 under the target. Use an infinity chest, or add an inserter that takes the items out, and "
                + "generate again. Not made: Even hands (not made).",
        });
    });

    it("names each chest, a car by its type, and an inserter alone in the singular", () => {
        const car: FullOutputChest = { ...chest1, chest_id: 2, chest_type: ChestType.CAR, name: "Car 2", item: "iron-plate", item_label: "iron plate",
            held: 79999, capacity: 80000, inserter_ids: [3] };
        const message = whyNotStable([full([chest1, car])], 0, { ...build, not_made: [] })!.message;
        expect(message).toContain("Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, so it holds 9,600 of 9,600 and "
            + "inserters 1 and 2 have nowhere to drop. Car 2 fills up. Nothing takes any iron plate out of it, so it holds 79,999 of 80,000 "
            + "and inserter 3 has nowhere to drop. The closest");
    });

    it("comes before the other causes, and is not said of a clock that meets the target or was not found with a full chest", () => {
        expect(whyNotStable([full([chest1], { moving_belt: true })], 0, build)?.cause).toBe("output chest full");
        expect(whyNotStable([full([chest1], { meets_target_rate: true })], 0, build)).toBeNull();
        expect(whyNotStable([full([])], 0, build)?.cause).toBe("nothing holds");
    });

    it("is read from the as-built check of the alternative", () => {
        const view = { label: "x", verdict: "unstable" as const, ranking: { meets_target_rate: false },
            assessment: { holds: false, items_per_second: 0, backpressure_loss: null }, expected_output_items: 4, insights: [] };
        const as_built = { holds: false, actual_output_items: 0, start_phases_checked: 1, full_output_chests: [chest1] };
        expect(whyNotStableClockOf({ ...view, as_built }).full_output_chests).toEqual([chest1]);
        expect(whyNotStableClockOf({ ...view, as_built: undefined }).full_output_chests).toEqual([]);
    });
});

const circuits: ExportShortfall = { belt_id: 2, item: "electronic-circuit", item_label: "electronic circuit", expected_per_second: 80, delivered_per_second: 73.4,
    inserter_ids: [16, 17] };

describe("an export belt that gets less than it is taken off at", () => {
    const short = (shortfalls: ExportShortfall[], overrides: Partial<WhyNotStableClock> = {}) => clock({ verdict: "unstable", meets_target_rate: false,
        assessment: { holds: false, items_per_second: 80, backpressure_loss: null }, export_shortfalls: shortfalls, ...overrides });
    const build: WhyNotStableBuild = { target_items_per_second: 80, backed_up_belts: false, not_made: [] };

    it("is told as the cause, with the belt, the item and both rates", () => {
        expect(whyNotStable([short([circuits])], 0, build)).toEqual({
            cause: "export belt short",
            message: "The selected clock (Batched swings: 2 output swings per cycle) moves 80 a second, but Belt 2 gets 73.4 a second of electronic circuit, "
                + "and 80 a second is taken off it (inserters 16 and 17 fill it).",
        });
    });

    it("names an inserter alone in the singular, and each belt", () => {
        const cable: ExportShortfall = { ...circuits, belt_id: 3, item_label: "copper cable", expected_per_second: 1, delivered_per_second: 0.5, inserter_ids: [4] };
        expect(whyNotStable([short([circuits, cable])], 0, build)?.message).toContain(
            "and 80 a second is taken off it (inserters 16 and 17 fill it). Belt 3 gets 0.5 a second of copper cable, and 1 a second is taken off it (inserter 4 fills it).");
    });

    it("is not said of a clock that is off the target, or that meets it", () => {
        expect(whyNotStable([short([circuits], { assessment: { holds: false, items_per_second: 65, backpressure_loss: null } })], 0, build)?.cause).toBe("nothing holds");
        expect(whyNotStable([short([circuits], { meets_target_rate: true })], 0, build)).toBeNull();
    });

    it("is read from the as-built check of the alternative", () => {
        const view = { label: "x", verdict: "unstable" as const, ranking: { meets_target_rate: false },
            assessment: { holds: false, items_per_second: 80, backpressure_loss: null }, expected_output_items: 4, insights: [] };
        const as_built = { holds: false, actual_output_items: 4, start_phases_checked: 1, export_shortfalls: [circuits] };
        expect(whyNotStableClockOf({ ...view, as_built }).export_shortfalls).toEqual([circuits]);
        expect(whyNotStableClockOf({ ...view, as_built: undefined }).export_shortfalls).toEqual([]);
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
            full_output_chests: [], export_shortfalls: [],
        });
    });

    it("takes a clock without a belt, or kept before its belt was, for one not made for a moving belt", () => {
        const view = { label: "Observed windows", verdict: "stable" as const, ranking: { meets_target_rate: true },
            assessment: { holds: true, items_per_second: 1, backpressure_loss: null }, as_built: null, expected_output_items: 4, insights: [] };
        expect(whyNotStableClockOf(view)).toEqual({ label: "Observed windows", verdict: "stable", meets_target_rate: true,
            assessment: view.assessment, moving_belt: false, expected_output_items: 4, spare_time: null,
            full_output_chests: [], export_shortfalls: [] });
        expect(whyNotStableClockOf({ ...view, belt: { kind: "backed_up" } }).moving_belt).toBe(false);
    });
});
