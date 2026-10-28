import { InventoryState, inventoryKey, WritableInventoryState } from "./inventory-state";
import { ProgressState } from "./progress-state";
import { EntityId, Machine } from "../entities";
import { EntityState } from "./entity-state";
import { Logger, defaultLogger } from "../common/logger";
import { MachineStatus } from "./entity-status";
import { BurnerEnergy } from "../simulation/components/burner-energy";
import { Crafting } from "../simulation/components/crafting";
import { Energy } from "../simulation/components/energy";
import { Ingress } from "../simulation/components/ingress";
import { MachineOutputPort } from "../simulation/components/machine-output-port";
import { MachineWakes } from "../simulation/components/machine-wakes";
import { Placement } from "../simulation/components/placement";
import { Yield } from "../simulation/components/yield";
import { craftingStatusOf, machineStatusOf } from "../simulation/status-codes";

/**
 * A crafting machine's state: its components, which the build's context keeps through control swaps, and the names
 * outside callers read and write (start stock, seeds, recorders, controls) as views of them. What the inserters read of
 * its last tick they read from its `wakes`, not from a view.
 */
export class MachineState implements EntityState {

    public static forMachine = forMachine
    public static clone = clone
    public static print = printMachineState

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

    /** The craft underway, the crafts started and finished, the status and the status rule (simulation/components) */
    public readonly crafting: Crafting;

    /** What the machine's last tick tells the inserters that wait on it (simulation/components) */
    public readonly wakes: MachineWakes = new MachineWakes();

    constructor(
        public readonly entity_id: EntityId,
        public readonly machine: Machine,
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
    ) {
        this.yield = made;
        this.ingress = new Ingress(machine, inventoryState, fuelInventory, selfIngredients);
        this.crafting = new Crafting(machine, energy, made, this.placement, this.ingress);
    }

    /** The craft underway, a view of the Crafting component's for outside callers (start stock, recorders, controls) */
    public get craftingProgress(): ProgressState {
        return this.crafting.craftingProgress;
    }

    /** Crafts finished so far, a view of the Crafting component's */
    public get craftCount(): number {
        return this.crafting.craftCount;
    }

    public set craftCount(value: number) {
        this.crafting.craftCount = value;
    }

    /** Crafts started so far, a view of the Crafting component's (see `Crafting.craftsStarted`) */
    public get craftsStarted(): number {
        return this.crafting.craftsStarted;
    }

    public set craftsStarted(value: number) {
        this.crafting.craftsStarted = value;
    }

    /** The main product put in the output so far, a view of the Crafting component's */
    public get totalCrafted(): number {
        return this.crafting.totalCrafted;
    }

    public set totalCrafted(value: number) {
        this.crafting.totalCrafted = value;
    }

    /** The status the machine shows, by the name the histories record (a view of the Crafting component's code) */
    public get status(): MachineStatus {
        return machineStatusOf(this.crafting.status);
    }

    public set status(value: MachineStatus) {
        this.crafting.status = craftingStatusOf(value);
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
     * The pickup port of the machine's output (simulation/components): what its Placement and the inserters' hands that
     * take from the machine take its results from
     */
    public readonly output: MachineOutputPort = new MachineOutputPort(this.inventoryState);

    /**
     * What a machine that places its results itself (rule 18) puts from its output into its result target, bound to the
     * target when its archetype is built (simulation/components). Its `results_placed` counts what it placed where
     * inserters take them: into its result target, or into its own output where it has none. A tick in which it grew
     * woke the inserters waiting there for items (recorded on a recycler on scrap: a stack inserter waiting with a part
     * hand was woken by every result put in, of whatever item, and by no craft that gave none). Always 0 for any other
     * machine, whose finishes wake them.
     */
    public readonly placement: Placement = new Placement(this.output,
        this.machine.outputs.map(output => output.item_name), this.machine.metadata.places_results === true);

    /**
     * What the machine's Storage holds, for the machine's key (see CraftingMachineArchetype.stateKey): its ingredients
     * and output by item, the ingredients it keeps apart from its products, and its fuel slot by item
     */
    public storageKey(): string {
        return `${inventoryKey(this.inventoryState)};${JSON.stringify(this.selfIngredients.export())};${inventoryKey(this.fuelInventory)}`;
    }

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
        new Yield(machine, inventoryState),
        Energy.of(machine, fuelInventory),
        inventoryState,
        fuelInventory,
        InventoryState.empty(),
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
        machineState.yield.clone(inventoryState),
        machineState.energy.clone(fuelInventory),
        inventoryState,
        fuelInventory,
        machineState.selfIngredients.clone(),
    );
    cloned.crafting.copyFrom(machineState.crafting);
    // a snapshot's Placement keeps the count and how it counts, unbound: it never places into the live target
    cloned.placement.copyCountFrom(machineState.placement);
    // the flags of the machine's last tick, and not the decider (a known quirk, kept until after the refactor: P4 D14)
    cloned.wakes.outputBlockedAfterLastTick = machineState.wakes.outputBlockedAfterLastTick;
    cloned.wakes.finishedCraftInLastTick = machineState.wakes.finishedCraftInLastTick;
    cloned.wakes.startedCraftInLastTick = machineState.wakes.startedCraftInLastTick;
    return cloned;
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
