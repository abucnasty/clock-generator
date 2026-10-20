import { InventoryState, LiveQuantity, WritableInventoryState } from "./inventory-state";
import { FuelProgressState, ProgressState } from "./progress-state";
import { EntityId, Machine } from "../entities";
import { EntityState } from "./entity-state";
import { Logger, defaultLogger } from "../common/logger";
import { MachineStatus } from "./entity-status";

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
    public static takesTurnForOutput = takesTurnForOutput
    public static waitsForOutput = waitsForOutput
    public static print = printMachineState
    public static stateKey = stateKey

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
     * Whether an inserter took the machine's products in this tick in the first tick of its window of a clock of the
     * game. Set by that inserter, which is updated before the inserters that put into the machine, and cleared after
     * the machine's tick.
     */
    public productsTakenAsWindowOpened: boolean = false;

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
    /**
     * The tick that inserter was last granted its turn, with something to take, for each product in. Only read within
     * that tick, where the idle mode and the pickup of one inserter both ask for the one pickup: so left out of the
     * state key.
     */
    public readonly lastOutputTurnTick: Map<string, number> = new Map();

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
    fuel: { quantity: LiveQuantity; limit: number } | null;
    /** One per ingredient, in `machine.inputs` order, against its insertion limit (see takesNothing) */
    inputs: { quantity: LiveQuantity; limit: number }[] | null;
    /** The same views by ingredient name (see machineInputIsBlocked) */
    inputs_by_name: Map<string, { quantity: LiveQuantity; limit: number }> | null;
    takes_nothing: UntilWritten | null;
}

function hotViewsOf(machineState: MachineState): HotViews {
    type WithViews = MachineState & { [HOT_VIEWS]?: HotViews };
    return (machineState as WithViews)[HOT_VIEWS] ??= { output: null, fuel: null, inputs: null, inputs_by_name: null, takes_nothing: null };
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
    cloned.productsFinished = machineState.productsFinished;
    cloned.craftsStarted = machineState.craftsStarted;
    cloned.outputBlockedAfterLastTick = machineState.outputBlockedAfterLastTick;
    cloned.finishedCraftInLastTick = machineState.finishedCraftInLastTick;
    cloned.startedCraftInLastTick = machineState.startedCraftInLastTick;
    cloned.selfIngredients = machineState.selfIngredients.clone();
    machineState.outputWaiters.forEach((waiters, item_name) => cloned.outputWaiters.set(item_name, new Map(waiters)));
    machineState.lastOutputTaker.forEach((inserter_id, item_name) => cloned.lastOutputTaker.set(item_name, inserter_id));
    machineState.lastOutputTurnTick.forEach((tick, item_name) => cloned.lastOutputTurnTick.set(item_name, tick));
    return cloned;
}

/**
 * What drives the machine's next ticks besides its inventory (see simulationStateKey). The running totals only grow,
 * so they never repeat.
 */
function stateKey(machineState: MachineState, tick: number): string {
    return [
        machineState.status,
        machineState.pendingOutput,
        machineState.outputBlockedAfterLastTick,
        machineState.finishedCraftInLastTick,
        machineState.startedCraftInLastTick,
        JSON.stringify(machineState.selfIngredients.export()),
        JSON.stringify(Array.from(machineState.lastOutputTaker)),
        machineState.craftingProgress.progress,
        machineState.bonusProgress.progress,
        // a burner's future hangs on what is burning and what the fuel slot holds, which no other key carries
        machineState.fuelProgress.energy_remaining_mj,
        machineState.fuelProgress.energy_buffer_mj,
        JSON.stringify(Object.entries(machineState.fuelInventory.export()).sort(([a], [b]) => a.localeCompare(b))),
        // fractions of a by-product carried toward the next whole item
        JSON.stringify(Array.from(machineState.byProductCarry).sort(([a], [b]) => a.localeCompare(b))),
        // the asks of the tick the key is of: the pass-over rule of takesTurnForOutput reads them one tick longer
        askedThisTick(machineState.outputWaiters, tick),
    ].join(";");
}

/** The inserters that asked for a product in this tick, by item: the only outputWaiters stamps the next tick reads */
function askedThisTick(outputWaiters: ReadonlyMap<string, ReadonlyMap<string, number>>, tick: number): string {
    const parts: string[] = [];
    for (const [item_name, waiters] of outputWaiters) {
        const asked = Array.from(waiters).filter(([, asked_tick]) => asked_tick === tick).map(([inserter_id]) => inserter_id);
        if (asked.length > 0) {
            parts.push(`${item_name}:${asked.sort().join(",")}`);
        }
    }
    return parts.sort().join("|");
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
 * counts it as the taker when it is, if there is anything to take: with nothing in the machine the ask leaves the
 * taker as it was. A turn granted in a tick holds for the rest of it, as the idle mode and the pickup of an inserter
 * both ask for the one pickup.
 */
function takesTurnForOutput(machineState: MachineState, itemName: string, inserter_id: string, tick: number, room_in_hand: number): boolean {
    waitsForOutput(machineState, itemName, inserter_id, tick);
    const quantity = machineState.inventoryState.getQuantity(itemName);
    if (machineState.lastOutputTaker.get(itemName) === inserter_id && machineState.lastOutputTurnTick.get(itemName) === tick) {
        return true;
    }
    // with enough for this hand, what is left over is there for the next inserter in the same tick
    const takes_it_all = quantity < room_in_hand;
    if (takes_it_all && machineState.lastOutputTaker.get(itemName) === inserter_id) {
        for (const [id, asked] of machineState.outputWaiters.get(itemName)!) {
            if (id !== inserter_id && asked >= tick - 1) {
                // another inserter waits for it
                return false;
            }
        }
    }
    if (quantity > 0) {
        machineState.lastOutputTaker.set(itemName, inserter_id);
        machineState.lastOutputTurnTick.set(itemName, tick);
    }
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

function machineIsOutputBlocked(machineState: MachineState): boolean {
    const views = hotViewsOf(machineState);
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