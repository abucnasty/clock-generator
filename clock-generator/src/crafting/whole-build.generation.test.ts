import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { validateConfig } from "./plan/validate-config";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

/** The 72-tick clock of two output swings each output cycle: outputs open 2-14 and inputs 29-52, a clock the game fails at 9 tiles */
const TWO_SWINGS = "takt_batches_observed_swings_2";

const clockOf = (result: ClockAlternativesResult, id: string) => {
    const clock = result.alternatives.find(alternative => alternative.id === id);
    if (clock === undefined) throw new Error(`no clock ${id}: ${result.alternatives.map(it => it.id).join(", ")}`);
    return clock;
};

const lossesOf = (result: ClockAlternativesResult, id: string) => (clockOf(result, id).assessment.shared_lane_losses ?? [])
    .map(loss => "inserter_id" in loss ? `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings}` : loss.kind);

// The whole build of nine identical automation science assemblers, as a Sidecar export of all nine gives it: a build that
// holds nine copies of one assembler, clocked as it is given, every inserter where it stands. The pair pins that its input
// lanes are checked from the inserters' positions: at 9 tiles the 72-tick clock misses swings on the second input (in the
// game the second machine falls short at some starts), at 6 tiles it holds and is recommended.
describe("a whole build of nine identical assemblers, clocked as given", () => {
    let nine: ClockAlternativesResult;
    let six: ClockAlternativesResult;
    let in_copies: ClockAlternativesResult;

    beforeAll(() => {
        nine = generateClockAlternatives(automationRow({ machines: 9, pitch: 9 }), { logger: quiet });
        six = generateClockAlternatives(automationRow({ machines: 9, pitch: 6 }), { logger: quiet });
        // three copies of a build of three of the assemblers, the copies 27 tiles apart: the same row
        in_copies = generateClockAlternatives(automationRow({ machines: 3, pitch: 9, copies: 3, copy_offset: { x: 27, y: 0 } }), { logger: quiet });
    });

    it("passes Check", () => {
        expect(() => validateConfig(automationRow({ machines: 9, pitch: 9 }))).not.toThrow();
    });

    it("at 9 tiles: the 72-tick clock is unstable, the second input short, and another clock is recommended", () => {
        expect(clockOf(nine, TWO_SWINGS).result.simulation_duration.ticks).toBe(72);
        expect(clockOf(nine, TWO_SWINGS).verdict).toBe("unstable");
        expect(lossesOf(nine, TWO_SWINGS)).toEqual(["3 copper-plate 56/65", "3 iron-gear-wheel 58/65"]);
        expect(nine.alternatives[nine.selected_index].id).toBe("time_study_windows");
        expect(nine.alternatives[nine.selected_index].verdict).toBe("stable");
    });

    it("at 6 tiles: the same clock holds and is recommended", () => {
        expect(clockOf(six, TWO_SWINGS).result.clock_windows).toEqual(clockOf(nine, TWO_SWINGS).result.clock_windows);
        expect(clockOf(six, TWO_SWINGS).verdict).toBe("stable");
        expect(six.alternatives[six.selected_index].id).toBe(TWO_SWINGS);
    });

    it("works with copies of a build that itself holds like assemblers: the copies and the inserters of a copy are both spaced", () => {
        expect(lossesOf(in_copies, TWO_SWINGS)).toEqual(["3 copper-plate 56/65", "3 iron-gear-wheel 58/65"]);
        expect(clockOf(in_copies, TWO_SWINGS).assessment.shared_lane_losses?.map(loss => "copy" in loss ? loss.copy : null)).toEqual([1, 1]);
        expect(in_copies.alternatives[in_copies.selected_index].id).toBe("time_study_windows");
    });
});
