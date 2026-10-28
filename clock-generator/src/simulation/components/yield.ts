import type { EntityId } from "../../entities/entity-id";
import type { Machine } from "../../entities/machine/machine";
import { amountIgnoredByProductivity, expectedAmount } from "../../entities/machine/recipe/recipe-metadata";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import { ProgressState } from "../../state/progress-state";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

/**
 * Why a machine that cannot craft shows a full output, as a small integer: no text is made on a tick that asks. The
 * text a history records is made from the code at the transition (`Yield.outputFullText`).
 */
export const OutputFullCode = {
    /** It only waits for ingredients */
    NONE: 0,
    /** A machine that places its results itself: a stack of one of them waits in its output */
    RESULT_STACK_WAITS: 1,
    /** It holds products of a finished craft that do not fit under the stack size */
    HOLDS_PRODUCTS: 2,
    /** Another craft's products do not fit under the stack size */
    NO_ROOM_FOR_CRAFT: 3,
    /** A by-product has filled its stack */
    BY_PRODUCT_FULL: 4,
    /** The main product is at its output block */
    AT_OUTPUT_BLOCK: 5,
} as const;
export type OutputFullCode = typeof OutputFullCode[keyof typeof OutputFullCode];

/**
 * What the yield tells the rest of the machine as it puts products in the output, passed per call (as EnergyUser): the
 * crafting counts the main product it makes, and a machine that places its results itself counts what it places
 */
export interface YieldUser {
    /** The main product put in the output: what the crafting counts in its total */
    countCrafted(amount: number): void;
    /** Results put in the machine's own output, which a machine that places its results itself counts as placed */
    countPlacedInOutput(amount: number): void;
}

/** A by-product, bound once: its stack, a craft's expected amount, its live quantity and its carry slot */
interface ByProduct {
    readonly item_name: string;
    readonly max_stack_size: number;
    readonly amount_per_craft: number;
    readonly quantity: LiveQuantity;
    readonly carry_slot: number;
}

/** A result of a machine that places its results itself, against its stack (see resultStackWaits) */
interface ResultStack {
    readonly item_name: string;
    readonly quantity: LiveQuantity;
    readonly max_stack_size: number;
}

/**
 * A crafting machine's Yield component: what its crafts and its productivity bar make, the products it holds until the
 * output has room for them, the fractions of results that come by chance carried toward the next whole item, and the
 * output room a craft needs. Reads the machine's results and their output blocks, and the machine's inventory, which
 * stays the machine's.
 *
 * A result that comes by chance is made at its expected amount, the fractions carried until they add up to a whole
 * item, the main product as the by-products. A machine that places its results itself (a recycler, `places_results`)
 * puts them in its output whatever it holds, any number of stacks, and starts no craft while a stack of one of them
 * waits there (recorded on the recycler: it stops with 50 ore waiting, not with its 12 result slots full).
 */
export class Yield {
    /** The productivity bar: a full bar pays out at the start of the next tick or after a finished craft */
    public readonly bonusProgress: ProgressState = ProgressState.empty();

    /**
     * Main product of a finished craft that did not fit under the stack size. The machine holds it, and starts no
     * craft, until there is room for it.
     */
    public pendingOutput: number = 0;

    /**
     * Crafts finished and productivity bars paid out so far, as the game counts a machine's `products_finished`:
     * one for each, whatever amount it makes.
     */
    public productsFinished: number = 0;

    /**
     * Fractions of a result made so far that do not yet add up to a whole item, one slot per result item (results of
     * one item share it); -1 until the slot is first written, which the key tells apart from a carry of 0
     */
    private readonly carry: number[];

    /** Whether the machine places its results itself: no stack size caps its output, a stack waiting stops it */
    public readonly places_results: boolean;
    /** The main product */
    public readonly output_name: string;
    /** The most of the main product a craft yields: its amount, one more where it has an extra count fraction */
    private readonly output_amount: number;
    /** What a craft yields of the main product on average, where it comes by chance; null where it always comes in its amount */
    private readonly output_by_chance: number | null;
    private readonly output_stack_size: number;
    /** What a full productivity bar pays of the main product */
    private readonly amount_per_bonus: number;
    /** How far a craft fills the productivity bar */
    private readonly bonus_per_craft: number;
    /** The main product's output block: from it an idle machine shows a full output */
    private readonly ingredients_blocked_at: number;
    private readonly output_quantity: LiveQuantity;
    private readonly by_products: readonly ByProduct[];
    /** Every result, the main product first, in the machine's order */
    private readonly results: readonly ResultStack[];
    private readonly main_carry_slot: number;
    /** The item of each carry slot */
    private readonly carry_names: readonly string[];
    /** The carry slots in the order of their item names, as the key lists them */
    private readonly carry_key_order: readonly number[];

    constructor(
        private readonly machine: Machine,
        /** The machine's ingredients and output (its inventory, built before the Yield) */
        private readonly inventory: WritableInventoryState,
        /** A Yield of the same machine, which a copy shares its bound constants with (see clone) */
        bound: Yield | null = null,
    ) {
        if (bound !== null) {
            this.places_results = bound.places_results;
            this.output_name = bound.output_name;
            this.output_amount = bound.output_amount;
            this.output_by_chance = bound.output_by_chance;
            this.output_stack_size = bound.output_stack_size;
            this.amount_per_bonus = bound.amount_per_bonus;
            this.bonus_per_craft = bound.bonus_per_craft;
            this.ingredients_blocked_at = bound.ingredients_blocked_at;
            this.results = bound.results.map(result => ({
                item_name: result.item_name,
                quantity: new LiveQuantity(inventory, result.item_name),
                max_stack_size: result.max_stack_size,
            }));
            this.by_products = bound.by_products.map((by_product, index) => ({
                item_name: by_product.item_name,
                max_stack_size: by_product.max_stack_size,
                amount_per_craft: by_product.amount_per_craft,
                quantity: this.results[index + 1].quantity,
                carry_slot: by_product.carry_slot,
            }));
            this.output_quantity = this.results[0].quantity;
            this.main_carry_slot = bound.main_carry_slot;
            this.carry_names = bound.carry_names;
            this.carry_key_order = bound.carry_key_order;
            this.carry = bound.carry.slice();
            return;
        }
        const output = machine.output.ingredient;
        const extra_count = (output as { extra_count_fraction?: number }).extra_count_fraction ?? 0;
        const expected = expectedAmount(output);
        this.places_results = machine.metadata.places_results === true;
        this.output_name = output.name;
        this.output_amount = output.amount + (extra_count > 0 ? 1 : 0);
        this.output_by_chance = expected === output.amount ? null : expected;
        this.output_stack_size = output.item.stack_size;
        this.amount_per_bonus = (expected === output.amount ? output.amount : expected) - amountIgnoredByProductivity(output);
        this.bonus_per_craft = machine.bonus_productivity_rate.bonus_per_craft;
        this.ingredients_blocked_at = machine.output.outputBlock.ingredients_blocked_at;

        // the main product first (machine.outputs[0] is machine.output): its live quantity is the main product's
        this.results = machine.outputs.map(result => ({
            item_name: result.item_name,
            quantity: new LiveQuantity(inventory, result.item_name),
            max_stack_size: result.outputBlock.max_stack_size,
        }));
        this.output_quantity = this.results[0].quantity;

        const carry_names: string[] = [machine.output.item_name];
        const slotOf = (item_name: string): number => {
            const slot = carry_names.indexOf(item_name);
            return slot >= 0 ? slot : carry_names.push(item_name) - 1;
        };
        this.main_carry_slot = 0;
        this.by_products = machine.outputs.slice(1).map((by_product, index) => ({
            item_name: by_product.item_name,
            max_stack_size: by_product.outputBlock.max_stack_size,
            amount_per_craft: by_product.amount_per_craft.toDecimal(),
            quantity: this.results[index + 1].quantity,
            carry_slot: slotOf(by_product.item_name),
        }));
        this.carry_names = carry_names;
        this.carry_key_order = carry_names.map((_, slot) => slot).sort((a, b) => carry_names[a].localeCompare(carry_names[b]));
        this.carry = carry_names.map(() => -1);
    }

    /**
     * Pays out a full productivity bar and puts the products the machine holds in the output, one craft's amount at a
     * time, as far as they fit. Done at the start of a working tick and after each finished craft, never on the tick
     * the bar fills.
     */
    public release(user: YieldUser): void {
        // a full bar pays the amount less what the recipe ignores for productivity: 1 of the 2 pentapod eggs
        const bar = this.bonusProgress;
        while (bar.progress >= 1 - PROGRESS_EPSILON) {
            this.pendingOutput += this.output_by_chance === null ? this.amount_per_bonus
                : this.wholeOfMainProduct(this.amount_per_bonus);
            this.productsFinished += 1;
            bar.progress = Math.max(0, bar.progress - 1);
        }
        this.putHeldProductsInOutput(user);
    }

    /** Puts the products the machine holds in the output, one craft's amount at a time, as far as they fit */
    public putHeldProductsInOutput(user: YieldUser): void {
        while (this.pendingOutput > 0 && this.hasOutputSpaceFor(this.nextHeldAmount())) {
            const amount = this.nextHeldAmount();
            this.addOutput(amount, user);
            this.pendingOutput -= amount;
        }
    }

    /** A finished craft: its main product held, then put in as far as it fits, its by-products made, the finish counted */
    public finishCraft(user: YieldUser): void {
        this.pendingOutput += this.output_by_chance === null ? this.output_amount
            : this.wholeOfMainProduct(this.output_by_chance);
        this.release(user);
        this.addByProducts(user);
        this.productsFinished += 1;
    }

    /**
     * The productivity bar fills alongside crafting progress. A full bar is paid out when a craft finishes and at the
     * start of the next tick, not on the tick it fills, and is held when its product does not fit.
     */
    public advanceBonus(craft_progress: number): void {
        if (this.bonus_per_craft <= 0) {
            return;
        }
        this.bonusProgress.progress += craft_progress * this.bonus_per_craft;
    }

    /** Products of a finished craft, or of a paid out productivity bar, that the output has no room for */
    public holdsProducts(): boolean {
        return this.pendingOutput > 0 && !this.hasOutputSpaceFor(this.nextHeldAmount());
    }

    /** The output room the next craft needs: no stack of a placed result waiting, no products held, by-products with room */
    public roomForNextCraft(): boolean {
        if (this.places_results && this.resultStackWaits()) {
            return false;
        }
        return !this.holdsProducts() && this.byProductsHaveSpace();
    }

    /** How many of the main product the output holds */
    public outputQuantity(): number {
        return this.output_quantity.get();
    }

    /**
     * Why a machine that cannot craft shows a full output, or NONE when it only waits for ingredients.
     * As in the game, the output block (overload multiplier x recipe amount) names the status of an idle
     * machine and stops its inserters from fetching ingredients, but never stops a craft that has them.
     */
    public outputFullCode(): OutputFullCode {
        if (this.places_results && this.resultStackWaits()) {
            return OutputFullCode.RESULT_STACK_WAITS;
        }
        if (this.holdsProducts()) {
            return OutputFullCode.HOLDS_PRODUCTS;
        }
        // e.g. 99/100 plastic bars with 2 per craft: no room for another craft
        if (!this.hasOutputSpaceFor(this.output_amount)) {
            return OutputFullCode.NO_ROOM_FOR_CRAFT;
        }
        if (!this.byProductsHaveSpace()) {
            return OutputFullCode.BY_PRODUCT_FULL;
        }
        if (this.output_quantity.get() >= this.ingredients_blocked_at) {
            return OutputFullCode.AT_OUTPUT_BLOCK;
        }
        return OutputFullCode.NONE;
    }

    /**
     * The text a history records for a full output's code, made from the machine as it is when the code was given:
     * only at a transition, never on a tick that keeps the status
     */
    public outputFullText(code: OutputFullCode, result_target: { readonly entity_id: EntityId } | null): string {
        const output_block = this.machine.output.outputBlock;
        switch (code) {
            case OutputFullCode.RESULT_STACK_WAITS:
                return `a stack of ${this.waitingResult()} waits in its output`
                    + (result_target === null ? "" : ` for room in ${result_target.entity_id}`);
            case OutputFullCode.HOLDS_PRODUCTS:
                return `machine holds ${this.output_name} of a finished craft that does not fit under max stack size of ${output_block.max_stack_size}`;
            case OutputFullCode.NO_ROOM_FOR_CRAFT:
                return `machine cannot fit another craft of ${this.output_amount} ${this.output_name} under max stack size of ${output_block.max_stack_size}`;
            case OutputFullCode.BY_PRODUCT_FULL:
                return "a by-product has filled its stack";
            case OutputFullCode.AT_OUTPUT_BLOCK:
                return `output item "${this.output_name}" = ${this.output_quantity.get()} is at its output block of ${output_block.ingredients_blocked_at}`;
            default:
                throw new Error(`No full output has the code ${code}`);
        }
    }

    /** What drives the carry's next crafts: each carried fraction by its item, in the order of the item names */
    public carryKey(): string {
        const carried: [string, number][] = [];
        for (const slot of this.carry_key_order) {
            if (this.carry[slot] >= 0) {
                carried.push([this.carry_names[slot], this.carry[slot]]);
            }
        }
        return JSON.stringify(carried);
    }

    /**
     * A copy of what it holds, reading the given inventory (the copy of the machine's). It shares the bound constants
     * and makes only the live quantities on the copy's inventory.
     */
    public clone(inventory: WritableInventoryState): Yield {
        const cloned = new Yield(this.machine, inventory, this);
        cloned.bonusProgress.progress = this.bonusProgress.progress;
        cloned.pendingOutput = this.pendingOutput;
        cloned.productsFinished = this.productsFinished;
        return cloned;
    }

    /** By-products block the machine only once their stack is full */
    private byProductsHaveSpace(): boolean {
        const by_products = this.by_products;
        if (by_products.length === 0) {
            return true;
        }
        if (this.places_results) {
            // its output takes any number of stacks: a stack waiting stops it (resultStackWaits)
            return !this.resultStackWaits();
        }
        for (let index = 0; index < by_products.length; index++) {
            const by_product = by_products[index];
            const quantity = by_product.quantity.get();
            const max_stack_size = by_product.max_stack_size;
            if (quantity >= max_stack_size || quantity + this.wholeItemsMadeByNextCraft(by_product) > max_stack_size) {
                return false;
            }
        }
        return true;
    }

    /** A machine that places its results itself: whether a stack of one of them waits in its output, which stops it */
    private resultStackWaits(): boolean {
        return this.waitingResultIndex() >= 0;
    }

    /** The first result a stack of which waits in the output, -1 for none */
    private waitingResultIndex(): number {
        const results = this.results;
        for (let index = 0; index < results.length; index++) {
            if (results[index].quantity.get() >= results[index].max_stack_size) {
                return index;
            }
        }
        return -1;
    }

    private waitingResult(): string {
        const index = this.waitingResultIndex();
        if (index < 0) {
            throw new Error("No stack of a result waits in the output");
        }
        return this.results[index].item_name;
    }

    private hasOutputSpaceFor(amount: number): boolean {
        if (this.places_results) {
            // its output takes any number of stacks; a stack waiting stops the next craft instead (roomForNextCraft)
            return true;
        }
        return this.output_quantity.get() + amount <= this.output_stack_size;
    }

    /** Held products go to the output a craft's amount at a time, or what is left of them */
    private nextHeldAmount(): number {
        return Math.min(this.pendingOutput, this.output_amount);
    }

    private addOutput(amount: number, user: YieldUser): void {
        this.inventory.addQuantity(this.output_name, amount);
        user.countCrafted(amount);
        user.countPlacedInOutput(amount);
    }

    /** A carried fraction; 0 for a slot not written yet */
    private carried(slot: number): number {
        const carried = this.carry[slot];
        return carried < 0 ? 0 : carried;
    }

    /**
     * Whole items of the main product a craft or a full bar yields where it comes by chance: its expected amount added to
     * what was carried, and the fraction left carried on, as a by-product's
     */
    private wholeOfMainProduct(expected: number): number {
        const slot = this.main_carry_slot;
        const total = this.carried(slot) + expected;
        const whole = Math.floor(total + PROGRESS_EPSILON);
        this.carry[slot] = Math.max(0, total - whole);
        return whole;
    }

    private wholeItemsMadeByNextCraft(by_product: ByProduct): number {
        return Math.floor(this.carried(by_product.carry_slot) + by_product.amount_per_craft + PROGRESS_EPSILON);
    }

    /** A by-product is made at its expected amount: fractions carry over until they add up to a whole item */
    private addByProducts(user: YieldUser): void {
        const by_products = this.by_products;
        for (let index = 0; index < by_products.length; index++) {
            const by_product = by_products[index];
            const total = this.carried(by_product.carry_slot) + by_product.amount_per_craft;
            const whole = Math.floor(total + PROGRESS_EPSILON);
            if (whole > 0) {
                this.inventory.addQuantity(by_product.item_name, whole);
                user.countPlacedInOutput(whole);
            }
            this.carry[by_product.carry_slot] = Math.max(0, total - whole);
        }
    }
}
