import { InventoryItem, LiveQuantity, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
import { ENERGY_BUFFER_TICKS, MachineOutput, amountIgnoredByProductivity } from "../../../entities";
import { MachineMode } from "./machine-mode";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

// A burner's energy buffer is topped up from its fuel after a tick of work, but not after the tick the machine stops.
// A stopped machine is left with the 1/15 tick the buffer holds over a tick of work, which is all it has to work with
// on the tick it starts again: that tick makes 1/15 of a tick's progress, and its top-up burns 16/15 of a tick's fuel.

/**
 * Crafting follows Factorio: ingredients are removed when a craft starts and products are added when it finishes.
 * A craft starts whatever the output holds. Products that do not fit under the stack size when they are made are held
 * by the machine, which starts no craft and makes no progress until there is room for them.
 */
export class MachineWorkingMode implements MachineMode {
    public readonly status = MachineStatus.WORKING;

    /**
     * What the per-tick questions read without going through the machine's object tree: values of the machine, which
     * never changes, and live inventory reads resolved on first use (the state's inventories are filled by its
     * factory). One object, so the simulation state stays the plain fields alone.
     */
    private readonly hot: {
        crafts_per_tick: number;
        output_amount: number;
        output_stack_size: number;
        amount_per_bonus: number;
        bonus_per_craft: number;
        by_products: readonly { output: MachineOutput; max_stack_size: number; amount_per_craft: number }[];
        /** Energy a tick of work takes, in MJ; 0 without a fuel slot */
        energy_per_tick: number;
        output_quantity: LiveQuantity | null;
        fuel_quantity: LiveQuantity | null;
        /** What canStartCraft asks, in recipe order: the held quantity against a craft's need */
        craft_needs: { quantity: LiveQuantity; required: number }[] | null;
        /** What a craft takes out, in `machine.inputs` order */
        craft_takes: { inventory: WritableInventoryState; item_name: string; amount_per_craft: number }[] | null;
        by_product_quantities: LiveQuantity[] | null;
    };

    constructor(
        private readonly state: MachineState
    ) {
        const machine = state.machine;
        const output = machine.output.ingredient;
        this.hot = {
            crafts_per_tick: machine.crafting_rate.crafts_per_tick,
            output_amount: output.amount,
            output_stack_size: output.item.stack_size,
            amount_per_bonus: output.amount - amountIgnoredByProductivity(output),
            bonus_per_craft: machine.bonus_productivity_rate.bonus_per_craft,
            by_products: machine.outputs.slice(1).map(by_product => ({
                output: by_product,
                max_stack_size: by_product.outputBlock.max_stack_size,
                amount_per_craft: by_product.amount_per_craft.toDecimal(),
            })),
            energy_per_tick: machine.fuel_slot === undefined ? 0
                : machine.fuel_slot.energy_per_craft_mj * machine.crafting_rate.crafts_per_tick,
            output_quantity: null,
            fuel_quantity: null,
            craft_needs: null,
            craft_takes: null,
            by_product_quantities: null,
        };
    }

    public onEnter(fromMode: MachineMode): void { }

    public onExit(toMode: MachineMode): void { }

    public executeForTick(): void {
        const powered_share = this.poweredShareOfTick();
        let budget = this.hot.crafts_per_tick * powered_share;
        let worked = false;

        this.releaseHeldProducts();
        while (budget > PROGRESS_EPSILON && !this.holdsProducts()) {
            let progress = this.state.craftingProgress.progress;
            if (progress <= 0) {
                if (!this.canStartCraft() || !this.hasFuel()) {
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
                this.state.pendingOutput += this.hot.output_amount;
                this.releaseHeldProducts();
                this.addByProducts();
                this.state.craftCount += 1;
                this.state.productsFinished += 1;
                progress = 0;
            }
            this.state.craftingProgress.progress = progress;
        }

        this.spendEnergyForTick(worked);
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
        return !this.holdsProducts() && (this.isCraftInProgress() || this.canStartCraft()) && this.hasFuel();
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
            this.state.pendingOutput += this.hot.amount_per_bonus;
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

    private hasFuel(): boolean {
        return this.availableFuelEnergy() > PROGRESS_EPSILON || this.state.machine.fuel_slot === undefined;
    }

    /**
     * A burner is out of fuel when it has nothing to burn and holds less energy than a tick of work takes: the 1/15 of
     * a tick a stopped machine keeps is not enough to count on. A craft underway spends what is left before the machine
     * reports it, so a partly filled buffer is used up, not thrown away. The game reports this ahead of a shortage of
     * ingredients and a full output.
     */
    public isOutOfFuel(): boolean {
        if (!this.state.machine.fuel_slot) {
            return false;
        }
        if (this.fuelEnergy() > PROGRESS_EPSILON) {
            return false;
        }
        const buffer = this.energyBuffer();
        if (this.isCraftInProgress() && buffer > PROGRESS_EPSILON) {
            return false;
        }
        return buffer < this.hot.energy_per_tick - PROGRESS_EPSILON;
    }

    /** Energy the machine holds to work with, plus the burning item and the items waiting in the fuel slot, in MJ */
    private availableFuelEnergy(): number {
        if (!this.state.machine.fuel_slot) {
            return Infinity;
        }
        return this.energyBuffer() + this.fuelEnergy();
    }

    /** Energy in the burning item plus the items waiting in the fuel slot, in MJ */
    private fuelEnergy(): number {
        const slot = this.state.machine.fuel_slot!;
        const fuel = this.hot.fuel_quantity ??= new LiveQuantity(this.state.fuelInventory, slot.fuel.item_name);
        return this.state.fuelProgress.energy_remaining_mj + fuel.get() * slot.fuel.fuel_value_mj;
    }

    private energyBuffer(): number {
        return this.state.fuelProgress.energy_buffer_mj;
    }

    /** The part of a tick's work the energy the machine holds pays for: all of it, except on the tick it starts again */
    private poweredShareOfTick(): number {
        if (!this.state.machine.fuel_slot) {
            return 1;
        }
        return Math.min(1, this.energyBuffer() / this.hot.energy_per_tick);
    }

    /**
     * A tick of work draws a tick of energy from what the machine holds, and the fuel tops it up if the machine keeps
     * working: a craft is underway, or the next one can start. A machine that holds no energy takes it from the fuel
     * first, and works from the next tick.
     */
    private spendEnergyForTick(worked: boolean): void {
        if (!this.state.machine.fuel_slot) {
            return;
        }
        const energy_per_tick = this.hot.energy_per_tick;
        let buffer = this.energyBuffer();
        if (worked) {
            buffer -= Math.min(buffer, energy_per_tick);
        }
        const keeps_working = !this.holdsProducts() && (this.isCraftInProgress() || this.canStartCraft());
        if (keeps_working) {
            buffer += this.burnFuel(ENERGY_BUFFER_TICKS * energy_per_tick - buffer);
        }
        this.state.fuelProgress.energy_buffer_mj = buffer;
    }

    /** Burns up to `energy` MJ of fuel, lighting the next fuel item when the burning one runs out; returns what was burned */
    private burnFuel(energy: number): number {
        const slot = this.state.machine.fuel_slot!;
        const fuel_progress = this.state.fuelProgress;
        let required = Math.min(energy, this.fuelEnergy());
        let burned = 0;
        while (required > PROGRESS_EPSILON) {
            if (fuel_progress.energy_remaining_mj <= PROGRESS_EPSILON) {
                this.state.fuelInventory.removeQuantity(slot.fuel.item_name, 1);
                fuel_progress.energy_remaining_mj = slot.fuel.fuel_value_mj;
            }
            const spent = Math.min(required, fuel_progress.energy_remaining_mj);
            fuel_progress.energy_remaining_mj -= spent;
            required -= spent;
            burned += spent;
        }
        return burned;
    }

    private isCraftInProgress(): boolean {
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
        return !this.holdsProducts() && this.byProductsHaveSpace();
    }

    /** By-products block the machine only once their stack is full */
    public byProductsHaveSpace(): boolean {
        const by_products = this.hot.by_products;
        if (by_products.length === 0) {
            return true;
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
            }
            this.state.byProductCarry.set(by_product.output.item_name, Math.max(0, total - whole));
        }
    }

    private hasOutputSpaceFor(amount: number): boolean {
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
