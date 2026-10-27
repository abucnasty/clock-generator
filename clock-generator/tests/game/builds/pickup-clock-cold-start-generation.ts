import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockHash} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";
import {RECORDED_ON_THE_MOVING_BELT_CLOCK} from "../../../src/crafting/generate-blueprint-test-helpers";
import {beltPickupVariantOf, coldStart, configOf} from "./pickup-clock-cold-start-runs";
import {COLD_START_GENERATED} from "./pickup-clock-cold-start-cases";

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/**
 * The generation tests of the clocked cold starts: the clock each run was recorded on is the one the generator's selection
 * makes. The simulator against the game's counts from the cold start, and the stored windows against the recorded clock,
 * are pickup-clock-cold-start-mechanics.test.ts (no generation); the runs named in pickup-clock-cold-start-cases.ts are the ones
 * generated here.
 */
export function pickupClockColdStartTests() {
    // The clock each run was recorded on is the one it names: the generator's selection for a run started at the period's
    // beginning (`rotate` 0), with the deciders in the mirror order where the run was. The game test checks this hash
    // against the clock it builds; a selection that moved left these runs pinned to the old one (#275).
    // The runs of a side pickup fixture on near lane 1 name the selection of a config. The few of those configs that the
    // belt-pickup-clock generation test (belt-pickup-clock.generation.test.ts, belt-pickup-clock-cases.ts) generates are checked
    // there, on that generation (expectColdStartRunsOnSelection); this file generates the runs of pickup-clock-cold-start-cases.ts.
    describe("cold start runs name the clock the selection makes", () => {
        // the runs recorded on the clock planned with the belts moving name a clock no longer made (#460)
        const inTheGap = (run: {case: string}) => RECORDED_ON_THE_MOVING_BELT_CLOCK.has(`electromagnetic-${run.case.replace(/-l[12]$/, "")}`);

        test("the runs on the selection of a side pickup fixture belt-pickup-clock does not generate are the cases of pickup-clock-cold-start-cases.ts", () => {
            const others = Object.keys(coldStart.runs).filter(name => {
                const run = coldStart.runs[name];
                return run.rotate === 0 && beltPickupVariantOf(run) === undefined && !inTheGap(run);
            });
            for (const name of COLD_START_GENERATED.keys()) expect(others, `${name} is not a run that needs a generation`).toContain(name);
        });

        test.each([...COLD_START_GENERATED.keys()])("%s", async name => {
            const run = coldStart.runs[name];
            const clock = coldStart.clocks[run.clock];
            const config = await configOf(run.case);
            const generated = generateClockAlternatives(config, {logger: quiet});
            const chosen = generated.alternatives[generated.selected_index].result;
            let exported: {blueprint: any; schedule: any} = chosen.subtick ?? chosen;
            if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
            expect(clockHash(exported), "the selection no longer makes the clock this run was recorded on").toBe(clock.clock_sha256);
        });
    });
}
