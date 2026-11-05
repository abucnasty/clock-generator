import { HandNotifications } from "./hand-notifications";
import { FactorioDataService, ItemName } from "../../data";
import { InserterStatus } from "../../state/entity-status";
import type { InserterState } from "../../state/inserter-state";
import { ContainerStorage, MixedStorage } from "./container-storage";
import { CarriedItems, HandDropPort, HandPickupPort, HandReason, HandScratch, takeIntoHand } from "./hand";

/**
 * A Container's pickup port, its storage, as one hand reaches it: a container of one item or of endless room (an infinity
 * chest) gives the item the game sorts last of those the sink takes now, as an infinity chest keeps its slots in the
 * game's inventory order and the hand takes the item of the last slot it may take (a container of mixed items is
 * `MixedContainerHandPickup`). A pickup that finds
 * nothing to take sets the inserter idle itself, with no event (same-tick rule 11). The idle rule starts a pickup where
 * the container has any of the items the hand carries, whatever the hand holds.
 */
export class ContainerHandPickup implements HandPickupPort {

    /** The items the container gives that the hand's filter lets it take: whether there is anything to take */
    private readonly offered: readonly ItemName[];

    /**
     * The hand's items by their index, the one the game sorts last in an inventory first (`itemInventoryRankOrThrow`):
     * the order in which an infinity chest's slots are tried, the last slot first
     */
    private readonly pick_order: readonly number[];

    constructor(
        protected readonly state: InserterState,
        private readonly scratch: HandScratch,
        protected readonly items: CarriedItems,
        /** The sink's drop port: whether it takes an item now */
        protected readonly sink: HandDropPort,
        protected readonly source: ContainerStorage,
        private readonly notifications: HandNotifications = new HandNotifications(),
    ) {
        // what the container gives is its config's, the same in every tick
        this.offered = source.getItemFilters().filter(item => items.lets(item));
        const indices = items.names.map((_, index) => index);
        this.pick_order = indices.length < 2 ? indices : indices
            .map(index => ({ index, rank: FactorioDataService.itemInventoryRankOrThrow(items.names[index]) }))
            .sort((a, b) => b.rank - a.rank)
            .map(it => it.index);
    }

    public enter(): void {
        this.scratch.pickup_ticks = 0;
    }

    public key(): string {
        return String(this.scratch.pickup_ticks);
    }

    /** The first item the hand carries that the container has, its reason written for the change */
    public startsPickup(): boolean {
        const names = this.items.names;
        for (let index = 0; index < names.length; index++) {
            const quantity = this.source.getCurrentQuantity(names[index]);
            if (quantity >= 1) {
                const scratch = this.scratch;
                scratch.reason = HandReason.CHEST_HAS;
                scratch.reason_item = names[index];
                scratch.reason_quantity = quantity;
                return true;
            }
        }
        return false;
    }

    public pickup(): void {
        if (!this.offersAnything()) {
            this.state.status = InserterStatus.IDLE;
            return;
        }
        this.scratch.pickup_ticks += 1;
        this.take();
    }

    private offersAnything(): boolean {
        const offered = this.offered;
        for (let index = 0; index < offered.length; index++) {
            if (this.source.has(offered[index])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Order of filtered items matters for inserter pickups from a container, at least for the simulation. A hand that
     * holds an item and takes another from a container of no slot order keeps its item and counts the other (as is).
     */
    private take(): void {
        const state = this.state;
        const source = this.source;
        const item = this.nextItem();
        if (!item) {
            return;
        }

        const held = state.held_item;
        const pickup_quantity = Math.min(
            this.items.handSizeOf(held === null ? item : held.item_name) - (held === null ? 0 : held.quantity),
            source.getCurrentQuantity(item),
        );
        if (pickup_quantity <= 0) {
            return;
        }

        takeIntoHand(state, this.scratch, item, pickup_quantity, this.notifications);
        source.take(item, pickup_quantity);
    }

    /**
     * The item the hand takes now: of those it carries that the container has and the sink takes now, the one the game
     * sorts last in an inventory (the game, Factorio 2.1.24: an advanced circuit build's inserter took electronic
     * circuits, then cable, then plastic from an infinity chest of the three and processing units)
     */
    protected nextItem(): ItemName | null {
        const names = this.items.names;
        const order = this.pick_order;
        for (let at = 0; at < order.length; at++) {
            const index = order[at];
            if (this.source.getCurrentQuantity(names[index]) > 0 && this.sink.takesAt(index)) {
                return names[index];
            }
        }
        return null;
    }
}

/**
 * The pickup port of a container of mixed items (slots, weight): it gives the item of its last slot that holds one the
 * hand takes, to a hand that holds some only more of that item (the game: a hand of 5 iron waited for iron beside a
 * stack of copper).
 */
export class MixedContainerHandPickup extends ContainerHandPickup {

    /**
     * Whether the hand takes the item of a slot (`MixedStorage.nextPickupItem`): made once at build, so that a tick
     * makes no closure
     */
    private readonly takes_from_slot: (item: ItemName) => boolean;

    constructor(
        state: InserterState,
        scratch: HandScratch,
        items: CarriedItems,
        sink: HandDropPort,
        private readonly mixed: MixedStorage,
        notifications: HandNotifications = new HandNotifications(),
    ) {
        super(state, scratch, items, sink, mixed, notifications);
        this.takes_from_slot = item => this.takesFromSlot(item);
    }

    /** The item of the last slot that holds one the hand takes */
    protected override nextItem(): ItemName | null {
        return this.mixed.nextPickupItem(this.takes_from_slot);
    }

    /** A slot's item the hand carries, the container has and the sink takes now, of the item a partly filled hand holds */
    private takesFromSlot(item: ItemName): boolean {
        const index = this.items.indexOf(item);
        if (index < 0 || !(this.source.getCurrentQuantity(item) > 0) || !this.sink.takesAt(index)) {
            return false;
        }
        const held = this.state.held_item;
        return held === null || held.item_name === item;
    }
}
