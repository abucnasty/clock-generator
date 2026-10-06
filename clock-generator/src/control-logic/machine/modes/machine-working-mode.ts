import { InventoryItem, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
import { MachineOutput } from "../../../entities";
import { MachineMode } from "./machine-mode";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

/**
 * Crafting follows Factorio: ingredients are removed when a craft starts, products are added when it
 * finishes, and a craft only starts if its products fit in the output slot.
 */
export class MachineWorkingMode implements MachineMode {
    public readonly status = MachineStatus.WORKING;

    constructor(
        private readonly state: MachineState
    ) { }

    public onEnter(fromMode: MachineMode): void { }

    public onExit(toMode: MachineMode): void { }

    public executeForTick(): void {
        let budget = this.state.machine.crafting_rate.crafts_per_tick;

        while (budget > PROGRESS_EPSILON) {
            let progress = this.state.craftingProgress.progress;
            if (progress <= 0) {
                if (!this.canStartCraft() || !this.hasFuel()) {
                    break;
                }
                this.consumeInputsForCraft();
                progress = 0;
            }

            const step = this.affordableStep(Math.min(budget, 1 - progress));
            if (step <= PROGRESS_EPSILON) {
                break;
            }
            this.burnFuelFor(step);
            progress += step;
            budget -= step;
            this.advanceBonusProgress(step);

            if (progress >= 1 - PROGRESS_EPSILON) {
                this.addOutput(this.state.machine.output.ingredient.amount);
                this.addByProducts();
                this.state.craftCount += 1;
                progress = 0;
            }
            this.state.craftingProgress.progress = progress;
        }
    }

    private get inventory_state(): WritableInventoryState {
        return this.state.inventoryState;
    }

    public get output_item(): Readonly<InventoryItem> {
        return this.inventory_state.getItemOrThrow(this.state.machine.output.ingredient.name);
    }

    /** True while a craft is underway or another one can start, and a burner has fuel to progress it */
    public hasEnoughInputsForCraft(): boolean {
        return (this.isCraftInProgress() || this.canStartCraft()) && this.hasFuel();
    }

    private hasFuel(): boolean {
        return this.availableFuelEnergy() > PROGRESS_EPSILON || this.state.machine.fuel_slot === undefined;
    }

    /** Energy in the burning item plus the items waiting in the fuel slot, in MJ */
    private availableFuelEnergy(): number {
        const slot = this.state.machine.fuel_slot;
        if (!slot) {
            return Infinity;
        }
        return this.state.fuelProgress.energy_remaining_mj
            + this.state.fuelInventory.getQuantity(slot.fuel.item_name) * slot.fuel.fuel_value_mj;
    }

    /** The part of a crafting step that the available fuel can pay for */
    private affordableStep(step: number): number {
        const slot = this.state.machine.fuel_slot;
        if (!slot) {
            return step;
        }
        return Math.min(step, this.availableFuelEnergy() / slot.energy_per_craft_mj);
    }

    /** Spend energy for a step of crafting progress, lighting the next fuel item when the burning one runs out */
    private burnFuelFor(step: number): void {
        const slot = this.state.machine.fuel_slot;
        if (!slot) {
            return;
        }
        const fuel_progress = this.state.fuelProgress;
        let required = step * slot.energy_per_craft_mj;
        while (required > PROGRESS_EPSILON) {
            if (fuel_progress.energy_remaining_mj <= PROGRESS_EPSILON) {
                this.state.fuelInventory.removeQuantity(slot.fuel.item_name, 1);
                fuel_progress.energy_remaining_mj = slot.fuel.fuel_value_mj;
            }
            const spent = Math.min(required, fuel_progress.energy_remaining_mj);
            fuel_progress.energy_remaining_mj -= spent;
            required -= spent;
        }
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
        return this.hasOutputSpaceFor(this.state.machine.output.ingredient.amount) && this.byProductsHaveSpace();
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

    /** Bonus products fill alongside crafting progress; a full bonus that doesn't fit waits for space */
    private advanceBonusProgress(craft_progress: number): void {
        const bonus_per_craft = this.state.machine.bonus_productivity_rate.bonus_per_craft;
        if (bonus_per_craft <= 0) {
            return;
        }
        const amount = this.state.machine.output.ingredient.amount;
        this.state.bonusProgress.progress += craft_progress * bonus_per_craft;
        // the craft in progress has already reserved room for its own products
        while (this.state.bonusProgress.progress >= 1 - PROGRESS_EPSILON && this.hasOutputSpaceFor(2 * amount)) {
            this.addOutput(amount);
            this.state.bonusProgress.progress = Math.max(0, this.state.bonusProgress.progress - 1);
        }
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
