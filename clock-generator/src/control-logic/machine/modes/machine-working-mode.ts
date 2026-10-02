import { InventoryItem, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
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
                if (!this.canStartCraft()) {
                    break;
                }
                this.consumeInputsForCraft();
                progress = 0;
            }

            const step = Math.min(budget, 1 - progress);
            progress += step;
            budget -= step;
            this.advanceBonusProgress(step);

            if (progress >= 1 - PROGRESS_EPSILON) {
                this.addOutput(this.state.machine.output.ingredient.amount);
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

    /** True while a craft is underway or another one can start */
    public hasEnoughInputsForCraft(): boolean {
        return this.isCraftInProgress() || this.canStartCraft();
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
        return this.hasOutputSpaceFor(this.state.machine.output.ingredient.amount);
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
