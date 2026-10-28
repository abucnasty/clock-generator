import { EntityState, InventoryItem, LiveQuantity, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
import { MachineOutput, amountIgnoredByProductivity, expectedAmount } from "../../../entities";
import { Energy, EnergyUser } from "../../../simulation/components/energy";
import { placeIntoMachine } from "../../place-into-machine";
import { MachineMode } from "./machine-mode";
import { ContainerStorage } from "../../../simulation/components/container-storage";
import { DropBy } from "../../../simulation/components/ports";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

/**
 * Crafting follows Factorio: ingredients are removed when a craft starts and products are added when it finishes.
 * A craft starts whatever the output holds. Products that do not fit under the stack size when they are made are held
 * by the machine, which starts no craft and makes no progress until there is room for them.
 *
 * A result that comes by chance is made at its expected amount, the fractions carried until they add up to a whole
 * item, the main product as the by-products. A machine that places its results itself (a recycler, `places_results`)
 * puts them in its output whatever it holds, any number of stacks, and starts no craft while a stack of one of them
 * waits there (recorded on the recycler: it stops with 50 ore waiting, not with its 12 result slots full). With a
 * result target it puts what waits into that container each tick as far as it has room, what its crafts of the tick
 * gave included (recorded on the recycler of the ore voider: with room in its car, nothing was left in its output after
 * any of 216,000 ticks).
 */
export class MachineWorkingMode implements MachineMode, EnergyUser {
    public readonly status = MachineStatus.WORKING;

    /**
     * What the per-tick questions read without going through the machine's object tree: values of the machine, which
     * never changes, and live inventory reads resolved on first use (the state's inventories are filled by its
     * factory). One object, so the simulation state stays the plain fields alone.
     */
    private readonly hot: {
        crafts_per_tick: number;
        /** The most of the main product a craft yields: its amount, one more where it has an extra count fraction */
        output_amount: number;
        /** What a craft yields of the main product on average, where it comes by chance; null where it always comes in its amount */
        output_by_chance: number | null;
        /** Whether the machine places its results itself: no stack size caps its output, a stack waiting stops it */
        places_results: boolean;
        output_stack_size: number;
        amount_per_bonus: number;
        bonus_per_craft: number;
        by_products: readonly { output: MachineOutput; max_stack_size: number; amount_per_craft: number }[];
        output_quantity: LiveQuantity | null;
        /** What canStartCraft asks, in recipe order: the held quantity against a craft's need */
        craft_needs: { quantity: LiveQuantity; required: number }[] | null;
        /** What a craft takes out, in `machine.inputs` order */
        craft_takes: { inventory: WritableInventoryState; item_name: string; amount_per_craft: number }[] | null;
        by_product_quantities: LiveQuantity[] | null;
    };

    /** The machine's Energy component, bound once: electric or burner, the same class every tick */
    private readonly energy: Energy;

    constructor(
        private readonly state: MachineState,
        /** The container the machine puts its results into, where it places them itself and has a result target */
        private readonly result_target: ContainerStorage | MachineState | null = null,
    ) {
        this.energy = state.energy;
        const machine = state.machine;
        const output = machine.output.ingredient;
        const extra_count = (output as { extra_count_fraction?: number }).extra_count_fraction ?? 0;
        const most_per_craft = output.amount + (extra_count > 0 ? 1 : 0);
        const expected = expectedAmount(output);
        this.hot = {
            crafts_per_tick: machine.crafting_rate.crafts_per_tick,
            output_amount: most_per_craft,
            output_by_chance: expected === output.amount ? null : expected,
            places_results: machine.metadata.places_results === true,
            output_stack_size: output.item.stack_size,
            amount_per_bonus: (expected === output.amount ? output.amount : expected) - amountIgnoredByProductivity(output),
            bonus_per_craft: machine.bonus_productivity_rate.bonus_per_craft,
            by_products: machine.outputs.slice(1).map(by_product => ({
                output: by_product,
                max_stack_size: by_product.outputBlock.max_stack_size,
                amount_per_craft: by_product.amount_per_craft.toDecimal(),
            })),
            output_quantity: null,
            craft_needs: null,
            craft_takes: null,
            by_product_quantities: null,
        };
    }

    public onEnter(fromMode: MachineMode): void { }

    public onExit(toMode: MachineMode): void { }

    public executeForTick(): void {
        const powered_share = this.energy.poweredShare();
        let budget = this.hot.crafts_per_tick * powered_share;
        let worked = false;

        this.releaseHeldProducts();
        while (budget > PROGRESS_EPSILON && !this.holdsProducts()) {
            let progress = this.state.craftingProgress.progress;
            if (progress <= 0) {
                if (!this.canStartCraft() || !this.energy.hasFuel()) {
                    break;
                }
                this.consumeInputsForCraft();
                progress = 0;
            }

            const step = Math.min(budget, 1 - progress);
            progress += step;
            budget -= step;
            worked = true;
            this.advanceBonusProgress(step);

            if (progress >= 1 - PROGRESS_EPSILON) {
                this.state.pendingOutput += this.hot.output_by_chance === null ? this.hot.output_amount
                    : this.wholeOfMainProduct(this.hot.output_by_chance);
                this.releaseHeldProducts();
                this.addByProducts();
                this.state.craftCount += 1;
                this.state.productsFinished += 1;
                progress = 0;
            }
            this.state.craftingProgress.progress = progress;
        }

        this.energy.spend(worked, this);
    }

    private get inventory_state(): WritableInventoryState {
        return this.state.inventoryState;
    }

    private outputQuantity(): number {
        const quantity = this.hot.output_quantity ??= new LiveQuantity(this.inventory_state, this.state.machine.output.ingredient.name);
        return quantity.get();
    }

    public get output_item(): Readonly<InventoryItem> {
        return this.inventory_state.getItemOrThrow(this.state.machine.output.ingredient.name);
    }

    /** True while a craft is underway or another one can start, a burner has fuel to progress it, and no product waits for room */
    public hasEnoughInputsForCraft(): boolean {
        return this.keepsWorking() && this.energy.hasFuel();
    }

    /** Whether the machine works on after this tick: no product waits for room, and a craft is underway or can start */
    public keepsWorking(): boolean {
        return !this.holdsProducts() && (this.craftInProgress() || this.canStartCraft());
    }

    /** A burner with nothing to burn and too little energy held for a tick of work (BurnerEnergy.outOfFuel) */
    public isOutOfFuel(): boolean {
        return this.energy.outOfFuel(this);
    }

    /**
     * Whole items of the main product a craft or a full bar yields where it comes by chance: its expected amount added to
     * what was carried, and the fraction left carried on, as a by-product's
     */
    private wholeOfMainProduct(expected: number): number {
        const item_name = this.state.machine.output.item_name;
        const total = (this.state.byProductCarry.get(item_name) ?? 0) + expected;
        const whole = Math.floor(total + PROGRESS_EPSILON);
        this.state.byProductCarry.set(item_name, Math.max(0, total - whole));
        return whole;
    }

    /**
     * A machine that places its results itself, with a result target: what waits in its output goes into the
     * container, each result as far as it has room. Done every tick before the machine crafts and again after it.
     */
    public placeResults(): void {
        const target = this.result_target;
        if (target === null) {
            return;
        }
        for (const output of this.state.machine.outputs) {
            const waiting = this.inventory_state.getQuantity(output.item_name);
            if (waiting <= 0) {
                continue;
            }
            if (EntityState.isMachine(target)) {
                this.state.resultsPlaced += placeIntoMachine(this.inventory_state, target, output.ingredient.item);
                continue;
            }
            const amount = target.accepts(output.item_name, waiting, DropBy.PLACER);
            if (amount > 0) {
                this.inventory_state.removeQuantity(output.item_name, amount);
                target.insert(output.item_name, amount);
                this.state.resultsPlaced += amount;
            }
        }
    }

    /** A machine that places its results itself: whether a stack of one of them waits in its output, which stops it */
    private resultStackWaits(): boolean {
        for (const output of this.state.machine.outputs) {
            if (this.inventory_state.getQuantity(output.item_name) >= output.outputBlock.max_stack_size) {
                return true;
            }
        }
        return false;
    }

    /** Products of a finished craft, or of a paid out productivity bar, that the output has no room for */
    private holdsProducts(): boolean {
        return this.state.pendingOutput > 0 && !this.hasOutputSpaceFor(this.nextHeldAmount());
    }

    /** Held products go to the output a craft's amount at a time, or what is left of them */
    private nextHeldAmount(): number {
        return Math.min(this.state.pendingOutput, this.hot.output_amount);
    }

    /**
     * Pays out a full productivity bar and puts the products the machine holds in the output, one craft's amount at a
     * time, as far as they fit
     */
    private releaseHeldProducts(): void {
        // a full bar pays the amount less what the recipe ignores for productivity: 1 of the 2 pentapod eggs
        while (this.state.bonusProgress.progress >= 1 - PROGRESS_EPSILON) {
            this.state.pendingOutput += this.hot.output_by_chance === null ? this.hot.amount_per_bonus
                : this.wholeOfMainProduct(this.hot.amount_per_bonus);
            this.state.productsFinished += 1;
            this.state.bonusProgress.progress = Math.max(0, this.state.bonusProgress.progress - 1);
        }
        this.putHeldProductsInOutput();
    }

    /** Puts the products the machine holds in the output, one craft's amount at a time, as far as they fit */
    public putHeldProductsInOutput(): void {
        while (this.state.pendingOutput > 0 && this.hasOutputSpaceFor(this.nextHeldAmount())) {
            const amount = this.nextHeldAmount();
            this.addOutput(amount);
            this.state.pendingOutput -= amount;
        }
    }

    /**
     * Why a machine that cannot craft shows a full output, or null when it only waits for ingredients.
     * As in the game, the output block (overload multiplier x recipe amount) names the status of an idle
     * machine and stops its inserters from fetching ingredients, but never stops a craft that has them.
     */
    public outputFullReason(): string | null {
        const output_item = this.output_item;
        const amount_per_craft = this.hot.output_amount;
        if (this.hot.places_results) {
            const waiting = this.state.machine.outputs.find(output =>
                this.inventory_state.getQuantity(output.item_name) >= output.outputBlock.max_stack_size);
            if (waiting !== undefined) {
                return `a stack of ${waiting.item_name} waits in its output`
                    + (this.result_target === null ? "" : ` for room in ${this.result_target.entity_id}`);
            }
        }
        if (this.holdsProducts()) {
            return `machine holds ${output_item.item_name} of a finished craft that does not fit under max stack size of ${this.state.machine.output.outputBlock.max_stack_size}`;
        }
        // e.g. 99/100 plastic bars with 2 per craft: no room for another craft
        if (!this.hasOutputSpaceFor(amount_per_craft)) {
            return `machine cannot fit another craft of ${amount_per_craft} ${output_item.item_name} under max stack size of ${this.state.machine.output.outputBlock.max_stack_size}`;
        }
        if (!this.byProductsHaveSpace()) {
            return "a by-product has filled its stack";
        }
        const output_block = this.state.machine.output.outputBlock;
        if (output_item.quantity >= output_block.ingredients_blocked_at) {
            return `output item "${output_item.item_name}" = ${output_item.quantity} is at its output block of ${output_block.ingredients_blocked_at}`;
        }
        return null;
    }

    public craftInProgress(): boolean {
        return this.state.craftingProgress.progress > 0;
    }

    private canStartCraft(): boolean {
        const needs = this.hot.craft_needs ??= this.state.machine.metadata.recipe.raw.ingredients.map(ingredient => ({
            quantity: new LiveQuantity(MachineState.ingredientInventory(this.state, ingredient.name), ingredient.name),
            required: this.state.machine.metadata.recipe.inputsPerCraft.get(ingredient.name)!.amount,
        }));
        for (let index = 0; index < needs.length; index++) {
            if (needs[index].quantity.get() < needs[index].required) {
                return false;
            }
        }
        if (this.hot.places_results && this.resultStackWaits()) {
            return false;
        }
        return !this.holdsProducts() && this.byProductsHaveSpace();
    }

    /** By-products block the machine only once their stack is full */
    public byProductsHaveSpace(): boolean {
        const by_products = this.hot.by_products;
        if (by_products.length === 0) {
            return true;
        }
        if (this.hot.places_results) {
            // its output takes any number of stacks: a stack waiting stops it (resultStackWaits)
            return !this.resultStackWaits();
        }
        const quantities = this.hot.by_product_quantities ??= by_products.map(by_product =>
            new LiveQuantity(this.inventory_state, by_product.output.item_name));
        for (let index = 0; index < by_products.length; index++) {
            const quantity = quantities[index].get();
            const max_stack_size = by_products[index].max_stack_size;
            if (quantity >= max_stack_size || quantity + this.wholeItemsMadeByNextCraft(by_products[index]) > max_stack_size) {
                return false;
            }
        }
        return true;
    }

    private carryOf(by_product: { output: MachineOutput }): number {
        return this.state.byProductCarry.get(by_product.output.item_name) ?? 0;
    }

    private wholeItemsMadeByNextCraft(by_product: { output: MachineOutput; amount_per_craft: number }): number {
        return Math.floor(this.carryOf(by_product) + by_product.amount_per_craft + PROGRESS_EPSILON);
    }

    /** A by-product is made at its expected amount: fractions carry over until they add up to a whole item */
    private addByProducts(): void {
        for (const by_product of this.hot.by_products) {
            const total = this.carryOf(by_product) + by_product.amount_per_craft;
            const whole = Math.floor(total + PROGRESS_EPSILON);
            if (whole > 0) {
                this.inventory_state.addQuantity(by_product.output.item_name, whole);
                this.countPlacedInOutput(whole);
            }
            this.state.byProductCarry.set(by_product.output.item_name, Math.max(0, total - whole));
        }
    }

    private hasOutputSpaceFor(amount: number): boolean {
        if (this.hot.places_results) {
            // its output takes any number of stacks; a stack waiting stops the next craft instead (canStartCraft)
            return true;
        }
        return this.outputQuantity() + amount <= this.hot.output_stack_size;
    }

    /**
     * The productivity bar fills alongside crafting progress. A full bar is paid out when a craft finishes and at the
     * start of the next tick, not on the tick it fills, and is held when its product does not fit.
     */
    private advanceBonusProgress(craft_progress: number): void {
        if (this.hot.bonus_per_craft <= 0) {
            return;
        }
        this.state.bonusProgress.progress += craft_progress * this.hot.bonus_per_craft;
    }

    private addOutput(amount: number): void {
        this.inventory_state.addQuantity(this.state.machine.output.ingredient.name, amount);
        this.state.totalCrafted += amount;
        this.countPlacedInOutput(amount);
    }

    /** Results a machine that places its results itself puts in its own output, where it has no result target to place them into */
    private countPlacedInOutput(amount: number): void {
        if (this.hot.places_results && (this.result_target === null || EntityState.isMachine(this.result_target))) {
            this.state.resultsPlaced += amount;
        }
    }

    private consumeInputsForCraft(): void {
        this.state.craftsStarted += 1;
        const takes = this.hot.craft_takes ??= Array.from(this.state.machine.inputs.values(), input => ({
            inventory: MachineState.ingredientInventory(this.state, input.ingredient.name),
            item_name: input.ingredient.name,
            amount_per_craft: input.consumption_rate.amount_per_craft,
        }));
        for (let index = 0; index < takes.length; index++) {
            takes[index].inventory.removeQuantity(takes[index].item_name, takes[index].amount_per_craft);
        }
    }
}
