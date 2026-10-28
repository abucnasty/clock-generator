import { InventoryState, LiveQuantity, WritableInventoryState } from "./inventory-state";
import { ProgressState } from "./progress-state";
import { EntityId, Machine } from "../entities";
import { EntityState } from "./entity-state";
import { Logger, defaultLogger } from "../common/logger";
import { MachineStatus } from "./entity-status";
import { BurnerEnergy } from "../simulation/components/burner-energy";
import { Energy } from "../simulation/components/energy";
import { MachineOutputPort } from "../simulation/components/machine-output-port";
import { Placement } from "../simulation/components/placement";

export class MachineState implements EntityState {

    public static forMachine = forMachine
    public static clone = clone
    public static machineInputIsBlocked = machineInputIsBlocked
    public static machineIsOutputBlocked = machineIsOutputBlocked
    public static takesNothing = takesNothing
    public static machineAcceptsItem = machineAcceptsItem
    public static inputBlockedAskOf = inputBlockedAskOf
    public static insertItem = insertItem
    public static insertableQuantity = insertableQuantity
    public static ingredientInventory = ingredientInventory
    public static ingredientQuantity = ingredientQuantity
    public static print = printMachineState
    public static stateKey = stateKey

    constructor(
        public readonly entity_id: EntityId,
        public readonly machine: Machine,
        public readonly craftingProgress: ProgressState,
        public readonly bonusProgress: ProgressState,
        /** What the machine runs on, and for a burner the energy it holds (simulation/components) */
        public readonly energy: Energy,
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
     * Crafts finished and productivity bars paid out so far, as the game counts a machine's `products_finished`:
     * one for each, whatever amount it makes.
     */
    public productsFinished: number = 0;

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

    /**
     * Ingredients that are also a product of the recipe (a pentapod egg makes pentapod eggs). The machine keeps what
     * it is given apart from what it makes, and never crafts from its own products.
     */
    public selfIngredients: WritableInventoryState = InventoryState.empty();

    public toString(): string {
        return `MachineState(${this.entity_id},recipe=${this.machine.metadata.recipe.name},status=${this.status})`;
    }
}

/**
 * Live inventory records the per-tick questions read without a map lookup, fetched on first use. Caches only: they
 * mirror what the inventories already hold, and a clone starts over with its own. Kept under a symbol so serialized
 * states and state keys do not see them. A view is only built once every record it needs has its slot (zero counts);
 * until then the questions fall back to `getQuantity`, which answers a missing slot with 0.
 */
const HOT_VIEWS = Symbol("machine-state hot views");

/**
 * An answer worked out from the machine's inventories, standing until one of them is written: the same idea the game
 * sleeps its inserters on, waking them when a machine consumes or gains something.
 */
interface UntilWritten {
    inv: number;
    fuel: number;
    self: number;
    answer: boolean;
}

interface HotViews {
    output: { quantity: LiveQuantity; blocked_at: number } | null;
    /** Of a machine that places its results itself: one per result, against its stack (see machineIsOutputBlocked) */
    results: { quantity: LiveQuantity; blocked_at: number }[] | null;
    fuel: { quantity: LiveQuantity; limit: number } | null;
    /** One per ingredient, in `machine.inputs` order, against its insertion limit (see takesNothing) */
    inputs: { quantity: LiveQuantity; limit: number }[] | null;
    /** The same views by ingredient name (see machineInputIsBlocked) */
    inputs_by_name: Map<string, { quantity: LiveQuantity; limit: number }> | null;
    takes_nothing: UntilWritten | null;
}

function hotViewsOf(machineState: MachineState): HotViews {
    type WithViews = MachineState & { [HOT_VIEWS]?: HotViews };
    return (machineState as WithViews)[HOT_VIEWS] ??= { output: null, results: null, fuel: null, inputs: null, inputs_by_name: null, takes_nothing: null };
}

/** Whether the memo still stands, i.e. none of the machine's inventories was written since it was taken */
function stands(memo: UntilWritten | null, machineState: MachineState): memo is UntilWritten {
    return memo !== null
        && memo.inv === machineState.inventoryState.mutation_generation
        && memo.fuel === machineState.fuelInventory.mutation_generation
        && memo.self === machineState.selfIngredients.mutation_generation;
}

function take(memo: UntilWritten | null, machineState: MachineState, answer: boolean): UntilWritten {
    const inv = machineState.inventoryState.mutation_generation;
    const fuel = machineState.fuelInventory.mutation_generation;
    const self = machineState.selfIngredients.mutation_generation;
    if (memo === null) {
        return { inv, fuel, self, answer };
    }
    memo.inv = inv;
    memo.fuel = fuel;
    memo.self = self;
    memo.answer = answer;
    return memo;
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
        Energy.of(machine, fuelInventory),
        new Map(),
        inventoryState,
        fuelInventory,
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
    const cloned = new MachineState(
        machineState.entity_id,
        machineState.machine,
        ProgressState.clone(machineState.craftingProgress),
        ProgressState.clone(machineState.bonusProgress),
        machineState.energy.clone(fuelInventory),
        new Map(machineState.byProductCarry),
        machineState.inventoryState.clone(),
        fuelInventory,
        machineState.craftCount,
        machineState.status,
        machineState.totalCrafted,
    );
    cloned.pendingOutput = machineState.pendingOutput;
    cloned.productsFinished = machineState.productsFinished;
    cloned.craftsStarted = machineState.craftsStarted;
    // a snapshot's Placement keeps the count and how it counts, unbound: it never places into the live target
    cloned.placement.copyCountFrom(machineState.placement);
    cloned.outputBlockedAfterLastTick = machineState.outputBlockedAfterLastTick;
    cloned.finishedCraftInLastTick = machineState.finishedCraftInLastTick;
    cloned.startedCraftInLastTick = machineState.startedCraftInLastTick;
    cloned.selfIngredients = machineState.selfIngredients.clone();
    return cloned;
}

/**
 * What drives the machine's next ticks besides its inventory (see simulationStateKey). The running totals only grow,
 * so they never repeat.
 */
function stateKey(machineState: MachineState): string {
    return [
        machineState.status,
        machineState.pendingOutput,
        machineState.outputBlockedAfterLastTick,
        machineState.finishedCraftInLastTick,
        machineState.startedCraftInLastTick,
        JSON.stringify(machineState.selfIngredients.export()),
        machineState.craftingProgress.progress,
        machineState.bonusProgress.progress,
        // a burner's future hangs on what is burning and what the fuel slot holds, which no other key carries: the
        // energy left in the burning item and the energy held, "0;0" for a machine that burns nothing
        machineState.energy.stateKey(),
        JSON.stringify(Object.entries(machineState.fuelInventory.export()).sort(([a], [b]) => a.localeCompare(b))),
        // fractions of a by-product carried toward the next whole item
        JSON.stringify(Array.from(machineState.byProductCarry).sort(([a], [b]) => a.localeCompare(b))),
    ].join(";");
}

/** Where a machine keeps an ingredient: with its output, or apart from it when the recipe also makes that item */
function ingredientInventory(machineState: MachineState, itemName: string): WritableInventoryState {
    return machineState.machine.self_ingredients.has(itemName) ? machineState.selfIngredients : machineState.inventoryState;
}

/** How many of an ingredient the machine holds to craft with */
function ingredientQuantity(machineState: MachineState, itemName: string): number {
    return ingredientInventory(machineState, itemName).getQuantity(itemName);
}

function fuelIsBelowLimit(machineState: MachineState): boolean {
    const slot = machineState.machine.fuel_slot;
    if (slot === undefined) {
        return false;
    }
    const views = hotViewsOf(machineState);
    const view = views.fuel ??= {
        quantity: new LiveQuantity(machineState.fuelInventory, slot.fuel.item_name),
        limit: slot.automated_insertion_limit,
    };
    return view.quantity.get() < view.limit;
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

    const view = inputViewsOf(machineState).by_name.get(ingredientName);
    if (view === undefined) {
        const input = machine.inputs.getOrThrow(ingredientName);
        return ingredientQuantity(machineState, input.ingredient.name) >= input.automated_insertion_limit.quantity;
    }
    return view.quantity.get() >= view.limit;
}

/**
 * The per-tick form of `machineInputIsBlocked` for one item: the classification of the item, which never changes, is
 * done once, and the ask reads the live views. The answers match `machineInputIsBlocked` ask for ask.
 */
function inputBlockedAskOf(machineState: MachineState, ingredientName: string): () => boolean {
    const machine = machineState.machine;
    if (!machineAcceptsItem(machineState, ingredientName)) {
        return () => true;
    }
    const fuel = isFuel(machine, ingredientName);
    const memoized = (blocked: () => boolean): () => boolean => {
        let memo: UntilWritten | null = null;
        return () => {
            if (stands(memo, machineState)) {
                return memo.answer;
            }
            memo = take(memo, machineState, blocked());
            return memo.answer;
        };
    };
    if (fuel && !machine.inputs.has(ingredientName)) {
        // fuel goes in its own slot, which neither a full output nor a full ingredient blocks
        return memoized(() => !fuelIsBelowLimit(machineState));
    }
    const view = inputViewsOf(machineState).by_name.get(ingredientName);
    if (view === undefined) {
        // an input the views do not know (never the case for a config-built machine): ask the long way
        return () => machineInputIsBlocked(machineState, ingredientName);
    }
    if (fuel) {
        return memoized(() => fuelIsBelowLimit(machineState) ? false
            : machineIsOutputBlocked(machineState) || view.quantity.get() >= view.limit);
    }
    return memoized(() => machineIsOutputBlocked(machineState) || view.quantity.get() >= view.limit);
}

/** The ingredient quantities and insertion limits of the per-tick questions, set up once */
function inputViewsOf(machineState: MachineState): { list: { quantity: LiveQuantity; limit: number }[]; by_name: Map<string, { quantity: LiveQuantity; limit: number }> } {
    const views = hotViewsOf(machineState);
    if (views.inputs === null) {
        const entries = Array.from(machineState.machine.inputs.values(), input => [input.ingredient.name, {
            quantity: new LiveQuantity(ingredientInventory(machineState, input.ingredient.name), input.ingredient.name),
            limit: input.automated_insertion_limit.quantity,
        }] as const);
        views.inputs = entries.map(([, view]) => view);
        views.inputs_by_name = new Map(entries);
    }
    return { list: views.inputs, by_name: views.inputs_by_name! };
}

/**
 * True while the machine takes no item at all from an inserter: its output is at the block or every ingredient is at
 * its insertion limit, and its fuel slot, if it burns fuel, is at its limit as well. The game shows an inserter that
 * waits to put into such a machine as waiting for space in its destination, whatever the inserter would bring; while
 * the machine still takes anything, an inserter that has nothing it takes shows as waiting for source items.
 */
function takesNothing(machineState: MachineState): boolean {
    const views = hotViewsOf(machineState);
    if (stands(views.takes_nothing, machineState)) {
        return views.takes_nothing.answer;
    }
    const machine = machineState.machine;
    // asked for every waiting inserter every tick: the same answer as machineInputIsBlocked for each item it takes,
    // without asking item by item
    let answer = true;
    if (machine.fuel_slot && fuelIsBelowLimit(machineState)) {
        answer = false;
    } else if (!machineIsOutputBlocked(machineState)) {
        const list = inputViewsOf(machineState).list;
        for (let index = 0; index < list.length; index++) {
            if (list[index].quantity.get() < list[index].limit) {
                answer = false;
                break;
            }
        }
    }
    views.takes_nothing = take(views.takes_nothing, machineState, answer);
    return answer;
}

/**
 * Whether the machine takes no more ingredients for its output: its main product at its output block, or, for a machine
 * that places its results itself (rule 18), a stack of any one of its results waiting in its output, which also stops its
 * crafts (recorded on a recycler on scrap: a full stack of the rarest result stopped it as one of the commonest did)
 */
function machineIsOutputBlocked(machineState: MachineState): boolean {
    const views = hotViewsOf(machineState);
    if (machineState.machine.metadata.places_results === true) {
        const results = views.results ??= machineState.machine.outputs.map(output => ({
            quantity: new LiveQuantity(machineState.inventoryState, output.item_name),
            blocked_at: output.outputBlock.max_stack_size,
        }));
        for (const result of results) {
            if (result.quantity.get() >= result.blocked_at) {
                return true;
            }
        }
        return false;
    }
    const view = views.output ??= {
        quantity: new LiveQuantity(machineState.inventoryState, machineState.machine.output.outputBlock.item_name),
        blocked_at: machineState.machine.output.outputBlock.ingredients_blocked_at,
    };
    return view.quantity.get() >= view.blocked_at;
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