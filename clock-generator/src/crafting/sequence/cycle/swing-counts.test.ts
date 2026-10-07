import { describe, it, expect } from "vitest";
import { fraction } from "fractionability";
import { parseConfigFromObject } from "../../../config/config-browser";
import { Belt, Entity, EntityId, EntityRegistry, InserterFactory, Machine } from "../../../entities";
import { EntityTransferCountMap } from "./swing-counts";
import { loadConfigFromFile } from "../../../config/loader";
import { ConfigPaths } from "../../../config/config-paths";
import { SimulationContext } from "../simulation-context";

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

describe("EntityTransferCountMap.create through belts", () => {
    // belt 1 -> [1] cable machine -> [2] belt 2 -> [3] circuit machine -> [5] belt 3; belt 1 -> [4] circuit machine
    const configWithCableBelt = (cable_belt: object) => ({
        target_output: { recipe: "electronic-circuit", items_per_second: 10, copies: 1 },
        machines: [
            { id: 1, recipe: "copper-cable", productivity: 0, crafting_speed: 1, type: "machine" },
            { id: 2, recipe: "electronic-circuit", productivity: 0, crafting_speed: 1, type: "machine" },
        ],
        belts: [
            { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] },
            { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-cable", stack_size: 4 }], ...cable_belt },
            { id: 3, type: "turbo-transport-belt", lanes: [{ ingredient: "electronic-circuit", stack_size: 4 }] },
        ],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["copper-plate"] },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
            { id: 3, source: { type: "belt", id: 2 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
            { id: 4, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["iron-plate"] },
            { id: 5, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 3 }, stack_size: 16, filters: ["electronic-circuit"] },
        ],
    });

    const swingsForConfig = (config: unknown, cycle_ticks?: number) => {
        const registry = registryFor(config);
        const circuit_machine = registry.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "electronic-circuit")!;
        return EntityTransferCountMap.create([circuit_machine], registry, fraction(1), 16, cycle_ticks);
    };

    it("plans the inserters filling a belt for what is taken off it", () => {
        const swings = swingsForConfig(configWithCableBelt({}), 64);

        // 16 circuits need 48 cable off belt 2, made from 24 copper plates
        expect(swingsFor(swings, 3)).toBe(3);
        expect(swingsFor(swings, 2)).toBe(3);
        expect(swingsFor(swings, 1)).toBe(1.5);
    });

    it("adds the consumption of an export belt lane on top", () => {
        // 30 cable/s over a 64 tick cycle is 32 more cable, from 16 more copper plates
        const swings = swingsForConfig(configWithCableBelt({
            strategy: "export",
            lanes: [{ ingredient: "copper-cable", stack_size: 4, consumption_per_second: 30 }],
        }), 64);

        expect(swingsFor(swings, 3)).toBe(3);
        expect(swingsFor(swings, 2)).toBe(5);
        expect(swingsFor(swings, 1)).toBe(2.5);
    });
});

// Two nutrient biochambers [1], [2] each feed a pentapod egg biochamber [3], [4] through two inserters. The egg
// biochambers give each other the egg a craft starts from (inserters 5 and 8) and send the rest to the science
// biochamber [5] (inserters 9 and 10). Nothing fills a fuel slot alone: nutrients come with the ingredients.
describe("a build where two machines feed each other", async () => {
    const registry = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE)).entity_registry;
    const science_machine = registry.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "agricultural-science-pack")!;
    // 7 hands of science a cycle: 112 packs from 44.8 crafts at +150% productivity
    const swings = EntityTransferCountMap.create([science_machine], registry, fraction(7), 16);
    const transfers = (inserter_id: number) => Object.fromEntries(
        Array.from(swings.values()).find(it => it.entity.entity_id.id === EntityId.forInserter(inserter_id).id)!
            .item_transfers.map(it => [it.item_name, it.transfer_count.toString()]));

    it("splits the eggs of each egg machine between the science machine and the other egg machine", () => {
        // 44.8 eggs, half from each egg machine: 22.4 eggs are 7/5 of a hand
        expect(transfers(9)).toEqual({ "pentapod-egg": "7/5" });
        expect(transfers(10)).toEqual({ "pentapod-egg": "7/5" });
        // a craft makes 3.5 eggs and uses 1 of the other machine's: 22.4 / 2.5 = 8.96 crafts, 14/25 of a hand
        expect(transfers(5)).toEqual({ "pentapod-egg": "14/25" });
        expect(transfers(8)).toEqual({ "pentapod-egg": "14/25" });
    });

    it("rounds the fuel an inserter brings with its ingredient up to the fractions of a hand the ingredient comes in", () => {
        // 8.96 crafts take 268.8 nutrients, 42/5 of a hand on each of two inserters, and burn 5.8 more: 1/5 of a hand each
        expect(transfers(3)).toEqual({ nutrients: "43/5" });
        expect(transfers(6)).toEqual({ nutrients: "43/5" });
    });

    it("adds fuel as its own item to an inserter that takes it from another lane of its belt", () => {
        // 44.8 bioflux are 14/5 of a hand; the 7 nutrients the science machine burns are rounded up to 3/5
        expect(transfers(11)).toEqual({ bioflux: "14/5", nutrients: "3/5" });
    });

    it("has the nutrient machines make the fuel of the egg machines too", () => {
        // 2 x 43/5 hands are 275.2 nutrients, 100 per craft from 5 bioflux: 13.76 bioflux, rounded up from 21/25 of a hand
        expect(transfers(1)).toEqual({ bioflux: "22/25", nutrients: "2/25" });
    });
});

describe("an item needed at two levels of a chain", () => {
    it("is planned for each machine by what that machine uses", async () => {
        // the inserter machine takes 1 plate an inserter from two furnaces; the gear machine takes its own plates from two others
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING);
        const registry = SimulationContext.fromConfig(config).entity_registry;
        const inserter_machine = registry.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "inserter")!;
        const swings = EntityTransferCountMap.create([inserter_machine], registry, fraction(5), 16);
        const plates_into_inserter_machine = Array.from(swings.values())
            .filter(it => Entity.isInserter(it.entity) && it.entity.sink.entity_id.id === inserter_machine.entity_id.id)
            .filter(it => it.item_transfers.some(transfer => transfer.item_name === "iron-plate"))
            .map(it => it.total_transfer_count.toString());
        // 80 inserters take 80 plates: 5 hands over two inserters
        expect(plates_into_inserter_machine).toEqual(["5/2", "5/2"]);
    });
});
