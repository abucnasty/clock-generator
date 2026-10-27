import fs from "node:fs";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";
import {readControls} from "../../tests/game/builds/clock-controls";
import {beltPickupVariantOf} from "../../tests/game/builds/pickup-clock-cold-start-runs";

const controls = readControls<{cold_start: {runs: Record<string, {case: string; rotate: number}>}}>("pickup-clock-start-controls.json").cold_start;

// The clocked cold starts, and the clock each run was recorded on, are checked on each belt tier in
// pickup-clock-cold-start-<tier>.generation.test.ts (tests/game/builds/pickup-clock-cold-start-generation.ts), so that a
// shard of the generation tests does not wait on all of them.
// The runs of a side pickup fixture on near lane 1 name the selection of a config that the belt-pickup-clock generation
// tests (belt-pickup-clock-<tier>.generation.test.ts) generate too; they are checked there, on that generation
// (expectColdStartRunsOnSelection).
describe("cold start runs name the clock they were recorded on", () => {
    test("the runs on the selection of a side pickup fixture are checked on the generation of belt-pickup-clock-<tier>.generation.test.ts", () => {
        const variants = pickupClockSpeedCases("electromagnetic").map(it => it.name);
        let shared = 0;
        for (const [name, run] of Object.entries(controls.runs)) {
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
