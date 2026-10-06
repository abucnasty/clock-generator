import { InventoryItem, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
import { MachineOutput } from "../../../entities";
import { MachineMode } from "./machine-mode";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

/**
 * A burner machine works from a buffer of energy that holds this many ticks of work. A tick of work draws one tick of
 * energy from it, and the fuel tops it up again, but not after the tick the machine stops. A stopped machine is left
 * with the 1/15 tick over, which is all it has to work with on the tick it starts again: that tick makes 1/15 of a
 * tick's progress, and its top-up burns 16/15 of a tick's fuel. Measured on biochambers in Factorio 2.1.
 */
const ENERGY_BUFFER_TICKS = 16 / 15;

/**
 * Crafting follows Factorio: ingredients are removed when a craft starts and products are added when it finishes.
 * A craft starts whatever the output holds. Products that do not fit under the stack size when they are made are held
 * by the machine, which starts no craft and makes no progress until there is room for them.
 */
export class MachineWorkingMode implements MachineMode {
    public readonly status = MachineStatus.WORKING;

    constructor(
        private readonly state: MachineState
    ) { }

    public onEnter(fromMode: MachineMode): void { }

    public onExit(toMode: MachineMode): void { }

    public executeForTick(): void {
        const powered_share = this.poweredShareOfTick();
        let budget = this.state.machine.crafting_rate.crafts_per_tick * powered_share;
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
                this.state.pendingOutput += this.state.machine.output.ingredient.amount;
                this.releaseHeldProducts();
                this.addByProducts();
                this.state.craftCount += 1;
                progress = 0;
            }
            this.state.craftingProgress.progress = progress;
        }

        this.spendEnergyForTick(worked);
    }

    private get inventory_state(): WritableInventoryState {
        return this.state.inventoryState;
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
        return this.state.pendingOutput > 0 && !this.hasOutputSpaceFor(this.state.machine.output.ingredient.amount);
    }

    /**
     * Pays out a full productivity bar and puts the products the machine holds in the output, one craft's amount at a
     * time, as far as they fit
     */
    private releaseHeldProducts(): void {
        const amount = this.state.machine.output.ingredient.amount;
        while (this.state.bonusProgress.progress >= 1 - PROGRESS_EPSILON) {
            this.state.pendingOutput += amount;
            this.state.bonusProgress.progress = Math.max(0, this.state.bonusProgress.progress - 1);
        }
        while (this.state.pendingOutput > 0 && this.hasOutputSpaceFor(amount)) {
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
        const amount_per_craft = this.state.machine.output.ingredient.amount;
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
        if (output_item.quantity >= output_block.quantity) {
            return `output item "${output_item.item_name}" = ${output_item.quantity} is at its output block of ${output_block.quantity}`;
        }
        return null;
    }

    private hasFuel(): boolean {
        return this.availableFuelEnergy() > PROGRESS_EPSILON || this.state.machine.fuel_slot === undefined;
    }

    /** Energy the machine holds to work with, plus the burning item and the items waiting in the fuel slot, in MJ */
    private availableFuelEnergy(): number {
        const slot = this.state.machine.fuel_slot;
        if (!slot) {
            return Infinity;
        }
        return this.energyBuffer() + this.fuelEnergy();
    }

    /** Energy in the burning item plus the items waiting in the fuel slot, in MJ */
    private fuelEnergy(): number {
        const slot = this.state.machine.fuel_slot!;
        return this.state.fuelProgress.energy_remaining_mj
            + this.state.fuelInventory.getQuantity(slot.fuel.item_name) * slot.fuel.fuel_value_mj;
    }

    /** Energy a tick of work takes, in MJ */
    private energyPerTick(): number {
        return this.state.machine.fuel_slot!.energy_per_craft_mj * this.state.machine.crafting_rate.crafts_per_tick;
    }

    private energyBuffer(): number {
        return this.state.fuelProgress.energy_buffer_mj;
    }

    /** The part of a tick's work the energy the machine holds pays for: all of it, except on the tick it starts again */
    private poweredShareOfTick(): number {
        if (!this.state.machine.fuel_slot) {
            return 1;
        }
        return Math.min(1, this.energyBuffer() / this.energyPerTick());
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
        const energy_per_tick = this.energyPerTick();
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
        const recipe = this.state.machine.metadata.recipe;
        for (const ingredient of recipe.raw.ingredients) {
            const available = this.inventory_state.getQuantity(ingredient.name);
            const required = recipe.inputsPerCraft.get(ingredient.name)!.amount;
            if (available < required) {
                return false;
            }
        }
        return !this.holdsProducts() && this.byProductsHaveSpace();
    }

    /** By-products block the machine only once their stack is full */
    public byProductsHaveSpace(): boolean {
        return this.byProducts.every(output => {
            const quantity = this.inventory_state.getQuantity(output.item_name);
            const max_stack_size = output.outputBlock.max_stack_size;
            return quantity < max_stack_size && quantity + this.wholeItemsMadeByNextCraft(output) <= max_stack_size;
        });
    }

    private get byProducts(): readonly MachineOutput[] {
        return this.state.machine.outputs.slice(1);
    }

    private carryOf(output: MachineOutput): number {
        return this.state.byProductCarry.get(output.item_name) ?? 0;
    }

    private wholeItemsMadeByNextCraft(output: MachineOutput): number {
        return Math.floor(this.carryOf(output) + output.amount_per_craft.toDecimal() + PROGRESS_EPSILON);
    }

    /** A by-product is made at its expected amount: fractions carry over until they add up to a whole item */
    private addByProducts(): void {
        for (const output of this.byProducts) {
            const total = this.carryOf(output) + output.amount_per_craft.toDecimal();
            const whole = Math.floor(total + PROGRESS_EPSILON);
            if (whole > 0) {
                this.inventory_state.addQuantity(output.item_name, whole);
            }
            this.state.byProductCarry.set(output.item_name, Math.max(0, total - whole));
        }
    }

    private hasOutputSpaceFor(amount: number): boolean {
        const output = this.state.machine.output.ingredient;
        return this.inventory_state.getQuantity(output.name) + amount <= output.item.stack_size;
    }

    /**
     * The productivity bar fills alongside crafting progress. A full bar is paid out when a craft finishes and at the
     * start of the next tick, not on the tick it fills, and is held when its product does not fit.
     */
    private advanceBonusProgress(craft_progress: number): void {
        const bonus_per_craft = this.state.machine.bonus_productivity_rate.bonus_per_craft;
        if (bonus_per_craft <= 0) {
            return;
        }
        this.state.bonusProgress.progress += craft_progress * bonus_per_craft;
    }

    private addOutput(amount: number): void {
        this.inventory_state.addQuantity(this.state.machine.output.ingredient.name, amount);
        this.state.totalCrafted += amount;
    }

    private consumeInputsForCraft(): void {
        this.state.machine.inputs.forEach(input => {
            this.inventory_state.removeQuantity(
                input.ingredient.name,
                input.consumption_rate.amount_per_craft
            );
        })
    }
}
