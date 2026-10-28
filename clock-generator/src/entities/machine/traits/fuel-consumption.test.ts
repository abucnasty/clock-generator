import { describe, expect, it } from "vitest";
import { FuelConsumption } from "./fuel-consumption";
import { BurnerEnergySource, Fuel } from "../fuel";
import { FactorioDataService } from "../../../data";
import { modelledBurnerOf } from "../../traits/energy";

/** The biochamber's burner as the engine burned it before it was read from the data: 500 kW on 2 MJ nutrients */
const NUTRIENTS: Fuel = { item_name: "nutrients", fuel_value_mj: 2 };
const biochamber: BurnerEnergySource = { energy_usage_kw: 500, effectivity: 1, fuels: [NUTRIENTS] };

describe("FuelConsumption", () => {
    it("burns 0.25 nutrients/s at 500kW with 2MJ nutrients", () => {
        const c = FuelConsumption.fromCraftingSpeed(biochamber, NUTRIENTS, 2, 4);
        expect(c.item).toBe("nutrients");
        expect(c.rate_per_second).toBeCloseTo(0.25);
        expect(c.rate_per_tick).toBeCloseTo(0.25 / 60);
        // 4s recipe at speed 2 = 2s per craft
        expect(c.amount_per_craft).toBeCloseTo(0.5);
    });

    it("scales with the energy consumption bonus", () => {
        const c = FuelConsumption.fromCraftingSpeed(biochamber, NUTRIENTS, 2, 4, 50);
        expect(c.rate_per_second).toBeCloseTo(0.375);
    });

    it("clamps the consumption bonus at -80%", () => {
        const c = FuelConsumption.fromCraftingSpeed(biochamber, NUTRIENTS, 2, 4, -95);
        expect(c.rate_per_second).toBeCloseTo(0.05);
    });

    it("handles decimal crafting speeds and consumption bonuses", () => {
        const c = FuelConsumption.fromCraftingSpeed(biochamber, NUTRIENTS, 56.122, 1, 926.17);
        expect(c.rate_per_second).toBeCloseTo(0.25 * 10.2617);
        expect(c.amount_per_craft).toBeCloseTo(0.25 * 10.2617 / 56.122);
    });

    it("burns the usage over the effectivity in fuel: half the effectivity, twice the fuel (unrecorded: 1 on every burner of 2.1.21)", () => {
        const half = FuelConsumption.fromCraftingSpeed({ ...biochamber, effectivity: 0.5 }, NUTRIENTS, 2, 4);
        expect(half.rate_per_second).toBeCloseTo(0.5);
        expect(half.amount_per_craft).toBeCloseTo(1);
    });

    it("works for any energy source and fuel", () => {
        const c = FuelConsumption.fromCraftingSpeed(
            { energy_usage_kw: 90, effectivity: 1, fuels: [{ item_name: "coal", fuel_value_mj: 4 }] },
            { item_name: "coal", fuel_value_mj: 4 },
            1,
            1,
        );
        expect(c.item).toBe("coal");
        expect(c.rate_per_second).toBeCloseTo(0.0225);
    });
});

describe("BurnerEnergySource", () => {
    const burnerOf = (name: string) => modelledBurnerOf(FactorioDataService.findCraftingMachine(name));

    it("is the biochamber's from the data: 500 kW on nutrients of 2 MJ", () => {
        expect(burnerOf("biochamber")).toEqual(biochamber);
    });

    it("is every burner's: the biochamber, the captive biter spawner and the stone and steel furnaces; electric machines have none", () => {
        for (const name of ["assembling-machine-3", "electric-furnace", "recycler"]) {
            expect(burnerOf(name), name).toBeUndefined();
        }
        expect(modelledBurnerOf(null)).toBeUndefined();
        const burning = FactorioDataService.getAllCraftingMachines().filter(machine => modelledBurnerOf(machine) !== undefined);
        expect(burning.map(machine => machine.name).sort()).toEqual(["biochamber", "captive-biter-spawner", "steel-furnace", "stone-furnace"]);
    });

    it("takes each burner's usage and the items of its fuel categories from the data", () => {
        expect(burnerOf("stone-furnace")).toMatchObject({ energy_usage_kw: 90, effectivity: 1 });
        expect(burnerOf("steel-furnace")).toMatchObject({ energy_usage_kw: 90, effectivity: 1 });
        expect(burnerOf("captive-biter-spawner")).toMatchObject({ energy_usage_kw: 100, effectivity: 1, fuels: [{ item_name: "bioflux", fuel_value_mj: 6 }] });
        const chemical = burnerOf("stone-furnace")!.fuels.map(fuel => fuel.item_name);
        expect(chemical).toEqual(expect.arrayContaining(["coal", "wood", "solid-fuel", "rocket-fuel"]));
        expect(chemical).not.toContain("nutrients");
    });

    it("defaults to the first fuel and rejects fuels the source does not accept", () => {
        expect(BurnerEnergySource.selectFuel(biochamber)).toBe(NUTRIENTS);
        expect(BurnerEnergySource.selectFuel(biochamber, "nutrients")).toBe(NUTRIENTS);
        expect(() => BurnerEnergySource.selectFuel(biochamber, "coal")).toThrow("Unsupported fuel coal; accepted fuels: nutrients");
    });
});
