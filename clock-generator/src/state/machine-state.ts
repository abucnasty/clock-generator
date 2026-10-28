import { InventoryState, WritableInventoryState } from "./inventory-state";
import { ProgressState } from "./progress-state";
import { EntityId, Machine } from "../entities";
import { EntityState } from "./entity-state";
import { Logger, defaultLogger } from "../common/logger";
import { MachineStatus } from "./entity-status";
import { BurnerEnergy } from "../simulation/components/burner-energy";
import { Energy } from "../simulation/components/energy";
import { Ingress } from "../simulation/components/ingress";
import { MachineOutputPort } from "../simulation/components/machine-output-port";
import { Placement } from "../simulation/components/placement";
import { Yield } from "../simulation/components/yield";

export class MachineState implements EntityState {

    public static forMachine = forMachine
    public static clone = clone
    public static print = printMachineState
    public static stateKey = stateKey

    /**
     * What the machine's crafts and productivity bar make, the products it holds, the carried fractions of results by
     * chance and the output room a craft needs (simulation/components)
     */
    public readonly yield: Yield;

    /**
     * What the machine takes from an inserter's hand or a placer and where it puts it, and the asks that read whether it
     * takes an item now (simulation/components)
     */
    public readonly ingress: Ingress;

    constructor(
        public readonly entity_id: EntityId,
        public readonly machine: Machine,
        public readonly craftingProgress: ProgressState,
        made: Yield,
        /** What the machine runs on, and for a burner the energy it holds (simulation/components) */
        public readonly energy: Energy,
        public readonly inventoryState: WritableInventoryState,
        /** The burner fuel slot, kept apart from the ingredients and output since the fuel can also be the product */
        public readonly fuelInventory: WritableInventoryState,
        /**
         * Ingredients that are also a product of the recipe (a pentapod egg makes pentapod eggs). The machine keeps what
         * it is given apart from what it makes, and never crafts from its own products.
         */
        public readonly selfIngredients: WritableInventoryState,
        public craftCount: number,
        public status: MachineStatus,
        public totalCrafted: number,
    ) {
        this.yield = made;
        this.ingress = new Ingress(machine, inventoryState, fuelInventory, selfIngredients);
    }

    /** The productivity bar, a view of the Yield component's for outside callers (start stock, recorders, controls) */
    public get bonusProgress(): ProgressState {
        return this.yield.bonusProgress;
    }

    /** The main product the machine holds until there is room for it, a view of the Yield component's */
    public get pendingOutput(): number {
        return this.yield.pendingOutput;
    }

    public set pendingOutput(value: number) {
        this.yield.pendingOutput = value;
    }

    /** Crafts finished and productivity bars paid out so far, a view of the Yield component's */
    public get productsFinished(): number {
        return this.yield.productsFinished;
    }

    public set productsFinished(value: number) {
        this.yield.productsFinished = value;
    }

    /**
     * Crafts started so far: the times the machine took the ingredients of a craft out of its inventory. The
     * simulation reads only whether it grew in the machine's last tick (`startedCraftInLastTick`); the rule count of
     * the inserter cost series reads it to check the starts it infers from `productsFinished` and the working status
     * (see crafting/rule-count.ts).
     */
    public craftsStarted: number = 0;

    /**
     * What a machine that places its results itself (rule 18) puts from its output into its result target, bound to the
     * target when its state machine is built (simulation/components). Its `results_placed` counts what it placed where
     * inserters take them: into its result target, or into its own output where it has none. A tick in which it grew
     * woke the inserters waiting there for items (recorded on a recycler on scrap: a stack inserter waiting with a part
     * hand was woken by every result put in, of whatever item, and by no craft that gave none). Always 0 for any other
     * machine, whose finishes wake them.
     */
    public readonly placement: Placement = new Placement(new MachineOutputPort(this.inventoryState),
        this.machine.outputs.map(output => output.item_name), this.machine.metadata.places_results === true);

    /**
     * Whether the main product was at the output block when the machine's last tick was done. Inserters are updated
     * before machines, so an inserter that finds this set and the block gone knows that another inserter took the
     * products down in the tick it is in.
     */
    public outputBlockedAfterLastTick: boolean = false;

    /** Whether the machine finished a craft in its last tick, which wakes the inserters that wait on it */
    public finishedCraftInLastTick: boolean = false;

    /**
     * Whether the machine started a craft in its last tick, taking its ingredients: what wakes the inserters waiting
     * to put into it (docs/wake-ups.md)
     */
    public startedCraftInLastTick: boolean = false;

    /**
     * Where the last built of the deciders stands (`decider_build_order`) whose inserters took the machine's products
     * in this tick in the first tick of their window of a clock of the game; -1 for such an inserter whose decider is
     * not known, null when none took them so. Set by those inserters, which are updated before the inserters that put
     * into the machine, and cleared after the machine's tick. An inserter whose window opens in this tick too takes
     * its first items in it only when that decider was built after its own (`wokenThisTick`).
     */
    public windowOpeningTakeDecider: number | null = null;

    public toString(): string {
        return `MachineState(${this.entity_id},recipe=${this.machine.metadata.recipe.name},status=${this.status})`;
    }
}

function forMachine(machine: Machine): MachineState {
    const inventoryState = InventoryState.createFromMachineInputs(machine.inputs);
    machine.outputs.forEach(output => inventoryState.addQuantity(output.item_name, 0));
    const fuelInventory = InventoryState.empty();
    if (machine.fuel_slot) {
        fuelInventory.addQuantity(machine.fuel_slot.fuel.item_name, 0);
    }
    const state = new MachineState(
        machine.entity_id,
        machine,
        ProgressState.empty(),
        new Yield(machine, inventoryState),
        Energy.of(machine, fuelInventory),
        inventoryState,
        fuelInventory,
        InventoryState.empty(),
        0,
        MachineStatus.INGREDIENT_SHORTAGE,
        0,
    );
    // a recipe that makes its own ingredient cannot start from nothing: the machine begins with as much of it as
    // inserters would fill it up to, like the eggs a player puts in a pentapod egg biochamber by hand
    machine.looping_ingredients.forEach(item_name =>
        state.selfIngredients.addQuantity(item_name, machine.inputs.getOrThrow(item_name).automated_insertion_limit.quantity));
    return state;
}

function clone(machineState: MachineState): MachineState {
    const fuelInventory = machineState.fuelInventory.clone();
    const inventoryState = machineState.inventoryState.clone();
    const cloned = new MachineState(
        machineState.entity_id,
        machineState.machine,
        ProgressState.clone(machineState.craftingProgress),
        machineState.yield.clone(inventoryState),
        machineState.energy.clone(fuelInventory),
        inventoryState,
        fuelInventory,
        machineState.selfIngredients.clone(),
        machineState.craftCount,
        machineState.status,
        machineState.totalCrafted,
    );
    cloned.craftsStarted = machineState.craftsStarted;
    // a snapshot's Placement keeps the count and how it counts, unbound: it never places into the live target
    cloned.placement.copyCountFrom(machineState.placement);
    cloned.outputBlockedAfterLastTick = machineState.outputBlockedAfterLastTick;
    cloned.finishedCraftInLastTick = machineState.finishedCraftInLastTick;
    cloned.startedCraftInLastTick = machineState.startedCraftInLastTick;
    return cloned;
}

/**
 * What drives the machine's next ticks besides its inventory (see simulationStateKey). The running totals only grow,
 * so they never repeat.
 */
function stateKey(machineState: MachineState): string {
    return [
        machineState.status,
        machineState.yield.pendingOutput,
        machineState.outputBlockedAfterLastTick,
        machineState.finishedCraftInLastTick,
        machineState.startedCraftInLastTick,
        JSON.stringify(machineState.selfIngredients.export()),
        machineState.craftingProgress.progress,
        machineState.yield.bonusProgress.progress,
        // a burner's future hangs on what is burning and what the fuel slot holds, which no other key carries: the
        // energy left in the burning item and the energy held, "0;0" for a machine that burns nothing
        machineState.energy.stateKey(),
        JSON.stringify(Object.entries(machineState.fuelInventory.export()).sort(([a], [b]) => a.localeCompare(b))),
        // fractions of a result by chance carried toward the next whole item
        machineState.yield.carryKey(),
    ].join(";");
}

function printMachineState(machineState: MachineState, logger: Logger = defaultLogger): void {
    logger.log(`Machine ${machineState.entity_id}: (recipe = ${machineState.machine.metadata.recipe.name})`);
    logger.log(`  Status: ${machineState.status}`);
    logger.log(`  Craft Count: ${machineState.craftCount}`);
    logger.log(`  Total Crafted: ${machineState.totalCrafted}`);
    logger.log(`  Crafting Progress: ${machineState.craftingProgress.progress}`);
    logger.log(`  Bonus Progress: ${machineState.bonusProgress.progress}`);
    const energy = machineState.energy;
    if (energy instanceof BurnerEnergy) {
        logger.log(`  Fuel Burning: ${energy.energy_remaining_mj} MJ left in the burning ${energy.fuel_slot.fuel.item_name}`);
    }
    logger.log(`  Inventory State:`);
    for (const inventory_item of machineState.inventoryState.getAllItems()) {
        logger.log(`    ${inventory_item.item_name}: ${inventory_item.quantity}`);
    }
    for (const inventory_item of machineState.selfIngredients.getAllItems()) {
        logger.log(`    ${inventory_item.item_name} (ingredient): ${inventory_item.quantity}`);
    }
    for (const fuel_item of machineState.fuelInventory.getAllItems()) {
        logger.log(`  Fuel Inventory: ${fuel_item.item_name}: ${fuel_item.quantity}`);
    }
}