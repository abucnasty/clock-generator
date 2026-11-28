import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { quiet, withoutSharedLaneFacts } from "./generate-blueprint-test-helpers";

// CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: Coordinated Sources is composed on 352 ticks from the clocks made before it, and on
// the advanced-circuit lane its copies share copy 5 takes half of what one copy alone takes. Measured on the sample as it was
// before it stated the spacing of its copies, the way its belts move and the ends of its lanes, where the lane is an infinite
// end. The sample now states that its input lanes end in a dead end, and this test is of a lane that flows on: it takes the
// sample without those facts. The maker judges its clock with the copies while it chooses, and no composition holds with them.
// One generation of 245 s: a file of its own (it was in shared-lane-verdict.generation.test.ts).
describe("a composed clock that is not stable on a lane the copies share", () => {
    it("is not made: the maker keeps the recommended clock, and the result says so in not_made", async () => {
        // the sample is one copy at 480/11 a second; this case is its 5.5 copies on a lane they share, 240 a second
        const sample = await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY);
        const shared = { ...sample, setpoint: { ...sample.setpoint, items_per_second: 240, copies: 5.5 } };
        const generated = generateClockAlternatives(withoutSharedLaneFacts(shared), { logger: quiet });
        expect(generated.alternatives.some(it => it.maker === "per-branch")).toBe(false);
        const composed = generated.not_made.find(it => it.id === "per-branch");
        expect(composed).toMatchObject({ label: "Coordinated Sources" });
        expect(composed!.reason).toMatch(/^the local choice keeps the recommended clock/);
    });
});
