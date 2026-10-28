import { describe, expect, it } from "vitest";
import { Config } from "../../config/schema";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane, withTarget } from "./feasibility-test-helpers";

/**
 * C2, supply from outside: a gear assembler (2 iron plates a gear) fed by inserters 1 and 2 from lane 1 of belt 1, the
 * only iron plate there is; inserters 3 and 4 put the gears into an infinity chest. The lane carries 60 / 2 x 4 = 120
 * plates a second (half a turbo belt's 60 items a second, stacks of 4); the two inserters could bring 2 x 16 x 60 / 11
 * = 174.55.
 */
const gears: Config = {
    target_output: { recipe: "iron-gear-wheel", items_per_second: 60, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 }],
    belts: [belt(1, [lane("iron-plate")])],
    chests: [infinityChest(2, ["iron-gear-wheel"])],
    inserters: [
        inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
        inserter(2, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
        inserter(3, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
        inserter(4, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
    ],
} as Config;

describe("C2: what comes from outside is at most what its lanes carry", () => {
    it("60 gears a second take 2 x 60 = 120 iron plates a second, all lane 1 of belt 1 carries: it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(gears);
        const supply = cut("C2 iron-plate from outside");
        expect([supply.need.toString(), supply.capacity!.toString()]).toEqual(["120", "120"]);
        expect(issues).toEqual([]);
    });

    it("61 gears a second take 122 plates a second, above the lane's 120: refused (the lane is said once, by C2)", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(gears, 61));
        expect(rules).toEqual(["C2"]);
        expect(issues[0]).toMatchObject({ nodes: ["belt:1/lane:1#iron-plate"], need: 122, capacity: 120 });
        expect(texts[0]).toMatchInlineSnapshot(`"At most 120 a second of iron plate reaches the machines that need it (lane 1 of belt 1 brings at most 120 a second from outside the build), and machine 1 must take 122 a second of it. Lower the target, or bring in more iron plate."`);
    });

    it("the planner's 1.43 surplus over 120 plates would ask 171.6 of the lane and refuse 60 gears; the pass reads no surplus", () => {
        expect(120 * 1.43).toBeGreaterThan(120);
        expect(feasibilityOfConfig(gears).issues).toEqual([]);
    });
});
