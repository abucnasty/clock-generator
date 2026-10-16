import { describe, expect, it } from "vitest";
import type { Config } from "../../config/schema";
import { FactorioDataService } from "../../data";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";

FactorioDataService.findRecipeOrThrow("iron-gear-wheel");

/** A machine making gears with one inserter taking `filters` off it onto the sink */
const inserterWithFilters = (filters: string[], sink: { type: "belt" } | { type: "chest" } | { type: "machine" }) => {
    const config = {
        target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [
            { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
            ...(sink.type === "machine" ? [{ id: 2, recipe: "transport-belt", productivity: 0, crafting_speed: 1 }] : []),
        ],
        inserters: [{ id: 1, source: { type: "machine", id: 1 }, sink: { type: sink.type, id: sink.type === "machine" ? 2 : 1 }, stack_size: 4, filters }],
        belts: sink.type === "belt" ? [{ id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }] }] : [],
        chests: sink.type === "chest" ? [{ type: "buffer-chest", id: 1, storage_size: 100, item_filter: "iron-gear-wheel" }] : [],
    } as unknown as Config;
    const inserter = SimulationContext.fromConfig(config).entity_registry.getEntityByIdOrThrow(EntityId.forInserter(1));
    if (!Entity.isInserter(inserter)) {
        throw new Error("not an inserter");
    }
    return inserter;
};

describe("an inserter's filters", () => {
    it("may name an item the source does not make when the sink is a belt, such as the spoilage cleared off a machine", () => {
        // atlan's cell 18: a filtered inserter takes spoilage out of a machine onto a belt; no recipe lists spoilage
        expect([...inserterWithFilters(["spoilage"], { type: "belt" }).filtered_items]).toEqual(["spoilage"]);
    });

    it("may name such an item when the sink is a chest", () => {
        expect([...inserterWithFilters(["spoilage"], { type: "chest" }).filtered_items]).toEqual(["spoilage"]);
    });

    it("must name an ingredient or fuel of the machine it puts into", () => {
        expect(() => inserterWithFilters(["spoilage"], { type: "machine" })).toThrow("Inserter filter spoilage is not a valid item for sink entity 2 of type machine");
        expect([...inserterWithFilters(["iron-gear-wheel"], { type: "machine" }).filtered_items]).toEqual(["iron-gear-wheel"]);
    });
});
