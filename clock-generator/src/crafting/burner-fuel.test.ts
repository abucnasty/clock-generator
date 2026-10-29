import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../config";
import { generateClockForConfig } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

/** A steel furnace on iron plates: ore from one belt, coal from another, the plates out on a third */
const furnaceBuild = (prototype: string) => ConfigSchema.parse({
    target_output: { recipe: "iron-plate", items_per_second: 0.3, copies: 1 },
    machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 2, prototype, fuel: "coal" }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 1 },
        { id: 3, source: { type: "belt", id: 3 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
    ],
    belts: [
        { id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-ore", stack_size: 1 }] },
        { id: 2, type: "transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 1 }] },
        { id: 3, type: "transport-belt", lanes: [{ ingredient: "coal", stack_size: 1 }] },
    ],
});

// Every burner is fuelled from its energy source, so a build with a furnace on coal needs the fuel inserter its clock times
describe("a build with a burner furnace", () => {
    it("is clocked with the fuel inserter timed as a biochamber's is: the furnace burns the coal it is brought", () => {
        const result = generateClockForConfig(furnaceBuild("steel-furnace"), { logger: quiet, verify_as_built: true });
        expect(result.schedule).toBeDefined();
        expect(Object.keys(result.unplanned_inserter_clocks ?? {})).toEqual(["inserter:3"]);
    });
});
