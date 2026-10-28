import { describe, expect, it } from "vitest";
import { laneCapacityIssues } from "../../config/lane-capacity-validator";
import { Config } from "../../config/schema";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane, withTarget } from "./feasibility-test-helpers";

/**
 * C5, a belt: machine 1 makes gears (2 iron plates each, brought by inserters 1-5 from infinity chest 1, 600 a second)
 * and inserters 6, 7 and 8 drop them onto belt 2, while inserter 9 puts more into infinity chest 2; inserters 10, 11 and
 * 12 take the gears off belt 2 into machine 2, which makes automation science packs (a gear and a copper plate each, the
 * copper from chest 1 by inserters 13-15), taken out by inserters 16-18 into infinity chest 3. Belt 2 is a turbo belt
 * of stack 4: its two sides carry 2 x 120 = 240 items a second. The three takers could take 3 x 16 x 60 / 11 = 261.82.
 */
const science: Config = {
    target_output: { recipe: "automation-science-pack", items_per_second: 240, copies: 1 },
    machines: [
        { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 },
        { id: 2, recipe: "automation-science-pack", productivity: 0, crafting_speed: 10000 },
    ],
    belts: [belt(2, [lane("iron-gear-wheel")])],
    chests: [infinityChest(1, ["iron-plate", "copper-plate"]), infinityChest(2, ["iron-gear-wheel"]), infinityChest(3, ["automation-science-pack"])],
    inserters: [
        ...[1, 2, 3, 4, 5].map(id => inserter(id, { type: "chest", id: 1 }, { type: "machine", id: 1 })),
        ...[6, 7, 8].map(id => inserter(id, { type: "machine", id: 1 }, { type: "belt", id: 2 })),
        inserter(9, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
        ...[10, 11, 12].map(id => inserter(id, { type: "belt", id: 2 }, { type: "machine", id: 2 })),
        ...[13, 14, 15].map(id => inserter(id, { type: "chest", id: 1 }, { type: "machine", id: 2 })),
        ...[16, 17, 18].map(id => inserter(id, { type: "machine", id: 2 }, { type: "chest", id: 3 })),
    ],
} as Config;

describe("C5: a belt carries at most its ceiling", () => {
    it("240 science packs a second take 240 gears a second off belt 2, all its two sides carry: it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(science);
        const lanes = cut("C5 belt:2#iron-gear-wheel");
        expect([lanes.need.toString(), lanes.capacity!.toString()]).toEqual(["240", "240"]);
        expect(issues).toEqual([]);
    });

    it("241 science packs a second take 241 gears off belt 2: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(withTarget(science, 241));
        expect(rules).toEqual(["C5"]);
        expect(issues[0]).toMatchObject({ nodes: ["belt:2/lane:1#iron-gear-wheel"], need: 241, capacity: 240 });
        expect(texts[0]).toMatchInlineSnapshot(`"Belt 2 carries at most 240 a second of iron gear wheel, and inserters 10, 11 and 12 must take 241 a second off it. Lower the target, or take the item from more lanes."`);
    });

    it("the planned split puts every drop on lane 1, 240 a second on a side of 120, and the lane check would refuse; "
        + "the pass holds a drop to its belt, as the game may put it on either side", () => {
        expect(laneCapacityIssues(science).map(issue => [issue.kind, issue.lanes, issue.items_per_second, issue.capacity_per_second]))
            .toEqual([["take", [1], 240, 120]]);
        expect(feasibilityOfConfig(science).issues).toEqual([]);
    });
});
