import { describe, expect, it } from "vitest";
import { encodeBlueprintFile } from "../blueprints/serde";
import { clockInserterIds, matchBuiltInserters } from "./factorio-harness";

describe("clockInserterIds", () => {
    it("reads the inserter ids the schedule combinators name", () => {
        const blueprint = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { player_description: "Clock for [item=agricultural-science-pack]:\n- Cycle Count: 25 cycles" },
                    { player_description: "Inserters 3, 4, 6, 7 for [item=nutrients] into [recipe=pentapod-egg]\nSwing Counts:" },
                    { player_description: "Inserter 12 for [item=agricultural-science-pack]" },
                    { player_description: "Subtick clock, step 1 of 2" },
                    {},
                ],
            },
        } as any);
        expect(clockInserterIds(blueprint)).toEqual([3, 4, 6, 7, 12]);
    });
});

describe("matchBuiltInserters", () => {
    it("finds the unit number of each config inserter in a build the recorder numbered differently", () => {
        const config = {
            machines: [{ id: 1, recipe: "iron-gear-wheel" }, { id: 2, recipe: "electronic-circuit" }],
            inserters: [
                { id: 1, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 } },
                { id: 2, source: { type: "machine", id: 2 }, sink: { type: "chest", id: 1 } },
            ],
            belts: [],
        } as any;
        // what the mod's harness_describe answers; Lua writes the empty belt list as {}
        const described = {
            config: {
                inserters: [
                    { source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 } },
                    { source: { type: "machine", id: 2 }, sink: { type: "machine", id: 1 } },
                ],
                belts: {},
            },
            machines: [
                { id: 1, unit_number: 50, name: "assembling-machine-3", recipe: "electronic-circuit" },
                { id: 2, unit_number: 51, name: "assembling-machine-3", recipe: "iron-gear-wheel" },
            ],
            inserters: [
                { id: 1, unit_number: 70, name: "inserter", source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 1 },
                { id: 2, unit_number: 71, name: "inserter", source: { type: "machine", id: 2 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
            ],
        };
        expect(matchBuiltInserters(described, config)).toEqual(new Map([[1, 71], [2, 70]]));
    });
});
