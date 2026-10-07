import { InventoryState, WritableInventoryState } from "./inventory-state";
import { FuelProgressState, ProgressState } from "./progress-state";
import { EntityId, Machine } from "../entities";
import { EntityState } from "./entity-state";
import { Logger, defaultLogger } from "../common/logger";

export const MachineStatus = {
    INGREDIENT_SHORTAGE: 'INGREDIENT_SHORTAGE',
    WORKING: 'WORKING',
    OUTPUT_FULL: 'OUTPUT_FULL',
} as const;

export type MachineStatus = typeof MachineStatus[keyof typeof MachineStatus];

export class MachineState implements EntityState {

    public static forMachine = forMachine
    public static clone = clone
    public static machineInputIsBlocked = machineInputIsBlocked
    public static machineIsOutputBlocked = machineIsOutputBlocked
    public static machineAcceptsItem = machineAcceptsItem
    public static insertItem = insertItem
    public static insertableQuantity = insertableQuantity
    public static ingredientInventory = ingredientInventory
    public static ingredientQuantity = ingredientQuantity
    public static takesTurnForOutput = takesTurnForOutput
    public static waitsForOutput = waitsForOutput
    public static print = printMachineState

    constructor(
        public readonly entity_id: EntityId,
        public readonly machine: Machine,
        public readonly craftingProgress: ProgressState,
        public readonly bonusProgress: ProgressState,
        public readonly fuelProgress: FuelProgressState,
        /** Fractions of a by-product made so far that do not yet add up to a whole item */
        public readonly byProductCarry: Map<string, number>,
        public readonly inventoryState: WritableInventoryState,
        /** The burner fuel slot, kept apart from the ingredients and output since the fuel can also be the product */
        public readonly fuelInventory: WritableInventoryState,
        public craftCount: number,
        public status: MachineStatus,
        public totalCrafted: number,
    ) { }

    /**
     * Main product of a finished craft that did not fit under the stack size. The machine holds it, and starts no
     * craft, until there is room for it.
     */
    public pendingOutput: number = 0;

    /**
     * Ingredients that are also a product of the recipe (a pentapod egg makes pentapod eggs). The machine keeps what
     * it is given apart from what it makes, and never crafts from its own products.
     */
    public selfIngredients: WritableInventoryState = InventoryState.empty();

    /**
     * Inserters waiting to take a product from this machine, by item and inserter id, with the tick they last asked.
     * Several inserters waiting for the same product take turns: what the machine makes goes to the one that did not
     * take last, so two inserters on a machine that makes less than a hand at a time both fill their hands.
     */
    public readonly outputWaiters: Map<string, Map<string, number>> = new Map();
    /** The inserter that last took each product, by item */
    public readonly lastOutputTaker: Map<string, string> = new Map();

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
        ProgressState.empty(),
        FuelProgressState.empty(),
        new Map(),
        inventoryState,
        fuelInventory,
        0,
        MachineStatus.INGREDIENT_SHORTAGE,
        0,
    );
    // a recipe that makes its own ingredient cannot start from nothing: the machine begins with as much of it as
    // inserters would fill it up to, like the eggs a player puts in a pentapod egg biochamber by hand
    machine.self_ingredients.forEach(item_name =>
        state.selfIngredients.addQuantity(item_name, machine.inputs.getOrThrow(item_name).automated_insertion_limit.quantity));
    return state;
}

function clone(machineState: MachineState): MachineState {
    const cloned = new MachineState(
        machineState.entity_id,
        machineState.machine,
        ProgressState.clone(machineState.craftingProgress),
        ProgressState.clone(machineState.bonusProgress),
        FuelProgressState.clone(machineState.fuelProgress),
        new Map(machineState.byProductCarry),
        machineState.inventoryState.clone(),
        machineState.fuelInventory.clone(),
        machineState.craftCount,
        machineState.status,
        machineState.totalCrafted,
    );
    cloned.pendingOutput = machineState.pendingOutput;
    cloned.selfIngredients = machineState.selfIngredients.clone();
    machineState.outputWaiters.forEach((waiters, item_name) => cloned.outputWaiters.set(item_name, new Map(waiters)));
    machineState.lastOutputTaker.forEach((inserter_id, item_name) => cloned.lastOutputTaker.set(item_name, inserter_id));
    return cloned;
}

/** Where a machine keeps an ingredient: with its output, or apart from it when the recipe also makes that item */
function ingredientInventory(machineState: MachineState, itemName: string): WritableInventoryState {
    return machineState.machine.self_ingredients.has(itemName) ? machineState.selfIngredients : machineState.inventoryState;
}

/** How many of an ingredient the machine holds to craft with */
function ingredientQuantity(machineState: MachineState, itemName: string): number {
    return ingredientInventory(machineState, itemName).getQuantity(itemName);
}

/**
 * An inserter with room for `room_in_hand` more asks to take a product from the machine this tick. When the machine
 * has less than that, inserters waiting for the same product take turns at what it makes: the one that took last is
 * passed over while another one asked this tick or the tick before. Returns whether it is this inserter's turn, and
 * counts it as the taker when it is.
 */
function takesTurnForOutput(machineState: MachineState, itemName: string, inserter_id: string, tick: number, room_in_hand: number): boolean {
    waitsForOutput(machineState, itemName, inserter_id, tick);
    // with enough for this hand, what is left over is there for the next inserter in the same tick
    const takes_it_all = machineState.inventoryState.getQuantity(itemName) < room_in_hand;
    const another_waits = Array.from(machineState.outputWaiters.get(itemName)!).some(([id, asked]) => id !== inserter_id && asked >= tick - 1);
    if (takes_it_all && another_waits && machineState.lastOutputTaker.get(itemName) === inserter_id) {
        return false;
    }
    machineState.lastOutputTaker.set(itemName, inserter_id);
    return true;
}

/** An inserter waits for a product of the machine, which the other inserters waiting for it take into account */
function waitsForOutput(machineState: MachineState, itemName: string, inserter_id: string, tick: number): void {
    const waiters = machineState.outputWaiters.get(itemName) ?? new Map<string, number>();
    machineState.outputWaiters.set(itemName, waiters);
    waiters.set(inserter_id, tick);
}

function fuelIsBelowLimit(machineState: MachineState): boolean {
    const slot = machineState.machine.fuel_slot;
    return slot !== undefined && machineState.fuelInventory.getQuantity(slot.fuel.item_name) < slot.automated_insertion_limit;
}

/**
 * An inserter's drop into a machine: fuel goes to the fuel slot, everything else to the ingredients. A hand of an
 * item that is both goes whole to the fuel slot while that is below its limit, and to the ingredients otherwise.
 */
function insertItem(machineState: MachineState, itemName: string, quantity: number): void {
    const machine = machineState.machine;
    const to_fuel = isFuel(machine, itemName) && (!machine.inputs.has(itemName) || fuelIsBelowLimit(machineState));
    const inventory = to_fuel ? machineState.fuelInventory : ingredientInventory(machineState, itemName);
    inventory.addQuantity(itemName, quantity);
}

/** How many of an item an inserter has put into a machine: the ingredient, or the fuel in the fuel slot when it is only fuel */
function insertableQuantity(machineState: MachineState, itemName: string): number {
    const machine = machineState.machine;
    if (isFuel(machine, itemName) && !machine.inputs.has(itemName)) {
        return machineState.fuelInventory.getQuantity(itemName);
    }
    return ingredientQuantity(machineState, itemName);
}

function machineAcceptsItem(machineState: MachineState, itemName: string): boolean {
    const machine = machineState.machine;

    return machine.inputs.has(itemName) || isFuel(machine, itemName);
}

function isFuel(machine: Machine, itemName: string): boolean {
    return machine.fuel_slot?.fuel.item_name === itemName;
}

function machineInputIsBlocked(machineState: MachineState, ingredientName: string): boolean {

    if (!machineAcceptsItem(machineState, ingredientName)) {
        return true;
    }

    const machine = machineState.machine;

    // fuel goes in its own slot, which neither a full output nor a full ingredient blocks
    if (isFuel(machine, ingredientName)) {
        if (fuelIsBelowLimit(machineState)) {
            return false;
        }
        if (!machine.inputs.has(ingredientName)) {
            return true;
        }
    }

    if (machineIsOutputBlocked(machineState)) {
        return true;
    }

    const input = machine.inputs.getOrThrow(ingredientName);
    const currentQuantity = ingredientQuantity(machineState, input.ingredient.name);

    return currentQuantity >= input.automated_insertion_limit.quantity;
}

function machineIsOutputBlocked(machineState: MachineState): boolean {
    const machine = machineState.machine;

    const outputBlock = machine.output.outputBlock;
    const currentQuantity = machineState.inventoryState.getQuantity(outputBlock.item_name);

    return currentQuantity >= outputBlock.quantity
}


function printMachineState(machineState: MachineState, logger: Logger = defaultLogger): void {
    logger.log(`Machine ${machineState.entity_id}: (recipe = ${machineState.machine.metadata.recipe.name})`);
    logger.log(`  Status: ${machineState.status}`);
    logger.log(`  Craft Count: ${machineState.craftCount}`);
    logger.log(`  Total Crafted: ${machineState.totalCrafted}`);
    logger.log(`  Crafting Progress: ${machineState.craftingProgress.progress}`);
    logger.log(`  Bonus Progress: ${machineState.bonusProgress.progress}`);
    if (machineState.machine.fuel_slot) {
        logger.log(`  Fuel Burning: ${machineState.fuelProgress.energy_remaining_mj} MJ left in the burning ${machineState.machine.fuel_slot.fuel.item_name}`);
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