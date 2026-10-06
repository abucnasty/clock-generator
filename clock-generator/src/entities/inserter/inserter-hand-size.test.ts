import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { handSizeFor } from "./inserter";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

describe("handSizeFor", () => {
    const inserterOf = async (id: number) => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const registry = SimulationContext.fromConfig(config).entity_registry;
        const inserter = registry.getEntityByIdOrThrow(EntityId.forInserter(id));
        if (!Entity.isInserter(inserter)) {
            throw new Error(`${id} is not an inserter`);
        }
        return inserter;
    };

    it("is limited by what the item stacks to, and unloads early on a belt rather than leave a partial stack", async () => {
        // inserter 10 drops jellynut-seed (stacks to 10) on a belt lane that stacks to 4: 8 items, not 4, 4 and 2
        const seed_inserter = await inserterOf(10);
        expect(seed_inserter.metadata.stack_size).toBe(16);
        expect(handSizeFor(seed_inserter, "jellynut-seed")).toBe(8);
    });

    it("is the inserter's stack size for an item that stacks to more, dropped on a machine", async () => {
        // inserter 6 moves jelly (stacks to 100) from one machine to another
        const machine_inserter = await inserterOf(6);
        expect(handSizeFor(machine_inserter, "jelly")).toBe(16);
    });

    it("falls back to the inserter's stack size for an item it does not carry", async () => {
        const machine_inserter = await inserterOf(6);
        expect(handSizeFor(machine_inserter, "something-else")).toBe(16);
    });
});
