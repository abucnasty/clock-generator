import { LiveQuantity, MachineState, MachineStatus, WritableInventoryState } from "../../../state";
import { Energy, EnergyUser } from "../../../simulation/components/energy";
import { OutputFullCode, Yield, YieldUser } from "../../../simulation/components/yield";
import { MachineMode } from "./machine-mode";
import { ContainerStorage } from "../../../simulation/components/container-storage";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

/**
 * Crafting follows Factorio: ingredients are removed when a craft starts and products are added when it finishes.
 * A craft starts whatever the output holds. Products that do not fit under the stack size when they are made are held
 * by the machine (its Yield component), which starts no craft and makes no progress until there is room for them.
 *
 * A machine that places its results itself (a recycler, `places_results`) with a result target puts what waits in its
 * output into that container each tick as far as it has room, what its crafts of the tick gave included (recorded on
 * the recycler of the ore voider: with room in its car, nothing was left in its output after any of 216,000 ticks).
 */
export class MachineWorkingMode implements MachineMode, EnergyUser, YieldUser {
    public readonly status = MachineStatus.WORKING;

    /**
     * What the per-tick questions read without going through the machine's object tree: values of the machine, which
     * never changes, and live inventory reads resolved on first use (the state's inventories are filled by its
     * factory). One object, so the simulation state stays the plain fields alone.
     */
    private readonly hot: {
        crafts_per_tick: number;
        /** What canStartCraft asks, in recipe order: the held quantity against a craft's need */
        craft_needs: { quantity: LiveQuantity; required: number }[] | null;
        /** What a craft takes out, in `machine.inputs` order */
        craft_takes: { inventory: WritableInventoryState; item_name: string; amount_per_craft: number }[] | null;
    };

    /** The machine's Energy component, bound once: electric or burner, the same class every tick */
    private readonly energy: Energy;

    /** The machine's Yield component, bound once */
    private readonly yield: Yield;

    constructor(
        private readonly state: MachineState,
        /** The container the machine puts its results into, where it places them itself and has a result target */
        private readonly result_target: ContainerStorage | MachineState | null = null,
    ) {
        this.energy = state.energy;
        this.yield = state.yield;
        this.hot = {
            crafts_per_tick: state.machine.crafting_rate.crafts_per_tick,
            craft_needs: null,
            craft_takes: null,
        };
    }

    public onEnter(fromMode: MachineMode): void { }

    public onExit(toMode: MachineMode): void { }

    public executeForTick(): void {
        const powered_share = this.energy.poweredShare();
        let budget = this.hot.crafts_per_tick * powered_share;
        let worked = false;

        this.yield.release(this);
        while (budget > PROGRESS_EPSILON && !this.yield.holdsProducts()) {
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
            this.yield.advanceBonus(step);

            if (progress >= 1 - PROGRESS_EPSILON) {
                this.yield.finishCraft(this);
                this.state.craftCount += 1;
                progress = 0;
            }
            this.state.craftingProgress.progress = progress;
        }

        this.energy.spend(worked, this);
    }

    private get inventory_state(): WritableInventoryState {
        return this.state.inventoryState;
    }

    /** True while a craft is underway or another one can start, a burner has fuel to progress it, and no product waits for room */
    public hasEnoughInputsForCraft(): boolean {
        return this.keepsWorking() && this.energy.hasFuel();
    }

    /** Whether the machine works on after this tick: no product waits for room, and a craft is underway or can start */
    public keepsWorking(): boolean {
        return !this.yield.holdsProducts() && (this.craftInProgress() || this.canStartCraft());
    }

    /** A burner with nothing to burn and too little energy held for a tick of work (BurnerEnergy.outOfFuel) */
    public isOutOfFuel(): boolean {
        return this.energy.outOfFuel(this);
    }

    /** Why the machine, which cannot craft, shows a full output (Yield.outputFullCode; for the status evaluators) */
    public outputFullCode(): OutputFullCode {
        return this.yield.outputFullCode();
    }

    /** The text a transition records for a full output's code, naming the result target where a stack waits for it */
    public outputFullText(code: OutputFullCode): string {
        return this.yield.outputFullText(code, this.result_target);
    }

    public craftInProgress(): boolean {
        return this.state.craftingProgress.progress > 0;
    }

    private canStartCraft(): boolean {
        const needs = this.hot.craft_needs ??= this.state.machine.metadata.recipe.raw.ingredients.map(ingredient => ({
            quantity: new LiveQuantity(this.state.ingress.ingredientInventory(ingredient.name), ingredient.name),
            required: this.state.machine.metadata.recipe.inputsPerCraft.get(ingredient.name)!.amount,
        }));
        for (let index = 0; index < needs.length; index++) {
            if (needs[index].quantity.get() < needs[index].required) {
                return false;
            }
        }
        return this.yield.roomForNextCraft();
    }

    /** The main product the Yield put in the output: the machine's total */
    public countCrafted(amount: number): void {
        this.state.totalCrafted += amount;
    }

    /** Results a machine that places its results itself puts in its own output, where it has no result target to place them into */
    public countPlacedInOutput(amount: number): void {
        this.state.placement.countPlacedInOwnOutput(amount);
    }

    private consumeInputsForCraft(): void {
        this.state.craftsStarted += 1;
        const takes = this.hot.craft_takes ??= Array.from(this.state.machine.inputs.values(), input => ({
            inventory: this.state.ingress.ingredientInventory(input.ingredient.name),
            item_name: input.ingredient.name,
            amount_per_craft: input.consumption_rate.amount_per_craft,
        }));
        for (let index = 0; index < takes.length; index++) {
            takes[index].inventory.removeQuantity(takes[index].item_name, takes[index].amount_per_craft);
        }
    }
}
