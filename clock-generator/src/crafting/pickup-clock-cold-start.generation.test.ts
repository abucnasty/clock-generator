import fs from "node:fs";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";
import {beltPickupVariantOf, coldStart} from "../../tests/game/builds/pickup-clock-cold-start-runs";
import {pickupClockColdStartTests} from "../../tests/game/builds/pickup-clock-cold-start-generation";

// The clocked cold starts: the simulator against the game's counts, and the stored windows against the recorded clocks, are
// checked without generating (pickup-clock-cold-start-mechanics.test.ts); here the runs of
// tests/game/builds/pickup-clock-cold-start-cases.ts name the generator's selection.
// The runs of a side pickup fixture on near lane 1 name the selection of a config. The few of those configs that the
// belt-pickup-clock generation test (belt-pickup-clock.generation.test.ts, belt-pickup-clock-cases.ts) generates are checked
// there, on that generation (expectColdStartRunsOnSelection).
describe("cold start runs name the clock they were recorded on", () => {
    test("the runs on the selection of a side pickup fixture are checked on the generation of belt-pickup-clock-<tier>.generation.test.ts", () => {
        const variants = pickupClockSpeedCases("electromagnetic").map(it => it.name);
        let shared = 0;
        for (const [name, run] of Object.entries(coldStart.runs)) {
            const variant = beltPickupVariantOf(run);
            if (variant === undefined) continue;
            shared++;
            expect(variants, `${name} names ${variant}, which the belt-pickup-clock generation tests do not generate`).toContain(variant);
        }
        expect(shared).toBeGreaterThan(0);
        expect(fs.readFileSync(path.join(__dirname, "../../tests/game/builds/belt-pickup-clock-generation.ts"), "utf8"),
            "the belt-pickup-clock generation tests no longer check these runs").toContain("expectColdStartRunsOnSelection(variant.name,");
    });
});

pickupClockColdStartTests();
