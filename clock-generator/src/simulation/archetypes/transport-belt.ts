import assert from "../../common/assert";
import { Belt, EntityId } from "../../entities";
import { BeltInventoryState } from "../../state/belt-inventory-state";
import { BeltPickupStock } from "../../state/belt-pickup-stock";
import type { EntityState } from "../../state/entity-state";
import { inventoryKey } from "../../state/inventory-state";
import { LaneTraffic } from "../../state/lane-traffic";
import { SupplyGate } from "../../state/supply-gate";
import { BeltLane } from "../components/belt-lane";

/**
 * A belt: one BeltLane for each of its lanes, in the order of the belt's `lanes`, and no step of its own in a tick.
 * Every hand is added to all lanes at once, so the lanes list the same inserters in the same order.
 */
export class TransportBelt implements EntityState {
    public readonly entity_id: EntityId;
    public readonly inventoryState: BeltInventoryState;
    /**
     * Items the belt does not give or take for now; nothing, unless a run cuts a supply (see SupplyGate). One gate for
     * the belt: it is kept by item, and a hand asks it before it picks a lane.
     */
    public readonly supply = new SupplyGate();
    public readonly lanes: readonly BeltLane[];

    private constructor(public readonly belt: Belt) {
        this.entity_id = belt.entity_id;
        this.inventoryState = BeltInventoryState.fromBelt(belt);
        this.lanes = belt.lanes.map(lane => new BeltLane(lane, belt.belt_speed));
    }

    public static create(belt: Belt): TransportBelt {
        return new TransportBelt(belt);
    }

    /** The stock the inserter reaches on each lane, or undefined before its hand is built or seeded */
    public pickupsOf(inserter_id: string): BeltPickupStock[] | undefined {
        if (this.lanes[0]?.pickupOf(inserter_id) === undefined) return undefined;
        return this.lanes.map(lane => lane.pickupOf(inserter_id)!.stock);
    }

    /**
     * Sets the stock the inserter reaches on each lane, keeping the slots a built hand holds: unlike the belt state's
     * map before it, a seed after the hand is built reaches that hand too
     */
    public seedPickups(inserter_id: string, stocks: readonly BeltPickupStock[]): void {
        assert(stocks.length === this.lanes.length, `A belt pickup needs a stock for each of the belt's ${this.lanes.length} lanes`);
        this.lanes.forEach((lane, index) => lane.seedPickup(inserter_id, stocks[index]));
    }

    /** The inserter's own local tile on each lane, or undefined when it drops at a spot or not on this belt */
    public dropsOf(inserter_id: string): LaneTraffic[] | undefined {
        if (this.lanes[0]?.dropOf(inserter_id) === undefined) return undefined;
        return this.lanes.map(lane => lane.dropOf(inserter_id)!);
    }

    /**
     * The belt's key (see simulationStateKey): its inventory, what its supply gate withholds and refuses, and what its
     * lanes hold: the stacks put down at the spots of each lane, then each hand's own local tiles and each hand's reach,
     * by hand in the order the hands were built and by lane in the belt's order
     */
    public stateKey(tick: number): string {
        const lanes = this.lanes;
        const traffic = lanes.map(lane => lane.trafficKey(tick)).join("|");
        const ids = (of: (lane: BeltLane) => IterableIterator<string>) => lanes.length === 0 ? [] : [...of(lanes[0])];
        const drops = ids(lane => lane.dropIds())
            .map(id => `${id}:${lanes.map(lane => lane.dropKey(id, tick)).join("|")}`);
        const pickups = ids(lane => lane.pickupIds())
            .map(id => `${id}:${lanes.map(lane => lane.pickupKey(id, tick)).join("|")}`);
        return `${inventoryKey(this.inventoryState)};${this.supply.key()};` + traffic + ";" + drops.join(";") + ";" + pickups.join(";");
    }
}
