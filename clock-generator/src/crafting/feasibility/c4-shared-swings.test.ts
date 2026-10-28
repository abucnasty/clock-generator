import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { feasibilityOfConfig, withTarget } from "./feasibility-test-helpers";

/**
 * C4, one inserter's swings, on processing units: inserter 1 alone brings both electronic circuits (20 a craft) and
 * advanced circuits (2 a craft) from the infinity chest, a hand of 16 every 8 ticks for either, one item a swing. A
 * craft makes 4 processing units (productivity 300%), so p processing units a second take p / 4 x 22 circuits, and
 * p / 4 x 22 / 16 swings of 8 ticks: at most 60 x 16 / 8 = 120 items a second of the two together.
 */
describe("C4: an inserter that carries several items swings for one at a time", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS) as Config;

    it("15 processing units a second take 75 + 7.5 = 82.5 circuits a second, 82.5 x 8 / (60 x 16) = 0.6875 of its swings", () => {
        const swings = feasibilityOfConfig(sample).cut("C4 inserter:1");
        expect([swings.need.toString(), swings.capacity!.toString()]).toEqual(["11/16", "1"]);
    });

    it("240 / 11 = 21.82 processing units a second take 120 circuits a second, all of its swings: it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(withTarget(sample, 240, 11));
        expect(cut("C4 inserter:1").need.toString()).toBe("1");
        expect(issues).toEqual([]);
    });

    it("22 processing units a second take 121 circuits a second, 121 / 120 of its swings: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(sample, 22));
        expect(rules).toEqual(["C4"]);
        expect(issues[0]).toMatchObject({ edges: ["inserter:1/electronic-circuit", "inserter:1/advanced-circuit"], capacity: 1 });
        expect(issues[0].need).toBeCloseTo(121 / 120, 12);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 1 carries electronic circuit and advanced circuit, one item a swing: at least 110 a second of electronic circuit, in hands of 16 at 8 ticks a swing, takes 0.92 of its swings, and at least 11 a second of advanced circuit, in hands of 16 at 8 ticks a swing, takes 0.09 of its swings; 1.01 of its swings in all, more than it has. Lower the target, or give each item an inserter of its own."`);
    });

    it("the window code's 9 ticks a swing would take 120 x 9 / 960 = 1.125 of its swings at 240 / 11 and refuse; the floor of 8 does not", () => {
        expect(120 * 9 / (60 * 16)).toBeGreaterThan(1);
        expect(feasibilityOfConfig(withTarget(sample, 240, 11)).issues).toEqual([]);
    });
});
