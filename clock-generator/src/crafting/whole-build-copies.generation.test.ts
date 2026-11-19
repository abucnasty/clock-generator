import { beforeAll, describe, expect, it } from "vitest";
import { clockOf, lossesOf, threeCopiesOnLine, TWO_SWINGS, COORDINATED_ON_LINE } from "../../tests/configs/whole-build-clocks";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

// Three copies of a build of three of the automation science assemblers, the copies 27 tiles apart, on the output line of the
// scaffold: the fourth test of "a whole build of nine identical assemblers, clocked as given" (whole-build.generation.test.ts,
// where the row of nine at 9 and at 6 tiles are made), in a file of its own so that no file holds more than one long generation.
describe("a whole build of nine identical assemblers, clocked as given", () => {
    let in_copies: ClockAlternativesResult;

    beforeAll(() => {
        in_copies = generateClockAlternatives(threeCopiesOnLine(), { logger: quiet });
    });

    it("works with copies of a build that itself holds like assemblers: the copies and the inserters of a copy are both spaced", () => {
        expect(lossesOf(in_copies, TWO_SWINGS)).toEqual(["3 copper-plate 214/245", "3 iron-gear-wheel 215/245"]);
        expect(clockOf(in_copies, TWO_SWINGS).assessment.shared_lane_losses?.map(loss => "copy" in loss ? loss.copy : null)).toEqual([1, 1]);
        // Coordinated Sources is selected with the second assembler's output in two windows. Without the output line it put
        // the first two assemblers' outputs in six (COORDINATED), which the game fails (below). On the nine assemblers, this
        // clock makes 96 on every assembler in each of 99 window cycles in the game.
        const selected = in_copies.alternatives[in_copies.selected_index];
        expect(selected.id).toBe("coordinated_sources");
        expect(selected.result.clock_windows).toEqual(COORDINATED_ON_LINE);
    });
});
