import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import type { InserterEdge } from "../../data-types/planner-facts";
import Fraction, { fraction } from "../../data-types/fraction";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { Cut, refuses } from "./checks";
import { feasibilityOfConfig, withTarget } from "./feasibility-test-helpers";

/**
 * C1, a recipe's machines, on rocket fuel with jelly stack 15: machines 1 and 3 (rocket fuel from jelly) are fed jelly
 * by inserters 6, 7, 8 and 9 from machine 2, a hand of 15 every 8 ticks each (pickup 1, two rotations of 3, drop 1).
 */
describe("C1: a recipe's machines craft no faster than their inputs arrive", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL_JELLY_STACK_15) as Config;

    it("4 hands of 15 every 8 ticks bring 4 x 15 x 60 / 8 = 450 jelly a second; at 30 a craft that is 15 crafts a second; "
        + "a target of 60 rocket fuel at 4 a craft needs 60 / 4 = 15: it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(sample);
        const machines = cut("C1 machine:rocket-fuel-from-jelly");
        expect(machines.capacity!.toString()).toBe("15");
        expect(machines.need.toString()).toBe("15");
        expect(issues).toEqual([]);
    });

    it("a target of 61 needs 61 / 4 = 15.25 crafts a second, above the 15: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(sample, 61));
        expect(rules).toEqual(["C1"]);
        expect(issues[0]).toMatchObject({ nodes: ["machine:1", "machine:3"], need: 15.25, capacity: 15 });
        expect(texts[0]).toMatchInlineSnapshot(`"Machines 1 and 3 (rocket fuel from jelly) can make at most 15 crafts a second: inserters 6, 7, 8 and 9 bring at most 450 a second of jelly into machines 1 and 3 (4 hands of 15 every 8 ticks), and a craft takes 30. The target needs 15.25 crafts a second of them (61 a second of rocket fuel at 4 a craft). Lower the target, or give them more inserters or bigger hands."`);
    });

    it("the window code's 9 ticks a swing (total + 1) would bring 4 x 15 x 60 / 9 = 400 jelly, 13.33 crafts, and refuse 60; "
        + "the floor of 8 ticks does not", () => {
        const jelly = toPlannerFacts(sample).edges.filter((edge): edge is InserterEdge => edge.via === "inserter" && edge.item === "jelly");
        expect(jelly.map(edge => [edge.entity, edge.hand.by_item, edge.floor.cycle])).toEqual([
            ["inserter:6", 15, 8], ["inserter:7", 15, 8], ["inserter:8", 15, 8], ["inserter:9", 15, 8],
        ]);
        expect(4 * 15 * 60 / 9 / 30).toBeLessThan(15);
        expect(feasibilityOfConfig(sample).issues).toEqual([]);
    });
});

/**
 * A yield or a fuel a craft is a float in the facts, whose noise is some 1e-16 of it: a need above its capacity by less
 * than a billionth of the capacity may be that noise, and does not refuse. 15 crafts against 15 x (1 + 1e-12) passes; 15
 * crafts against 15 x (1 + 1e-6) refuses, as does 61 / 4 = 15.25 against 15.
 */
describe("a need above its capacity by no more than the floats' noise does not refuse", () => {
    const cut = (need: Fraction, capacity: Fraction): Cut => ({ rule: "C1", name: "C1 test", group: null, need, capacity, issues: () => [] });
    it("15 x (1 + 1e-12) against 15 passes; 15 x (1 + 1e-6) and 15.25 refuse", () => {
        expect(refuses(cut(fraction(15).multiply(fraction(1_000_000_000_001, 1_000_000_000_000)), fraction(15)))).toBe(false);
        expect(refuses(cut(fraction(15).multiply(fraction(1_000_001, 1_000_000)), fraction(15)))).toBe(true);
        expect(refuses(cut(fraction(61, 4), fraction(15)))).toBe(true);
        expect(refuses(cut(fraction(15), fraction(15)))).toBe(false);
    });
});
