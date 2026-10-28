import { describe, expect, it } from "vitest";
import { FeasibilityError } from "../../config/errors";
import { Config } from "../../config/schema";
import type { InserterEdge } from "../../data-types/planner-facts";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane, withTarget } from "./feasibility-test-helpers";

/**
 * C3, the target taken out: a gear assembler fed iron plates from an infinity chest by inserters 1 and 2 (2 x 120 = 240
 * plates a second, 120 gears), and inserter 3 alone takes the gears out onto belt 2: a hand of 16 every 11 ticks (pickup
 * 1, two rotations of 3, a drop of 16 / 4 = 4 stacks), 16 x 60 / 11 = 87.27 gears a second.
 */
const gears: Config = {
    target_output: { recipe: "iron-gear-wheel", items_per_second: 960, copies: 11 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 }],
    belts: [belt(2, [lane("iron-gear-wheel")])],
    chests: [infinityChest(1, ["iron-plate"])],
    inserters: [
        inserter(1, { type: "chest", id: 1 }, { type: "machine", id: 1 }),
        inserter(2, { type: "chest", id: 1 }, { type: "machine", id: 1 }),
        inserter(3, { type: "machine", id: 1 }, { type: "belt", id: 2 }),
    ],
} as Config;

describe("C3: the target leaves the build at most as fast as its output inserters take it", () => {
    it("1 hand of 16 every 11 ticks takes 960 / 11 = 87.27 gears a second, and 960 over 11 copies is 960 / 11 a copy: "
        + "it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(gears);
        const out = cut("C3 iron-gear-wheel");
        expect([out.need.toString(), out.capacity!.toString()]).toEqual(["960/11", "960/11"]);
        expect(issues).toEqual([]);
    });

    it("88 gears a second is above the 87.27: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(gears, 88));
        expect(rules).toEqual(["C3"]);
        expect(issues[0]).toMatchObject({ edges: ["inserter:3/iron-gear-wheel"], need: 88 });
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 3 can take at most 87.27 a second of iron gear wheel out of the build (1 hand of 16 every 11 ticks), and the target is 88 a second. Lower the target, or give the output more inserters or bigger hands."`);
    });

    it("968 over 11 copies is 88 a copy: the opening says the figures are for one copy, and the target's figure says it no more", () => {
        const { issues } = feasibilityOfConfig(withTarget(gears, 968, 11));
        expect(new FeasibilityError([...issues], { items_per_second: 968, copies: 11 }).message).toMatchInlineSnapshot(`"No clock can hold this build's target of 968 a second over 11 copies (every figure here is for one copy): Inserter 3 can take at most 87.27 a second of iron gear wheel out of the build (1 hand of 16 every 11 ticks), and the target is 88 a second. Lower the target, or give the output more inserters or bigger hands."`);
    });

    it("the planned swing of 12 ticks onto a belt moves 16 x 60 / 12 = 80 a second and would refuse 85; the floor of 11 does not", () => {
        const [out] = toPlannerFacts(gears).edges.filter((edge): edge is InserterEdge => edge.via === "inserter" && edge.entity === "inserter:3");
        expect([out.planned.cycle, out.floor.cycle]).toEqual([12, 11]);
        expect(feasibilityOfConfig(withTarget(gears, 85)).issues).toEqual([]);
    });

    it("a target nothing takes out of the build is left to the checks that refuse it today and to the simulator: it passes here", () => {
        const kept = withTarget(gears, 10);
        kept.inserters = kept.inserters.slice(0, 2);
        expect(feasibilityOfConfig(kept).issues).toEqual([]);
    });
});
