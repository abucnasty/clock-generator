import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

/** The 72-tick clock of two output swings each output cycle: outputs open 2-14 and inputs 29-52, a clock the game fails at 9 tiles */
const TWO_SWINGS = "takt_batches_observed_swings_2";

const clockOf = (result: ClockAlternativesResult, id: string) => {
    const clock = result.alternatives.find(alternative => alternative.id === id);
    if (clock === undefined) throw new Error(`no clock ${id}: ${result.alternatives.map(it => it.id).join(", ")}`);
    return clock;
};

// nine automation science assemblers of one copy, each at a crafting speed of its own (so the build is no copies of one
// assembler), their input inserters on one belt 9 or 6 tiles apart: the check of the input lanes runs from the inserters'
// positions. In the game the 9-tile row falls short on this clock: the second input finds the gap the first one's pickup
// made 72 ticks earlier (9 tiles of a turbo belt); the 6-tile row holds.
describe("the input-lane check from the positions of one copy's inserters", () => {
    let nine: ClockAlternativesResult;
    let six: ClockAlternativesResult;

    beforeAll(() => {
        nine = generateClockAlternatives(automationRow({ machines: 9, pitch: 9, distinct: true }), { logger: quiet });
        six = generateClockAlternatives(automationRow({ machines: 9, pitch: 6, distinct: true }), { logger: quiet });
    });

    it("finds the second input short at 9 tiles on the 72-tick clock, which is not recommended", () => {
        const clock = clockOf(nine, TWO_SWINGS);
        expect(clock.result.simulation_duration.ticks).toBe(72);
        expect(clock.verdict).toBe("unstable");
        expect(clock.assessment.shared_lane_losses?.map(loss => "inserter_id" in loss ? `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings} copy ${loss.copy} of ${loss.copies}` : loss.kind))
            .toEqual(["3 copper-plate 56/65 copy 1 of 1", "3 iron-gear-wheel 58/65 copy 1 of 1"]);
        expect(clock.checked_lanes?.rows.map(row => `${row.belt_id}/${row.lane} ${row.state.kind}`)).toEqual(["1/1 short", "1/2 short", "2/1 rate_fits"]);
        expect(nine.alternatives[nine.selected_index].id).not.toBe(TWO_SWINGS);
    });

    it("holds at 6 tiles on the same clock, which is recommended", () => {
        const clock = clockOf(six, TWO_SWINGS);
        expect(clock.result.clock_windows).toEqual(clockOf(nine, TWO_SWINGS).result.clock_windows);
        expect(clock.verdict).toBe("stable");
        expect(clock.checked_lanes?.rows.map(row => `${row.belt_id}/${row.lane} ${row.state.kind}`)).toEqual(["1/1 holds", "1/2 holds", "2/1 rate_fits"]);
        expect(six.alternatives[six.selected_index].id).toBe(TWO_SWINGS);
    });
});
