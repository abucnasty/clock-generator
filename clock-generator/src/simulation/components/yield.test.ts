import { describe, expect, it } from "vitest";
import { EntityId, Machine, RecipeMetadata } from "../../entities";
import { MachineState } from "../../state/machine-state";
import { OutputFullCode, YieldUser } from "./yield";

const machineOf = (recipe: string, productivity: number, places_results = false) => Machine.createMachine(1, {
    crafting_speed: 1,
    productivity,
    recipe: RecipeMetadata.fromRecipeName(recipe),
    ...(places_results ? { places_results: true } : {}),
});

/** A machine's state and its Yield, built as the simulation builds them */
const yieldOf = (recipe: string, productivity: number, places_results = false) => {
    const state = MachineState.forMachine(machineOf(recipe, productivity, places_results));
    return { state, made: state.yield, inventory: state.inventoryState };
};

/** What the crafting is told, counted */
const crafting = () => {
    const user = {
        crafted: 0,
        placed: 0,
        countCrafted(amount: number) { user.crafted += amount; },
        countPlacedInOutput(amount: number) { user.placed += amount; },
    };
    return user satisfies YieldUser;
};

describe("Yield: the productivity bar (same-tick rule 14)", () => {
    // iron gear wheels at 50% productivity: a craft fills half the bar, a full bar pays a gear
    it("pays a full bar at the next release or after a finished craft, never on the tick it fills", () => {
        const { made, inventory } = yieldOf("iron-gear-wheel", 50);
        const user = crafting();
        made.advanceBonus(1);
        made.finishCraft(user);
        expect(made.bonusProgress.progress).toBe(0.5);
        expect(inventory.getQuantity("iron-gear-wheel")).toBe(1);
        expect(made.productsFinished).toBe(1);

        // the second craft's progress fills the bar: nothing is paid until the craft finishes
        made.advanceBonus(1);
        expect(made.bonusProgress.progress).toBe(1);
        expect(made.productsFinished).toBe(1);
        made.finishCraft(user);
        expect(made.bonusProgress.progress).toBe(0);
        expect(inventory.getQuantity("iron-gear-wheel")).toBe(3);
        expect(made.productsFinished).toBe(3);
        expect(user.crafted).toBe(3);

        // a bar filled by a craft that has not finished pays at the start of the next working tick
        made.advanceBonus(1);
        made.advanceBonus(1);
        expect(made.productsFinished).toBe(3);
        made.release(user);
        expect(made.productsFinished).toBe(4);
        expect(inventory.getQuantity("iron-gear-wheel")).toBe(4);
    });

    it("pays several full bars at once, productivity above 300% uncapped", () => {
        const { made, inventory } = yieldOf("iron-gear-wheel", 450);
        const user = crafting();
        made.advanceBonus(1);
        expect(made.bonusProgress.progress).toBeCloseTo(4.5, 12);
        made.release(user);
        expect(made.productsFinished).toBe(4);
        expect(inventory.getQuantity("iron-gear-wheel")).toBe(4);
        expect(made.bonusProgress.progress).toBeCloseTo(0.5, 12);
    });

    it("leaves the bar alone where the machine has no productivity", () => {
        const { made } = yieldOf("iron-gear-wheel", 0);
        made.advanceBonus(1);
        expect(made.bonusProgress.progress).toBe(0);
    });
});

describe("Yield: products held until the output has room", () => {
    // plastic bars: 2 a craft under a stack of 100
    it("holds a craft's products that do not fit, and puts them in once there is room", () => {
        const { made, inventory } = yieldOf("plastic-bar", 0);
        const user = crafting();
        inventory.addQuantity("plastic-bar", 99);
        made.finishCraft(user);
        expect(made.pendingOutput).toBe(2);
        expect(made.holdsProducts()).toBe(true);
        expect(made.roomForNextCraft()).toBe(false);
        expect(made.productsFinished).toBe(1);

        inventory.setQuantity("plastic-bar", 89);
        made.putHeldProductsInOutput(user);
        expect(made.pendingOutput).toBe(0);
        expect(inventory.getQuantity("plastic-bar")).toBe(91);
        expect(user.crafted).toBe(2);
        // a machine that does not place its results itself counts none placed; its Crafting and Placement decide that
        expect(user.placed).toBe(2);
    });
});

describe("Yield: results by chance and their carry", () => {
    // uranium processing: the main product (238) and the by-product (235) both come by chance
    it("makes a result by chance at its expected amount, carrying the fraction to the next craft", () => {
        const { made, inventory } = yieldOf("uranium-processing", 0);
        const user = crafting();
        expect(made.carryKey()).toBe("[]");
        made.finishCraft(user);
        // 0.993 of a 238 and 0.007 of a 235: no whole item of either yet
        expect(made.pendingOutput).toBe(0);
        expect(inventory.getQuantity("uranium-238")).toBe(0);
        expect(inventory.getQuantity("uranium-235")).toBe(0);
        made.finishCraft(user);
        expect(inventory.getQuantity("uranium-238")).toBe(1);

        // the key lists every carried result by name, as the map of carries it replaces did
        const carry = new Map<string, number>();
        let main = 0;
        let by_product = 0;
        for (let craft = 0; craft < 2; craft++) {
            main += 0.993;
            const whole = Math.floor(main + 1e-9);
            main = Math.max(0, main - whole);
            carry.set("uranium-238", main);
            by_product += 0.007;
            carry.set("uranium-235", Math.max(0, by_product - Math.floor(by_product + 1e-9)));
        }
        expect(made.carryKey()).toBe(JSON.stringify(Array.from(carry).sort(([a], [b]) => a.localeCompare(b))));
    });

    it("keeps a carry of 0 apart from no carry at all", () => {
        const { made } = yieldOf("iron-gear-wheel", 0);
        expect(made.carryKey()).toBe("[]");
        const { made: by_chance } = yieldOf("uranium-processing", 0);
        by_chance.finishCraft(crafting());
        expect(by_chance.carryKey()).not.toBe("[]");
    });
});

describe("Yield: why an idle machine shows a full output", () => {
    it("names held products first", () => {
        const { made, inventory } = yieldOf("plastic-bar", 0);
        inventory.addQuantity("plastic-bar", 99);
        made.finishCraft(crafting());
        expect(made.outputFullCode()).toBe(OutputFullCode.HOLDS_PRODUCTS);
        expect(made.outputFullText(OutputFullCode.HOLDS_PRODUCTS, null))
            .toBe("machine holds plastic-bar of a finished craft that does not fit under max stack size of 100");
    });

    it("names a craft that does not fit under the stack size", () => {
        const { made, inventory } = yieldOf("plastic-bar", 0);
        inventory.addQuantity("plastic-bar", 99);
        expect(made.outputFullCode()).toBe(OutputFullCode.NO_ROOM_FOR_CRAFT);
        expect(made.outputFullText(OutputFullCode.NO_ROOM_FOR_CRAFT, null))
            .toBe("machine cannot fit another craft of 2 plastic-bar under max stack size of 100");
    });

    it("names a by-product that has filled its stack", () => {
        const { made, inventory } = yieldOf("uranium-processing", 0);
        inventory.addQuantity("uranium-235", 100);
        expect(made.outputFullCode()).toBe(OutputFullCode.BY_PRODUCT_FULL);
        expect(made.roomForNextCraft()).toBe(false);
        expect(made.outputFullText(OutputFullCode.BY_PRODUCT_FULL, null)).toBe("a by-product has filled its stack");
    });

    it("names the output block, and nothing below it", () => {
        const { state, made, inventory } = yieldOf("iron-gear-wheel", 0);
        const blocked_at = state.machine.output.outputBlock.ingredients_blocked_at;
        inventory.addQuantity("iron-gear-wheel", blocked_at - 1);
        expect(made.outputFullCode()).toBe(OutputFullCode.NONE);
        expect(made.roomForNextCraft()).toBe(true);
        inventory.addQuantity("iron-gear-wheel", 1);
        expect(made.outputFullCode()).toBe(OutputFullCode.AT_OUTPUT_BLOCK);
        // the block stops the inserters, not a craft that has its ingredients
        expect(made.roomForNextCraft()).toBe(true);
        expect(made.outputFullText(OutputFullCode.AT_OUTPUT_BLOCK, null))
            .toBe(`output item "iron-gear-wheel" = ${blocked_at} is at its output block of ${blocked_at}`);
    });

    it("names the result a stack of which waits in a placer's output, and its target", () => {
        const { made, inventory } = yieldOf("processing-unit-recycling", 0, true);
        expect(made.places_results).toBe(true);
        expect(made.outputFullCode()).toBe(OutputFullCode.NONE);
        // its output takes any number of stacks: no products are ever held
        inventory.addQuantity("advanced-circuit", 200);
        expect(made.holdsProducts()).toBe(false);
        expect(made.outputFullCode()).toBe(OutputFullCode.RESULT_STACK_WAITS);
        expect(made.roomForNextCraft()).toBe(false);
        expect(made.outputFullText(OutputFullCode.RESULT_STACK_WAITS, null)).toBe("a stack of advanced-circuit waits in its output");
        expect(made.outputFullText(OutputFullCode.RESULT_STACK_WAITS, { entity_id: EntityId.forChest(3) }))
            .toBe("a stack of advanced-circuit waits in its output for room in chest:3");
        // the first of its results in the recipe's order is named
        inventory.addQuantity("electronic-circuit", 200);
        expect(made.outputFullText(OutputFullCode.RESULT_STACK_WAITS, null)).toBe("a stack of electronic-circuit waits in its output");
    });
});

describe("Yield: what the machine's state keeps of it", () => {
    it("is copied whole onto the copy of the machine's inventory", () => {
        const { state, made } = yieldOf("uranium-processing", 50);
        const user = crafting();
        made.advanceBonus(0.75);
        made.finishCraft(user);
        made.finishCraft(user);
        made.pendingOutput = 3;
        const cloned = MachineState.clone(state);
        expect(cloned.yield).not.toBe(made);
        expect(cloned.yield.bonusProgress).not.toBe(made.bonusProgress);
        expect(cloned.yield.bonusProgress.progress).toBe(made.bonusProgress.progress);
        expect(cloned.yield.pendingOutput).toBe(3);
        expect(cloned.yield.productsFinished).toBe(made.productsFinished);
        expect(cloned.yield.carryKey()).toBe(made.carryKey());
        // the copy reads its own inventory
        cloned.inventoryState.addQuantity("uranium-235", 100);
        expect(cloned.yield.outputFullCode()).toBe(OutputFullCode.BY_PRODUCT_FULL);
        expect(made.outputFullCode()).not.toBe(OutputFullCode.BY_PRODUCT_FULL);
        // and carries its own fractions
        const carried = made.carryKey();
        cloned.yield.finishCraft(crafting());
        expect(cloned.yield.carryKey()).not.toBe(carried);
        expect(made.carryKey()).toBe(carried);
    });

    // the fields that drive the next ticks, each in the machine's key (P4 3.4); productsFinished only grows, so is left out
    it("changes the machine's key with each field that drives the next ticks", () => {
        const { state, made } = yieldOf("uranium-processing", 50);
        const keys = new Set([MachineState.stateKey(state)]);
        made.pendingOutput = 1;
        keys.add(MachineState.stateKey(state));
        made.bonusProgress.progress = 0.25;
        keys.add(MachineState.stateKey(state));
        made.finishCraft(crafting());
        keys.add(MachineState.stateKey(state));
        expect(keys.size).toBe(4);
        const own = Object.entries(made).filter(([, value]) => value === null || typeof value !== "object").map(([key]) => key);
        expect(own).toEqual(["pendingOutput", "productsFinished", "places_results", "output_name", "output_amount", "output_by_chance",
            "output_stack_size", "amount_per_bonus", "bonus_per_craft", "ingredients_blocked_at", "main_carry_slot"]);
    });

    it("shows its fields to outside callers through the machine's state", () => {
        const { state, made } = yieldOf("iron-gear-wheel", 50);
        state.pendingOutput = 2;
        state.productsFinished = 5;
        state.bonusProgress.progress = 0.5;
        expect(made.pendingOutput).toBe(2);
        expect(made.productsFinished).toBe(5);
        expect(made.bonusProgress.progress).toBe(0.5);
    });
});
