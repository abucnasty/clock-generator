import { describe, expect, it } from "vitest";
import "./factorio-data-file";
import { FactorioDataService } from "./factorio-data-service";
import { BeltSpeed } from "../entities/belt/belt";
import { fullHandOf } from "../entities/traits/hand";
import { modelledBurnerOf } from "../entities/traits/energy";

/** What the engine burned before it read the burner from the data (its burner table): nutrients of 2 MJ, at 500 kW */
const NUTRIENTS = { item_name: "nutrients", fuel_value_mj: 2 };
const BIOCHAMBER_KW = 500;
const NUTRIENTS_FUEL_CATEGORY = "nutrients";

const SI_PREFIX: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** Energy as the game writes it ("500kW", "2MJ"), in watts or joules */
function energy(text: string | undefined, unit: "W" | "J"): number {
    const match = /^(\d+(?:\.\d+)?)([kMGT]?)([WJ])$/.exec(text ?? "");
    expect(match, `${text} is energy in ${unit}`).not.toBeNull();
    expect(match![3]).toBe(unit);
    return Number(match![1]) * SI_PREFIX[match![2]];
}

/**
 * The game data's fields hold what the engine's constants said before it read them in their place (the burner table, the
 * belt speed switch, the full-hand rule by name), so that reading them moved nothing
 */
describe("the game data and the engine's constants", () => {
    it("gives the biochamber the burner it was fuelled with first: 500 kW on nutrients", () => {
        const biochamber = FactorioDataService.findCraftingMachine("biochamber")!;
        const source = modelledBurnerOf(biochamber)!;
        expect(energy(biochamber.energy_usage, "W") / 1000).toBe(BIOCHAMBER_KW);
        expect(source.energy_usage_kw).toBe(BIOCHAMBER_KW);
        expect(biochamber.energy_source.type).toBe("burner");
        expect(biochamber.energy_source.type === "burner" && biochamber.energy_source.fuel_categories).toEqual([NUTRIENTS_FUEL_CATEGORY]);
        expect(source.fuels).toEqual([NUTRIENTS]);
    });

    it("gives nutrients the fuel value the engine burns: 2 MJ", () => {
        const nutrients = FactorioDataService.itemPrototypeFields(NUTRIENTS.item_name);
        expect(energy(nutrients.fuel_value, "J") / 1e6).toBe(NUTRIENTS.fuel_value_mj);
        expect(NUTRIENTS.fuel_value_mj).toBe(2);
        expect(nutrients.fuel_categories).toEqual([NUTRIENTS_FUEL_CATEGORY]);
    });

    it.each([
        ["transport-belt", BeltSpeed.TRANSPORT_BELT],
        ["fast-transport-belt", BeltSpeed.FAST_TRANSPORT_BELT],
        ["express-transport-belt", BeltSpeed.EXPRESS_TRANSPORT_BELT],
        ["turbo-transport-belt", BeltSpeed.TURBO_TRANSPORT_BELT],
    ])("gives %s the engine's speed: tiles per tick x 480 is %i items a second", (name, speed) => {
        // 60 ticks a second, 8 items a tile (4 on each lane)
        expect(FactorioDataService.findTransportBeltOrThrow(name).speed * 480).toBe(speed);
    });

    // The engine's full-hand rule follows `bulk` today (the Hand trait's fullHandOf: a bulk inserter waits for a full hand
    // at a machine that places its results itself), not `wait_for_full_hand`, which the bulk inserter does not set
    // (decision 9e is open); the cases below tie the data's `bulk` to that rule and record the data's full-hand fields beside it.
    it("gives the stack inserter a full hand to wait for, matched to belt stacks of up to 4, and the bulk inserter a bulk hand only", () => {
        const stack = FactorioDataService.findInserterOrThrow("stack-inserter");
        expect(stack.wait_for_full_hand).toBe(true);
        expect(stack.max_belt_stack_size).toBe(4);
        expect(stack.grab_less_to_match_belt_stack).toBe(true);
        expect(stack.bulk).toBe(true);
        const bulk = FactorioDataService.findInserterOrThrow("bulk-inserter");
        expect(bulk.bulk).toBe(true);
        expect(bulk.wait_for_full_hand ?? false).toBe(false);
        expect(fullHandOf(stack.name).at_placing_source).toBe(true);
        expect(fullHandOf(bulk.name).at_placing_source).toBe(true);
    });

    it("makes no other inserter a bulk one", () => {
        const others = FactorioDataService.getAllInserters().filter(inserter => !["stack-inserter", "bulk-inserter"].includes(inserter.name));
        expect(others.map(inserter => inserter.name).sort()).toEqual(["burner-inserter", "fast-inserter", "inserter", "long-handed-inserter"]);
        for (const inserter of others) {
            expect(inserter.bulk ?? false, inserter.name).toBe(false);
            expect(fullHandOf(inserter.name).at_placing_source, inserter.name).toBe(false);
        }
    });

    it("gives only the burner inserter an energy source that burns fuel, which the engine refuses", () => {
        const burners = FactorioDataService.getAllInserters().filter(inserter => inserter.energy_source.type === "burner");
        expect(burners.map(inserter => inserter.name)).toEqual(["burner-inserter"]);
    });
});
