import { describe, expect, it } from "vitest";
import { EntityId, Machine, MachineSpec, RecipeMetadata } from "../../entities";
import { reasonText } from "../../control-logic/mode/reason-table";
import { MachineStatus } from "../../state/entity-status";
import { MachineState } from "../../state/machine-state";
import { CraftingStatus } from "../status-codes";
import { BurnerEnergy } from "./burner-energy";
import type { Crafting } from "./crafting";

const stateOf = (recipe: string, spec: Partial<MachineSpec> = {}) => MachineState.forMachine(Machine.createMachine(1, {
    crafting_speed: 1,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName(recipe),
    ...spec,
}));

/**
 * rocket-fuel-from-jelly in a biochamber (the gleba rocket fuel recordings): 30 jelly and 2 bioflux a craft, an output
 * block of 11 and a stack of 20, burning nutrients
 */
const rocketFuel = (parts: { rocket_fuel?: number; crafts?: number; nutrients?: number } = {}) => {
    const state = stateOf("rocket-fuel-from-jelly", { prototype: "biochamber", crafting_speed: 84.6655, productivity: 300 });
    state.inventoryState.addQuantity("rocket-fuel", parts.rocket_fuel ?? 0);
    state.inventoryState.addQuantity("jelly", 30 * (parts.crafts ?? 0));
    state.inventoryState.addQuantity("bioflux", 2 * (parts.crafts ?? 0));
    state.fuelInventory.addQuantity("nutrients", parts.nutrients ?? 0);
    return { state, crafting: state.crafting };
};

const STATUSES = [CraftingStatus.WORKING, CraftingStatus.ITEM_INGREDIENT_SHORTAGE, CraftingStatus.FULL_OUTPUT, CraftingStatus.NO_FUEL];

/** The status the rule gives from each status the machine may show: one answer, the same from all four */
const ruleFromEveryStatus = (crafting: Crafting): CraftingStatus[] => STATUSES.map(status => {
    crafting.status = status;
    return crafting.statusRule();
});

describe("Crafting: the status rule (same-tick rule 13)", () => {
    it("asks out of fuel first: a burner with nothing to burn is out of fuel whatever else stops it, or would not", () => {
        // a craft could start, and the output is at its block
        const { crafting } = rocketFuel({ rocket_fuel: 11, crafts: 1 });
        expect(ruleFromEveryStatus(crafting)).toEqual(STATUSES.map(() => CraftingStatus.NO_FUEL));
    });

    it("then whether a craft can go on: one that can start works, whatever its output holds", () => {
        const { crafting } = rocketFuel({ rocket_fuel: 12, crafts: 1, nutrients: 10 });
        expect(ruleFromEveryStatus(crafting)).toEqual(STATUSES.map(() => CraftingStatus.WORKING));
    });

    it("works on a craft underway with nothing left to start another, and spends what a burner holds before it is out of fuel", () => {
        const { state, crafting } = rocketFuel({ rocket_fuel: 12 });
        crafting.craftingProgress.progress = 0.5;
        (state.energy as BurnerEnergy).energy_buffer_mj = 1e-6;
        expect(ruleFromEveryStatus(crafting)).toEqual(STATUSES.map(() => CraftingStatus.WORKING));
    });

    it("then the output: full at its block, short of ingredients under it", () => {
        const { state, crafting } = rocketFuel({ rocket_fuel: 11, nutrients: 10 });
        expect(ruleFromEveryStatus(crafting)).toEqual(STATUSES.map(() => CraftingStatus.FULL_OUTPUT));
        state.inventoryState.setQuantity("rocket-fuel", 10);
        expect(ruleFromEveryStatus(crafting)).toEqual(STATUSES.map(() => CraftingStatus.ITEM_INGREDIENT_SHORTAGE));
    });
});

describe("Crafting: the reason of a change of status", () => {
    const reason = (crafting: Crafting, from: CraftingStatus, to: CraftingStatus, target: { entity_id: EntityId } | null = null) =>
        reasonText(crafting.reasonOf(from, to, target));

    it("gives the texts the histories have always recorded", () => {
        const { state, crafting } = rocketFuel({ rocket_fuel: 8, nutrients: 10 });
        const { WORKING, ITEM_INGREDIENT_SHORTAGE, FULL_OUTPUT, NO_FUEL } = CraftingStatus;
        for (const from of [WORKING, ITEM_INGREDIENT_SHORTAGE, FULL_OUTPUT]) {
            expect(reason(crafting, from, NO_FUEL)).toBe("machine has no fuel to burn");
        }
        expect(reason(crafting, ITEM_INGREDIENT_SHORTAGE, WORKING)).toBe("machine has enough inputs for craft");
        expect(reason(crafting, FULL_OUTPUT, WORKING)).toBe("machine has enough inputs and room for a craft");
        expect(reason(crafting, NO_FUEL, WORKING)).toBe("fuel arrived and the machine has enough inputs for craft");
        expect(reason(crafting, WORKING, ITEM_INGREDIENT_SHORTAGE)).toBe("not enough inputs for craft");
        expect(reason(crafting, NO_FUEL, ITEM_INGREDIENT_SHORTAGE)).toBe("fuel arrived but not enough inputs for craft");
        // leaving a full output: the output it dropped to, against its block
        expect(reason(crafting, FULL_OUTPUT, ITEM_INGREDIENT_SHORTAGE)).toBe('output "rocket-fuel" 8 < 11 and not enough inputs for craft');
        // a full output: why, as the Yield names it (Yield.outputFullText)
        state.inventoryState.setQuantity("rocket-fuel", 11);
        for (const from of [WORKING, ITEM_INGREDIENT_SHORTAGE, NO_FUEL]) {
            expect(reason(crafting, from, FULL_OUTPUT)).toBe('output item "rocket-fuel" = 11 is at its output block of 11');
        }
    });

    it("names the result target a stack waits for room in, for a machine that places its results itself", () => {
        const state = stateOf("processing-unit-recycling", { places_results: true });
        const crafting = state.crafting;
        state.inventoryState.addQuantity("advanced-circuit", 200);
        expect(crafting.statusRule()).toBe(CraftingStatus.FULL_OUTPUT);
        expect(reason(crafting, CraftingStatus.WORKING, CraftingStatus.FULL_OUTPUT, { entity_id: EntityId.forChest(3) }))
            .toBe("a stack of advanced-circuit waits in its output for room in chest:3");
    });
});

describe("Crafting: a working tick", () => {
    // iron gear wheels: 2 plates a craft, 30 ticks a craft at crafting speed 1
    it("starts a craft only with every ingredient it takes, taking them out and counting the start", () => {
        const state = stateOf("iron-gear-wheel");
        const crafting = state.crafting;
        state.inventoryState.addQuantity("iron-plate", 1);
        crafting.tick();
        expect([crafting.craftsStarted, crafting.craftingProgress.progress]).toEqual([0, 0]);
        state.inventoryState.addQuantity("iron-plate", 1);
        crafting.tick();
        expect(crafting.craftsStarted).toBe(1);
        expect(state.inventoryState.getQuantity("iron-plate")).toBe(0);
        expect(crafting.craftingProgress.progress).toBeCloseTo(1 / 30, 12);
    });

    it("finishes a craft into the output and counts it, the main product in its total", () => {
        const state = stateOf("iron-gear-wheel", { crafting_speed: 30 });
        const crafting = state.crafting;
        state.inventoryState.addQuantity("iron-plate", 4);
        crafting.tick();
        crafting.tick();
        expect([crafting.craftsStarted, crafting.craftCount, crafting.totalCrafted]).toEqual([2, 2, 2]);
        expect(state.inventoryState.getQuantity("iron-gear-wheel")).toBe(2);
        // a machine that does not place its results itself counts none placed
        expect(state.placement.results_placed).toBe(0);
    });
});

describe("MachineWakes", () => {
    it("writes after the machine's tick what its inserters go by in the next, and clears the decider (same-tick rules 1 and 3)", () => {
        const state = stateOf("iron-gear-wheel");
        const { crafting, wakes, ingress } = state;
        wakes.watchFrom(crafting);
        crafting.craftCount += 1;
        wakes.windowOpeningTakeDecider = 2;
        state.inventoryState.addQuantity("iron-gear-wheel", state.machine.output.outputBlock.ingredients_blocked_at);
        wakes.endOfTick(crafting, ingress);
        expect(wakes).toMatchObject({ finishedCraftInLastTick: true, startedCraftInLastTick: false, outputBlockedAfterLastTick: true,
            windowOpeningTakeDecider: null });

        crafting.craftsStarted += 1;
        state.inventoryState.setQuantity("iron-gear-wheel", 0);
        wakes.endOfTick(crafting, ingress);
        expect(wakes).toMatchObject({ finishedCraftInLastTick: false, startedCraftInLastTick: true, outputBlockedAfterLastTick: false });
        wakes.endOfTick(crafting, ingress);
        expect(wakes).toMatchObject({ finishedCraftInLastTick: false, startedCraftInLastTick: false });
    });

    it("counts the crafts from those the machine has when it starts watching", () => {
        const state = stateOf("iron-gear-wheel");
        state.crafting.craftCount = 3;
        state.crafting.craftsStarted = 4;
        state.wakes.watchFrom(state.crafting);
        state.wakes.endOfTick(state.crafting, state.ingress);
        expect([state.wakes.finishedCraftInLastTick, state.wakes.startedCraftInLastTick]).toEqual([false, false]);
    });
});

describe("Crafting and Wakes: what the machine's state keeps of them", () => {
    it("shows their fields to outside callers through the machine's state, the status by the name the histories record", () => {
        const state = stateOf("iron-gear-wheel");
        const { crafting, wakes } = state;
        expect(state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE);
        state.status = MachineStatus.OUTPUT_FULL;
        expect(crafting.status).toBe(CraftingStatus.FULL_OUTPUT);
        crafting.status = CraftingStatus.NO_FUEL;
        expect(state.status).toBe(MachineStatus.NO_FUEL);
        expect(state.craftingProgress).toBe(crafting.craftingProgress);
        state.craftCount = 2;
        state.craftsStarted = 3;
        state.totalCrafted = 4;
        expect([crafting.craftCount, crafting.craftsStarted, crafting.totalCrafted]).toEqual([2, 3, 4]);
        state.outputBlockedAfterLastTick = true;
        state.finishedCraftInLastTick = true;
        state.startedCraftInLastTick = true;
        state.windowOpeningTakeDecider = 5;
        expect(wakes).toMatchObject({ outputBlockedAfterLastTick: true, finishedCraftInLastTick: true, startedCraftInLastTick: true,
            windowOpeningTakeDecider: 5 });
    });

    it("is copied whole onto a snapshot, but the decider (a known quirk, kept)", () => {
        const state = stateOf("iron-gear-wheel");
        state.crafting.craftingProgress.progress = 0.25;
        Object.assign(state.crafting, { craftCount: 2, craftsStarted: 3, totalCrafted: 4, status: CraftingStatus.WORKING });
        Object.assign(state.wakes, { outputBlockedAfterLastTick: true, finishedCraftInLastTick: true, startedCraftInLastTick: true,
            windowOpeningTakeDecider: 1 });
        const cloned = MachineState.clone(state);
        expect(cloned.crafting).not.toBe(state.crafting);
        expect(cloned.crafting.craftingProgress).not.toBe(state.crafting.craftingProgress);
        expect([cloned.craftingProgress.progress, cloned.craftCount, cloned.craftsStarted, cloned.totalCrafted, cloned.status])
            .toEqual([0.25, 2, 3, 4, MachineStatus.WORKING]);
        expect(cloned.wakes).toMatchObject({ outputBlockedAfterLastTick: true, finishedCraftInLastTick: true, startedCraftInLastTick: true,
            windowOpeningTakeDecider: null });
        expect([cloned.storageKey(), cloned.crafting.key(), cloned.yield.key(), cloned.wakes.key(), cloned.energy.key()])
            .toEqual([state.storageKey(), state.crafting.key(), state.yield.key(), state.wakes.key(), state.energy.key()]);
    });

    // the fields that drive the next ticks, each in its component's key (P4 3.4); the running totals only grow, and the
    // decider is cleared after every tick of the machine, so they are left out. Every field of both, in the key or out of
    // it, is pinned with every component's (crafting/runner/steady-state.test.ts).
    it("keys the status as its code and the craft underway, and the Wakes their three flags; each field apart", () => {
        const state = stateOf("iron-gear-wheel", { crafting_speed: 15 });
        const { crafting, wakes } = state;
        const key = () => `${crafting.key()}|${wakes.key()}`;
        expect(key()).toBe(`${CraftingStatus.ITEM_INGREDIENT_SHORTAGE};0|false;false;false`);
        const keys = new Set([key()]);
        for (const status of STATUSES) {
            crafting.status = status;
            keys.add(key());
        }
        crafting.craftingProgress.progress = 0.5;
        keys.add(key());
        for (const flag of ["outputBlockedAfterLastTick", "finishedCraftInLastTick", "startedCraftInLastTick"] as const) {
            wakes[flag] = true;
            keys.add(key());
        }
        expect(keys.size).toBe(1 + 3 + 1 + 3);
        const before = key();
        Object.assign(crafting, { craftCount: 9, craftsStarted: 9, totalCrafted: 9 });
        wakes.windowOpeningTakeDecider = 2;
        expect(key()).toBe(before);
    });
});
