import { describe, it, expect } from "vitest";
import { fraction } from "fractionability";
import { parseConfigFromObject } from "../../../config/config-browser";
import { Belt, Entity, EntityId, EntityRegistry, InserterFactory, Machine } from "../../../entities";
import { EntityTransferCountMap } from "./swing-counts";

function registryFor(config: unknown): EntityRegistry {
    const parsed = parseConfigFromObject(config);
    const registry = new EntityRegistry();
    const inserters = new InserterFactory(registry);
    parsed.belts.forEach(belt => registry.add(Belt.fromConfig(belt)));
    parsed.machines.forEach(machine => registry.add(Machine.fromConfig(machine)));
    parsed.inserters.forEach((inserter, index) => registry.add(inserters.fromConfig(inserter.id ?? index + 1, inserter)));
    return registry;
}

function swingsFor(map: EntityTransferCountMap, inserter_id: number): number {
    const id = EntityId.forInserter(inserter_id).id;
    return Array.from(map.values()).find(it => it.entity.entity_id.id === id)!.total_transfer_count.toDecimal();
}

describe("EntityTransferCountMap.create", () => {
    // belt -> [1] cable machine -> [2], [3] -> circuit machine -> [5] belt; belt -> [4] circuit machine
    const config = {
        target_output: { recipe: "electronic-circuit", items_per_second: 10, copies: 1 },
        machines: [
            { id: 1, recipe: "copper-cable", productivity: 0, crafting_speed: 1, type: "machine" },
            { id: 2, recipe: "electronic-circuit", productivity: 0, crafting_speed: 1, type: "machine" },
        ],
        belts: [
            { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] },
            { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "electronic-circuit", stack_size: 4 }] },
        ],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["copper-plate"] },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
            { id: 3, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
            { id: 4, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["iron-plate"] },
            { id: 5, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters: ["electronic-circuit"] },
        ],
    };

    it("feeds a machine for every inserter path that pulls from it", () => {
        const registry = registryFor(config);
        const circuit_machine = registry.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "electronic-circuit")!;

        const swings = EntityTransferCountMap.create([circuit_machine], registry, fraction(1), 16);

        // 16 circuits need 48 cable, split over two inserters, made from 24 copper plates
        expect(swingsFor(swings, 5)).toBe(1);
        expect(swingsFor(swings, 2)).toBe(1.5);
        expect(swingsFor(swings, 3)).toBe(1.5);
        expect(swingsFor(swings, 4)).toBe(1);
        expect(swingsFor(swings, 1)).toBe(1.5);
    });
});
