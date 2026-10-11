import { describe, expect, it } from "vitest";
import { BurnerEnergySource } from "./energy-source";
import { FuelSlot } from "./fuel-slot";
import { FuelConsumption } from "../traits/fuel-consumption";

describe("the fuel slot's insertion limit", () => {
    const limitAt = (energy_consumption_bonus: number): number => {
        const source = BurnerEnergySource.forMachineType("biochamber")!;
        const fuel = BurnerEnergySource.selectFuel(source);
        // the crafting speed and recipe time do not matter to it
        return FuelSlot.create(fuel, FuelConsumption.fromCraftingSpeed(source, fuel, 50, 1, energy_consumption_bonus)).automated_insertion_limit;
    };

    // the lowest count an always enabled inserter let the slot of a biochamber fall to, in Factorio 2.1
    it.each([
        [495, 5], [620, 6], [670, 7], [814.97, 8], [926.17, 9], [1020, 9],
        [1102.6, 10], [1177.22, 11], [1309.8, 12], [1369.9, 12], [1426.7, 13],
    ])("is what a biochamber at +%f%% energy consumption was topped up to in game: %i", (bonus, limit) => {
        expect(limitAt(bonus)).toBe(limit);
    });

    it("is 5 for a machine that burns little", () => {
        expect(limitAt(0)).toBe(5);
        expect(limitAt(-80)).toBe(5);
        expect(limitAt(400)).toBe(5);
    });

    // 180 energy buffers of 16/15 ticks are 192 ticks: 0.8 nutrients for each time the base 500 kW
    it("goes up an item with every 125% of energy consumption", () => {
        expect(limitAt(650)).toBe(6);
        expect(limitAt(650.5)).toBe(7);
        expect(limitAt(775)).toBe(7);
        expect(limitAt(775.5)).toBe(8);
    });
});
