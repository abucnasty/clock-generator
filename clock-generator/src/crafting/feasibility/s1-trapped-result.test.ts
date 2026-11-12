import { describe, expect, it } from "vitest";
import { Config } from "../../config/schema";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane } from "./feasibility-test-helpers";

describe("S1: a result with no way out stops its machine for good", () => {
    /**
     * Machine 2 makes iron sticks the target does not need, and inserter 4 puts them into a buffer chest nothing empties:
     * it stops for good once the chest is full, and the target's gears never need it.
     */
    it("a trapped result of a machine the target does not need: it passes", () => {
        const config = {
            setpoint: { recipe: "iron-gear-wheel", items_per_second: 10, copies: 1 },
            machines: [
                { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 },
                { id: 2, recipe: "iron-stick", productivity: 0, crafting_speed: 1000 },
            ],
            belts: [belt(1, [lane("iron-plate", { lane_end: { kind: "infinite" } })])],
            chests: [infinityChest(2, ["iron-gear-wheel"]), { id: 3, type: "buffer-chest", storage_size: 1, item_filter: "iron-stick" }],
            inserters: [
                inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
                inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
                inserter(3, { type: "belt", id: 1 }, { type: "machine", id: 2 }),
                inserter(4, { type: "machine", id: 2 }, { type: "chest", id: 3 }),
            ],
        } as Config;
        expect(feasibilityOfConfig(config).issues).toEqual([]);
    });

    /**
     * Machines 1 and 2 make gears at 2 crafts a second each (crafting speed 1, half a second a craft); machine 1's go into
     * infinity chest 2, the target. Inserter 4 puts machine 2's into buffer chest 3, and inserter 5 moves them on into
     * buffer chest 4, which nothing empties: machine 2 stops for good once chest 4 is full, and machine 1 alone crafts 2
     * of the 3 a second that 3 gears a second need.
     */
    const chained = (more: Config["inserters"] = []): Config => ({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 3, copies: 1 },
        machines: [
            { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
            { id: 2, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
        ],
        belts: [belt(1, [lane("iron-plate", { lane_end: { kind: "infinite" } })])],
        chests: [
            infinityChest(2, ["iron-gear-wheel"]),
            { id: 3, type: "buffer-chest", storage_size: 1, item_filter: "iron-gear-wheel" },
            { id: 4, type: "buffer-chest", storage_size: 1, item_filter: "iron-gear-wheel" },
        ],
        inserters: [
            inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
            inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
            inserter(3, { type: "belt", id: 1 }, { type: "machine", id: 2 }),
            inserter(4, { type: "machine", id: 2 }, { type: "chest", id: 3 }),
            inserter(5, { type: "chest", id: 3 }, { type: "chest", id: 4 }),
            ...more,
        ],
    } as Config);

    it("through a chain of chests: names the chest it stops in, chest 4, not chest 3, which inserter 5 empties", () => {
        const { rules, issues, texts } = feasibilityOfConfig(chained());
        expect(rules).toEqual(["S1"]);
        expect(issues[0].nodes).toEqual(["machine:2", "chest:3#iron-gear-wheel", "chest:4#iron-gear-wheel"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 4 puts iron gear wheel from machine 2 into chest 3, inserter 5 moves it on into chest 4, and nothing takes it out of there: once chest 4 is full, the machine stops for good. The other machine 1 of the recipe crafts at most 2 a second, and the target needs 3."`);
    });

    it("round a loop of chests (inserter 6 moves the gears back into chest 3): both chests, and nothing else takes them out", () => {
        const { rules, texts } = feasibilityOfConfig(chained([inserter(6, { type: "chest", id: 4 }, { type: "chest", id: 3 })]));
        expect(rules).toEqual(["S1"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 4 puts iron gear wheel from machine 2 into chest 3, inserters 5 and 6 move it round between chests 3 and 4, and nothing else takes it out: once they are full, the machine stops for good. The other machine 1 of the recipe crafts at most 2 a second, and the target needs 3."`);
    });

    it("at 2 gears a second machine 1 alone is enough: it passes, machine 2 may stay idle", () => {
        const config = chained();
        config.setpoint.items_per_second = 2;
        expect(feasibilityOfConfig(config).issues).toEqual([]);
    });
});
