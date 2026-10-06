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
    return new MachineState(
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
}

function clone(machineState: MachineState): MachineState {
    return new MachineState(
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
    )
}

/** An inserter's drop into a machine: fuel goes to the fuel slot, everything else to the ingredients */
function insertItem(machineState: MachineState, itemName: string, quantity: number): void {
    const inventory = isFuel(machineState.machine, itemName) ? machineState.fuelInventory : machineState.inventoryState;
    inventory.addQuantity(itemName, quantity);
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

    // fuel goes in its own slot, which a full output does not block
    if (machine.fuel_slot && isFuel(machine, ingredientName)) {
        return machineState.fuelInventory.getQuantity(ingredientName) >= machine.fuel_slot.automated_insertion_limit;
    }

    if (machineIsOutputBlocked(machineState)) {
        return true;
    }

    const input = machine.inputs.getOrThrow(ingredientName);
    const currentQuantity = machineState.inventoryState.getQuantity(input.ingredient.name);

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
    for (const fuel_item of machineState.fuelInventory.getAllItems()) {
        logger.log(`  Fuel Inventory: ${fuel_item.item_name}: ${fuel_item.quantity}`);
    }
}