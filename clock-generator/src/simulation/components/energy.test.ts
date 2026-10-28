import { describe, expect, it } from "vitest";
import { Machine, RecipeMetadata } from "../../entities";
import { ENERGY_BUFFER_TICKS } from "../../entities/machine/fuel/fuel-slot";
import { InventoryState } from "../../state/inventory-state";
import { BurnerEnergy } from "./burner-energy";
import { ElectricEnergy } from "./electric-energy";
import { Energy, EnergyUser } from "./energy";

// a 4 s recipe at crafting speed 2: 120 ticks a craft and 1 MJ a craft, so a tick of work takes 1/120 MJ; a nutrient is 2 MJ
const biochamber = () => Machine.createMachine(1, {
    crafting_speed: 2,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName("nutrients-from-yumako-mash"),
    prototype: "biochamber",
});
const PER_TICK = 1 / 120;

const burner = (nutrients: number) => {
    const fuel = InventoryState.empty();
    fuel.addQuantity("nutrients", nutrients);
    const energy = Energy.of(biochamber(), fuel);
    expect(energy).toBeInstanceOf(BurnerEnergy);
    return { energy: energy as BurnerEnergy, fuel };
};

/** What the crafting answers, set by each test; counts the asks */
const crafting = (answers: { in_progress?: boolean; keeps_working?: boolean } = {}) => {
    const user = {
        in_progress: answers.in_progress ?? false,
        keeps_working: answers.keeps_working ?? true,
        asked: 0,
        craftInProgress() { user.asked += 1; return user.in_progress; },
        keepsWorking() { user.asked += 1; return user.keeps_working; },
    };
    return user satisfies EnergyUser;
};

describe("Energy.of", () => {
    it("gives a machine with a fuel slot a burner and any other machine electric energy", () => {
        expect(Energy.of(biochamber(), InventoryState.empty())).toBeInstanceOf(BurnerEnergy);
        const assembler = Machine.createMachine(2, { crafting_speed: 1, productivity: 0, recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel") });
        expect(Energy.of(assembler, InventoryState.empty())).toBeInstanceOf(ElectricEnergy);
    });

    it("works out a burner's energy for a tick of work from its fuel slot and crafting speed", () => {
        const { energy } = burner(0);
        energy.energy_buffer_mj = PER_TICK / 2;
        expect(energy.poweredShare()).toBeCloseTo(0.5, 12);
    });
});

describe("ElectricEnergy", () => {
    it("powers every tick fully, is never out of fuel and asks the crafting nothing", () => {
        const energy = new ElectricEnergy();
        const user = crafting();
        expect(energy.poweredShare()).toBe(1);
        expect(energy.hasFuel()).toBe(true);
        expect(energy.outOfFuel(user)).toBe(false);
        energy.spend(true, user);
        expect(user.asked).toBe(0);
    });

    it("fills the key's slot as a burner holding nothing, and its copy is itself", () => {
        const energy = new ElectricEnergy();
        expect(energy.stateKey()).toBe("0;0");
        expect(energy.clone(InventoryState.empty())).toBe(energy);
    });
});

describe("BurnerEnergy", () => {
    it("pays for the part of a tick's work its buffer holds, at most all of it", () => {
        const { energy } = burner(1);
        expect(energy.poweredShare()).toBe(0);
        energy.energy_buffer_mj = PER_TICK / 15;
        expect(energy.poweredShare()).toBeCloseTo(1 / 15, 12);
        energy.energy_buffer_mj = PER_TICK * ENERGY_BUFFER_TICKS;
        expect(energy.poweredShare()).toBe(1);
    });

    it("has fuel while it holds energy, burns an item or has one in its slot", () => {
        const { energy, fuel } = burner(0);
        expect(energy.hasFuel()).toBe(false);
        fuel.addQuantity("nutrients", 1);
        expect(energy.hasFuel()).toBe(true);
        fuel.setQuantity("nutrients", 0);
        energy.energy_remaining_mj = 0.5;
        expect(energy.hasFuel()).toBe(true);
        energy.energy_remaining_mj = 0;
        energy.energy_buffer_mj = PER_TICK / 15;
        expect(energy.hasFuel()).toBe(true);
    });

    it("a machine that holds no energy takes it from its fuel first, lighting an item, and works from the next tick", () => {
        const { energy, fuel } = burner(2);
        energy.spend(false, crafting());
        expect(fuel.getQuantity("nutrients")).toBe(1);
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK * ENERGY_BUFFER_TICKS, 12);
        expect(energy.energy_remaining_mj).toBeCloseTo(2 - PER_TICK * ENERGY_BUFFER_TICKS, 12);
        expect(energy.poweredShare()).toBe(1);
    });

    it("a tick of work draws a tick of energy, and the fuel tops the buffer up while the machine keeps working", () => {
        const { energy } = burner(1);
        energy.spend(false, crafting());
        const remaining = energy.energy_remaining_mj;
        energy.spend(true, crafting());
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK * ENERGY_BUFFER_TICKS, 12);
        expect(energy.energy_remaining_mj).toBeCloseTo(remaining - PER_TICK, 12);
    });

    it("keeps 1/15 of a tick of energy when it stops, and burns nothing for it (same-tick rule 15)", () => {
        const { energy, fuel } = burner(1);
        energy.spend(false, crafting());
        const remaining = energy.energy_remaining_mj;
        energy.spend(true, crafting({ keeps_working: false }));
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK / 15, 12);
        expect(energy.energy_remaining_mj).toBe(remaining);
        expect(fuel.getQuantity("nutrients")).toBe(0);
        // the tick it starts again makes 1/15 of a tick's progress, and its top-up burns 16/15 of a tick's fuel
        expect(energy.poweredShare()).toBeCloseTo(1 / 15, 12);
        energy.spend(true, crafting());
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK * ENERGY_BUFFER_TICKS, 12);
        expect(energy.energy_remaining_mj).toBeCloseTo(remaining - PER_TICK * ENERGY_BUFFER_TICKS, 12);
    });

    it("lights the next item when the burning one runs out within a tick", () => {
        const { energy, fuel } = burner(1);
        energy.energy_remaining_mj = PER_TICK / 3;
        energy.spend(false, crafting());
        expect(fuel.getQuantity("nutrients")).toBe(0);
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK * ENERGY_BUFFER_TICKS, 12);
        expect(energy.energy_remaining_mj).toBeCloseTo(2 + PER_TICK / 3 - PER_TICK * ENERGY_BUFFER_TICKS, 12);
    });

    it("burns what is left when its fuel holds less than the top-up", () => {
        const { energy } = burner(0);
        energy.energy_remaining_mj = PER_TICK / 3;
        energy.spend(false, crafting());
        expect(energy.energy_buffer_mj).toBeCloseTo(PER_TICK / 3, 12);
        expect(energy.energy_remaining_mj).toBeCloseTo(0, 12);
    });

    it("is out of fuel with nothing to burn and less than a tick of work held, unless a craft underway can spend what is left", () => {
        const { energy, fuel } = burner(0);
        expect(energy.outOfFuel(crafting())).toBe(true);
        energy.energy_buffer_mj = PER_TICK / 15;
        expect(energy.outOfFuel(crafting())).toBe(true);
        expect(energy.outOfFuel(crafting({ in_progress: true }))).toBe(false);
        energy.energy_buffer_mj = PER_TICK;
        expect(energy.outOfFuel(crafting())).toBe(false);
        energy.energy_buffer_mj = 0;
        fuel.addQuantity("nutrients", 1);
        // with fuel to burn it never asks about the craft
        const user = crafting();
        expect(energy.outOfFuel(user)).toBe(false);
        expect(user.asked).toBe(0);
    });

    it("keys what it holds, each field apart", () => {
        const { energy } = burner(0);
        expect(energy.stateKey()).toBe("0;0");
        const keys = new Set([energy.stateKey()]);
        for (const field of ["energy_remaining_mj", "energy_buffer_mj"] as const) {
            energy[field] = 0.25;
            keys.add(energy.stateKey());
            energy[field] = 0;
        }
        expect(keys.size).toBe(3);
        // every plain field it owns is in the key above, but the energy a tick of work takes, the build's in every tick
        const plain = Object.entries(energy).filter(([, value]) => typeof value !== "object").map(([key]) => key);
        expect(plain.sort()).toEqual(["energy_buffer_mj", "energy_per_tick", "energy_remaining_mj"]);
    });

    it("copies what it holds onto the copy of the fuel inventory", () => {
        const { energy, fuel } = burner(2);
        energy.spend(false, crafting());
        const fuel_copy = fuel.clone();
        const copy = energy.clone(fuel_copy);
        expect(copy.stateKey()).toBe(energy.stateKey());
        // the copy lights its next item from its own fuel inventory
        copy.energy_remaining_mj = PER_TICK / 3;
        copy.spend(true, crafting());
        expect(fuel_copy.getQuantity("nutrients")).toBe(0);
        expect(fuel.getQuantity("nutrients")).toBe(1);
        expect(energy.energy_remaining_mj).toBeCloseTo(2 - PER_TICK * ENERGY_BUFFER_TICKS, 12);
    });
});
