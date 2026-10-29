import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { FeasibilityError } from "../../config/errors";
import { Config } from "../../config/schema";
import { feasibilityOfConfig, withTarget } from "./feasibility-test-helpers";

/**
 * C7, the target destroyed, on the ore voiders: recycler 1 uses an iron ore a craft and places a quarter of one into
 * the car, which inserters 1 and 2 bring back into it; inserters 3-6 bring the ore in from the infinity chest, a hand of
 * 16 every 8 ticks each: 4 x 16 x 60 / 8 = 480 a second.
 */
describe("C7: a destroyed target is at most what the machines destroy and what is brought in", async () => {
    const exact = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED) as Config;
    const overbeaconed = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_OVERBEACONED) as Config;

    it("the exact-speed recycler crafts 540 a second and destroys 1 - 1/4 a craft, 405 a second; a target of 405 passes, exactly "
        + "at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(withTarget(exact, 405));
        const machines = cut("C7 machines");
        expect([machines.need.toString(), machines.capacity!.toString()]).toEqual(["405", "405"]);
        expect(issues).toEqual([]);
    });

    it("a target of 406 is above the 405: refused, once (C7, not C1 again)", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(exact, 406));
        expect(rules).toEqual(["C7"]);
        expect(issues[0]).toMatchObject({ nodes: ["machine:1"], need: 406, capacity: 405 });
        expect(texts[0]).toMatchInlineSnapshot(`"Machine 1 (iron ore recycling) can destroy at most 405 a second of iron ore: it crafts at most 540 a second, and a craft uses 1 and gives back 0.25. The target is 406 a second. Lower the target, or add machines or make them faster."`);
    });

    it("812 over 2 copies is 406 a copy: the opening says the figures are for one copy, and the target's figure says it no more", () => {
        const { issues } = feasibilityOfConfig(withTarget(exact, 812, 2));
        expect(new FeasibilityError([...issues], { items_per_second: 812, copies: 2 }).message).toMatchInlineSnapshot(`"No clock can hold this build's target of 812 a second over 2 copies (every figure here is for one copy): Machine 1 (iron ore recycling) can destroy at most 405 a second of iron ore: it crafts at most 540 a second, and a craft uses 1 and gives back 0.25. The target is 406 a second. Lower the target, or add machines or make them faster."`);
    });

    it("the overbeaconed recycler destroys 639.23 a second; the inserters bring 480: a target of 480 passes, 481 is refused", () => {
        const at = feasibilityOfConfig(withTarget(overbeaconed, 480));
        expect([at.cut("C7 inserters").need.toString(), at.cut("C7 inserters").capacity!.toString()]).toEqual(["480", "480"]);
        expect(at.issues).toEqual([]);
        const { rules, texts } = feasibilityOfConfig(withTarget(overbeaconed, 481));
        expect(rules).toEqual(["C7"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build (4 hands of 16 every 8 ticks), and the target is 481 a second. Lower the target, or give the machines more inserters or bigger hands."`);
    });

    it("the window code's 9 ticks a swing would bring 4 x 16 x 60 / 9 = 426.67 and refuse 430; the floor of 8 does not", () => {
        expect(4 * 16 * 60 / 9).toBeLessThan(430);
        expect(feasibilityOfConfig(withTarget(overbeaconed, 430)).issues).toEqual([]);
    });
});
