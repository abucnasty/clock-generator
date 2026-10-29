import { ItemName } from "../../data";
import { BeltSpeed, Lane } from "../../entities/belt";
import { BeltPickupStock } from "../../state/belt-pickup-stock";
import { LaneTraffic } from "../../state/lane-traffic";

/**
 * A hand's reach on one lane: the stock it can take from. The hand holds the slot from its build; a trial that seeds
 * the lane's phase before any tick replaces the stock in it.
 */
export interface LanePickup {
    stock: BeltPickupStock;
}

/** Where a hand puts its stacks down on one lane; a test that seeds the lane's stock replaces the traffic in it */
export interface LaneDrop {
    traffic: LaneTraffic;
}

/**
 * One lane of a belt, passive: the stacks hands put down on it and the stock each hand that takes from it can reach.
 * A hand binds its slots here when it is built (`sharedDrop`, `ownDrop`, `pickupOf`/`addPickup`) and goes through
 * them in a tick, so nothing is looked up by name in a tick. What the lane holds is kept when the runner replaces an
 * inserter's control (same-tick rule 12).
 */
export class BeltLane {
    public readonly item: ItemName;
    public readonly stack_size: number;
    /** The stacks inserters with a drop spot on this lane put down on it */
    private readonly shared: LaneDrop;
    /** For each inserter without a drop spot: its own local tile of this lane, kept between hands */
    private readonly drops = new Map<string, LaneDrop>();
    /** For each inserter that takes from the belt: the stock it can reach on this lane */
    private readonly pickups = new Map<string, LanePickup>();

    constructor(lane: Lane, private readonly belt_speed: BeltSpeed) {
        this.item = lane.ingredient_name;
        this.stack_size = lane.stack_size;
        this.shared = { traffic: new LaneTraffic(belt_speed) };
    }

    /** The lane's shared traffic, for a hand that drops at a spot `spot_ticks` from the origin of the belt's positions */
    public sharedDrop(spot_ticks: number): LaneDrop {
        this.shared.traffic.registerSpot(spot_ticks);
        return this.shared;
    }

    /** The inserter's own local tile of this lane, made on its first build */
    public ownDrop(inserter_id: string, spot_ticks: number): LaneDrop {
        let drop = this.drops.get(inserter_id);
        if (drop === undefined) {
            drop = { traffic: new LaneTraffic(this.belt_speed) };
            this.drops.set(inserter_id, drop);
        }
        drop.traffic.registerSpot(spot_ticks);
        return drop;
    }

    /**
     * Replaces the inserter's own local tile, in the slot its hand already holds: unlike the belt state's map before
     * it, a seed after the hand is built reaches that hand too
     */
    public seedDrop(inserter_id: string, traffic: LaneTraffic): void {
        const drop = this.drops.get(inserter_id);
        if (drop === undefined) {
            this.drops.set(inserter_id, { traffic });
        } else {
            drop.traffic = traffic;
        }
    }

    /** Puts one stack down at the spot in this tick if there is room for it (LaneTraffic) */
    public insert(drop: LaneDrop, tick: number, spot_ticks: number): boolean {
        return drop.traffic.tryPlace(tick, spot_ticks);
    }

    public pickupOf(inserter_id: string): LanePickup | undefined {
        return this.pickups.get(inserter_id);
    }

    public addPickup(inserter_id: string, stock: BeltPickupStock): LanePickup {
        const pickup = { stock };
        this.pickups.set(inserter_id, pickup);
        return pickup;
    }

    /**
     * Replaces the stock the inserter reaches, in the slot its hand already holds: unlike the belt state's map before
     * it, a seed after the hand is built reaches that hand too
     */
    public seedPickup(inserter_id: string, stock: BeltPickupStock): void {
        const pickup = this.pickups.get(inserter_id);
        if (pickup === undefined) {
            this.addPickup(inserter_id, stock);
        } else {
            pickup.stock = stock;
        }
    }

    public peek(pickup: LanePickup, tick: number): {position: number; count: number} | undefined {
        return pickup.stock.peek(tick);
    }

    public take(pickup: LanePickup, tick: number, limit: number): number {
        return pickup.stock.take(tick, limit);
    }

    public takenAt(pickup: LanePickup, tick: number): boolean {
        return pickup.stock.hasTakenAt(tick);
    }

    /** The inserters that take from this lane, in the order they were first built */
    public pickupIds(): IterableIterator<string> {
        return this.pickups.keys();
    }

    /**
     * The keys of what the lane holds, for its belt's key (see TransportBelt.stateKey): the stacks hands put down at
     * their spots, a hand's own local tile, and the stock a hand reaches. Each brings its traffic or its stock up to
     * `tick` first.
     */
    public trafficKey(tick: number): string {
        return this.shared.traffic.stateKey(tick);
    }

    /** The key of the inserter's own local tile of this lane, which it has from its first build */
    public dropKey(inserter_id: string, tick: number): string {
        return this.drops.get(inserter_id)!.traffic.stateKey(tick);
    }

    /** The key of the stock the inserter reaches on this lane, which it has from its first build */
    public pickupKey(inserter_id: string, tick: number): string {
        return this.pickups.get(inserter_id)!.stock.stateKey(tick);
    }

    public dropOf(inserter_id: string): LaneTraffic | undefined {
        return this.drops.get(inserter_id)?.traffic;
    }

    /** The inserters with a local tile of this lane, in the order they were first built */
    public dropIds(): IterableIterator<string> {
        return this.drops.keys();
    }
}
