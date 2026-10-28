import { FactorioDataService, ItemName } from "../../data";
import { directMachineStop } from "../../entities/drill/mining-drill-ext";
import type { Machine } from "../../entities/machine/machine";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import { DropBy, DropPort } from "./ports";

/** How the machine takes an item an inserter brings, decided once per item */
const SlotKind = {
    /** Only as fuel, into the fuel slot */
    FUEL: 0,
    /** As fuel while the fuel slot is below its limit, else as an ingredient (nutrients into a pentapod egg biochamber) */
    FUEL_AND_INGREDIENT: 1,
    /** Only as an ingredient */
    INGREDIENT: 2,
} as const;
type SlotKind = typeof SlotKind[keyof typeof SlotKind];

/** An ingredient's quantity where the machine keeps it, against its insertion limit */
interface InputView {
    readonly item_name: ItemName;
    readonly quantity: LiveQuantity;
    readonly limit: number;
    /** Kept apart from the output, where the recipe also makes it */
    readonly self: boolean;
}

/** A product's quantity in the output, against the count at which it blocks (see outputBlocked) */
interface OutputView {
    readonly quantity: LiveQuantity;
    readonly blocked_at: number;
}

/**
 * An item the machine takes, bound once: how it takes it, its ingredient view (null for fuel only), and the answer to
 * whether it is blocked, standing until one of the machine's inventories is written (-1: never taken)
 */
interface AskSlot {
    readonly kind: SlotKind;
    readonly input: InputView | null;
    inv: number;
    fuel: number;
    self: number;
    answer: boolean;
}

/**
 * A crafting machine's Ingress component: what it takes from an inserter's hand or a placer, and where it puts it. Its
 * passive asks (whether it takes an item, whether that is blocked now, whether it takes nothing at all, whether its
 * output is at the block) read the machine's inventories through views bound at build, which stay the machine's.
 *
 * An answer worked out from the inventories stands until one of them is written (`mutation_generation`): the same idea
 * the game sleeps its inserters on, waking them when a machine consumes or gains something. Every answer depends on the
 * inventories' quantities alone, so a memo that stands gives what asking again would.
 *
 * As a drop port: a hand puts its whole hand in, of whatever item, with no limit check (a known quirk, kept); fuel goes
 * to the fuel slot, everything else to the ingredients. A placer puts an ingredient in up to the drill's stop, never as
 * fuel, through its own view (`MachinePlacementPort`).
 */
export class Ingress implements DropPort {

    /** One per ingredient, in `machine.inputs` order (see takesNothing) */
    private readonly inputs: readonly InputView[];

    /** One per item the machine takes: each ingredient, and the fuel item */
    private readonly slots: readonly AskSlot[];

    /** The slot of each item the machine takes (see slotOf) */
    private readonly slot_of: ReadonlyMap<ItemName, number>;

    /** The fuel slot's quantity, null for a machine that burns nothing */
    private readonly fuel_quantity: LiveQuantity | null;
    private readonly fuel_item: ItemName | null;
    private readonly fuel_limit: number;

    /**
     * The main product against its block; for a machine that places its results itself, each result against its stack,
     * any one of which blocks it
     */
    private readonly output_views: readonly OutputView[];

    /** The ingredient views by item, which a placer puts into */
    private readonly input_of: ReadonlyMap<ItemName, InputView>;

    /** Per ingredient, the drill's stop a placer fills it to; bound when a placer binds (bindPlacerStops) */
    private placer_stops: ReadonlyMap<ItemName, number> | null = null;

    /** Whether the machine takes nothing at all, standing until one of its inventories is written (-1: never asked) */
    private nothing_inv = -1;
    private nothing_fuel = -1;
    private nothing_self = -1;
    private nothing_answer = false;

    constructor(
        private readonly machine: Machine,
        /** Ingredients and output */
        private readonly inventory: WritableInventoryState,
        /** The burner fuel slot */
        private readonly fuel_inventory: WritableInventoryState,
        /** Ingredients the recipe also makes, kept apart from the output */
        private readonly self_inventory: WritableInventoryState,
    ) {
        const inputs: InputView[] = [];
        for (const input of machine.inputs.values()) {
            const item_name = input.ingredient.name;
            const self = machine.self_ingredients.has(item_name);
            inputs.push({
                item_name,
                quantity: new LiveQuantity(self ? self_inventory : inventory, item_name),
                limit: input.automated_insertion_limit.quantity,
                self,
            });
        }
        this.inputs = inputs;
        this.input_of = new Map(inputs.map(input => [input.item_name, input]));

        const fuel_slot = machine.fuel_slot;
        this.fuel_item = fuel_slot === undefined ? null : fuel_slot.fuel.item_name;
        this.fuel_quantity = fuel_slot === undefined ? null : new LiveQuantity(fuel_inventory, fuel_slot.fuel.item_name);
        this.fuel_limit = fuel_slot === undefined ? 0 : fuel_slot.automated_insertion_limit;

        this.output_views = machine.metadata.places_results === true
            ? machine.outputs.map(output => ({
                quantity: new LiveQuantity(inventory, output.item_name),
                blocked_at: output.outputBlock.max_stack_size,
            }))
            : [{
                quantity: new LiveQuantity(inventory, machine.output.outputBlock.item_name),
                blocked_at: machine.output.outputBlock.ingredients_blocked_at,
            }];

        const slots: AskSlot[] = [];
        const slot_of = new Map<ItemName, number>();
        for (const input of inputs) {
            slot_of.set(input.item_name, slots.length);
            slots.push(askSlot(input.item_name === this.fuel_item ? SlotKind.FUEL_AND_INGREDIENT : SlotKind.INGREDIENT, input));
        }
        if (this.fuel_item !== null && !slot_of.has(this.fuel_item)) {
            slot_of.set(this.fuel_item, slots.length);
            slots.push(askSlot(SlotKind.FUEL, null));
        }
        this.slots = slots;
        this.slot_of = slot_of;
    }

    /**
     * Whether the machine takes the item at all: an ingredient of its recipe, or its fuel. The design's passive
     * `accepts(item)` (P4 section 2); only tests ask it for now, the simulation's readers bind `slotOf` once instead.
     */
    public takes(item: ItemName): boolean {
        return this.slot_of.has(item);
    }

    /** The slot a reader binds once for an item it asks about every tick (`blockedAt`); -1 for an item it never takes */
    public slotOf(item: ItemName): number {
        return this.slot_of.get(item) ?? -1;
    }

    /** Whether the machine takes no more of the item now (see blockedAt) */
    public blocked(item: ItemName): boolean {
        return this.blockedAt(this.slotOf(item));
    }

    /**
     * Whether the machine takes no more of the item of a slot now: always for an item it does not take; fuel goes in its
     * own slot, which neither a full output nor a full ingredient blocks; an ingredient while the output is at its block
     * or the ingredient at its insertion limit. An item that is both goes to the fuel slot while that is below its limit.
     */
    public blockedAt(slot_index: number): boolean {
        if (slot_index < 0) {
            return true;
        }
        const slot = this.slots[slot_index];
        const inv = this.inventory.mutation_generation;
        const fuel = this.fuel_inventory.mutation_generation;
        const self = this.self_inventory.mutation_generation;
        if (slot.inv === inv && slot.fuel === fuel && slot.self === self) {
            return slot.answer;
        }
        let answer: boolean;
        if (slot.kind === SlotKind.FUEL) {
            answer = !this.fuelIsBelowLimit();
        } else if (slot.kind === SlotKind.FUEL_AND_INGREDIENT && this.fuelIsBelowLimit()) {
            answer = false;
        } else {
            const input = slot.input!;
            answer = this.outputBlocked() || input.quantity.get() >= input.limit;
        }
        slot.inv = inv;
        slot.fuel = fuel;
        slot.self = self;
        slot.answer = answer;
        return answer;
    }

    /**
     * True while the machine takes no item at all from an inserter: its output is at the block or every ingredient is at
     * its insertion limit, and its fuel slot, if it burns fuel, is at its limit as well. The game shows an inserter that
     * waits to put into such a machine as waiting for space in its destination, whatever the inserter would bring; while
     * the machine still takes anything, an inserter that has nothing it takes shows as waiting for source items.
     */
    public takesNothing(): boolean {
        const inv = this.inventory.mutation_generation;
        const fuel = this.fuel_inventory.mutation_generation;
        const self = this.self_inventory.mutation_generation;
        if (this.nothing_inv === inv && this.nothing_fuel === fuel && this.nothing_self === self) {
            return this.nothing_answer;
        }
        // asked for every waiting inserter every tick: the same answer as `blocked` for each item it takes, without
        // asking item by item
        let answer = true;
        if (this.fuelIsBelowLimit()) {
            answer = false;
        } else if (!this.outputBlocked()) {
            const inputs = this.inputs;
            for (let index = 0; index < inputs.length; index++) {
                if (inputs[index].quantity.get() < inputs[index].limit) {
                    answer = false;
                    break;
                }
            }
        }
        this.nothing_inv = inv;
        this.nothing_fuel = fuel;
        this.nothing_self = self;
        this.nothing_answer = answer;
        return answer;
    }

    /**
     * Whether the machine takes no more ingredients for its output: its main product at its output block, or, for a
     * machine that places its results itself (rule 18), a stack of any one of its results waiting in its output, which
     * also stops its crafts (recorded on a recycler on scrap: a full stack of the rarest result stopped it as one of the
     * commonest did)
     */
    public outputBlocked(): boolean {
        const views = this.output_views;
        for (let index = 0; index < views.length; index++) {
            if (views[index].quantity.get() >= views[index].blocked_at) {
                return true;
            }
        }
        return false;
    }

    /**
     * How many of the `held` items it takes now: from a hand, the whole hand, whatever the item (no limit check, a known
     * quirk kept); from a placer, an ingredient up to the drill's stop (the larger of the item's stack and the
     * ingredient's insertion limit, + 64; `directMachineStop`), and nothing it does not craft with
     */
    public accepts(item: ItemName, held: number, by: DropBy): number {
        if (by === DropBy.HAND) {
            return held;
        }
        const input = this.input_of.get(item);
        if (input === undefined) {
            return 0;
        }
        const room = Math.max(0, this.placer_stops!.get(item)! - input.quantity.get());
        return Math.min(held, room);
    }

    /**
     * An inserter's drop into the machine: fuel goes to the fuel slot, everything else to the ingredients. A hand of an
     * item that is both goes whole to the fuel slot while that is below its limit, and to the ingredients otherwise.
     */
    public insert(item: ItemName, amount: number): void {
        const to_fuel = item === this.fuel_item && (!this.input_of.has(item) || this.fuelIsBelowLimit());
        const inventory = to_fuel ? this.fuel_inventory : this.ingredientInventory(item);
        inventory.addQuantity(item, amount);
    }

    /** A placer's put into the machine: an ingredient, never as fuel (accepts, by a placer, allowed it) */
    public place(item: ItemName, amount: number): void {
        this.ingredientInventory(item).addQuantity(item, amount);
    }

    /** Binds the drill's stop of each ingredient, once a placer places into the machine (its stack from the game data) */
    public bindPlacerStops(): void {
        this.placer_stops ??= new Map(this.inputs.map(input => [input.item_name,
            directMachineStop(FactorioDataService.findItemOrThrow(input.item_name).stack_size, input.limit)]));
    }

    /** Where the machine keeps an ingredient: with its output, or apart from it when the recipe also makes that item */
    public ingredientInventory(item: ItemName): WritableInventoryState {
        return this.machine.self_ingredients.has(item) ? this.self_inventory : this.inventory;
    }

    /** How many of an ingredient the machine holds to craft with */
    public ingredientQuantity(item: ItemName): number {
        return this.ingredientInventory(item).getQuantity(item);
    }

    /** How many of an item inserters have put into the machine: the ingredient, or the fuel in the fuel slot when it is only fuel */
    public quantityPutIn(item: ItemName): number {
        if (item === this.fuel_item && !this.input_of.has(item)) {
            return this.fuel_inventory.getQuantity(item);
        }
        return this.ingredientQuantity(item);
    }

    private fuelIsBelowLimit(): boolean {
        const quantity = this.fuel_quantity;
        return quantity !== null && quantity.get() < this.fuel_limit;
    }
}

function askSlot(kind: SlotKind, input: InputView | null): AskSlot {
    return { kind, input, inv: -1, fuel: -1, self: -1, answer: false };
}
