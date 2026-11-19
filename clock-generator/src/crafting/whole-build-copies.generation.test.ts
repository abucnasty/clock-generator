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
        // Coordinated Sources is selected with every output in six windows and every input in three (150.17 wakeups a minute).
        // Without the output line it put the third assembler's output in two (COORDINATED), which the game fails (below). Once an
        // output block's release acts in the game's tick, this clock is back on every copy after the trials' output block; before,
        // a copy was not, and the selection was a clock of 784.24 wakeups a minute. In Factorio 2.1.24, on the nine assemblers
        // of the scaffold (assembler k with the windows of assembler ((k - 1) mod 3) + 1), from ruling 60's start, this clock
        // holds by the game tests' protocol with an output block, the same on two runs: steady at tick 7,056, net 13,824 of
        // 13,824 over the baseline's whole cycles, back 5,036 ticks after the block's release.
        const selected = in_copies.alternatives[in_copies.selected_index];
        expect(selected.id).toBe("coordinated_sources");
        expect(selected.result.clock_windows).toEqual(COORDINATED_ON_LINE);
    });
});
