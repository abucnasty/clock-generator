import assert from "../../../../common/assert";
import { ItemName } from "../../../../data";
import { LaneTraffic } from "../../../../state/lane-traffic";
import { Belt, Lane } from "../../../../entities/belt";
import { BeltDropSpot } from "../../../../entities/inserter";
import { BeltState, InserterState } from "../../../../state";
import { TickProvider } from "../../../current-tick-provider";
import { InserterTransferLogic } from "../transfer-logic";
import { removeFromHand } from "../transfer-helpers";

export class BeltDropLogic implements InserterTransferLogic {
    private readonly local_traffic?: LaneTraffic[];

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: BeltState,
        private readonly tick_provider: TickProvider,
    ) {
        const drop = inserter_state.inserter.drop;
        if (drop !== undefined) {
            sink_entity_state.lane_traffic[drop.lane - 1].registerSpot(this.spotTicks(sink_entity_state, drop));
        } else {
            const key = inserter_state.entity_id.id;
            let traffic = sink_entity_state.drop_lanes.get(key);
            if (!traffic) {
                traffic = sink_entity_state.belt.lanes.map(() => new LaneTraffic(sink_entity_state.belt.belt_speed));
                sink_entity_state.drop_lanes.set(key, traffic);
            }
            this.local_traffic = traffic;
            this.local_traffic.forEach(lane => lane.registerSpot(this.spotTicks(sink_entity_state, {lane: 1, position: 0.5})));
        }
    }

    public onEnter(): void {}

    public stateKey(): string {
        return "";
    }

    public executeForTick(): void {
        // A refused supply holds the hand; freely moving stock retains its own history.
        const held_item_name = this.inserter_state.held_item?.item_name;
        this.inserter_state.trace?.record({type: "drop_attempt", item: held_item_name});
        if (held_item_name !== undefined && this.sink_entity_state.supply.refused.has(held_item_name)) {
            this.inserter_state.trace?.record({type: "wait", phase: "drop", reason: "supply_refused", item: held_item_name});
            return;
        }
        this.dropOffToBelt(this.sink_entity_state, this.inserter_state);
    }

    /**
     * Select the lane to use for dropping items.
     * Prefers the lane matching the held item's ingredient_name if found,
     * otherwise returns the lane with the maximum stack_size.
     */
    private selectLaneForDrop(lanes: readonly Lane[], heldItemName: ItemName): Lane {
        // Try to find a lane matching the held item
        const matchingLane = lanes.find(lane => lane.ingredient_name === heldItemName);
        if (matchingLane) {
            return matchingLane;
        }

        // Fallback: return the lane with the maximum stack size
        return lanes.reduce((maxLane, lane) =>
            lane.stack_size > maxLane.stack_size ? lane : maxLane
        );
    }

    private dropOffToBelt(belt_state: BeltState, inserter_state: InserterState): void {
        const held_item = inserter_state.held_item;
        assert(
            held_item !== null,
            `${inserter_state.entity_id} Held item should not be null when dropping off to belt`
        );

        const belt = belt_state.belt;
        const drop = inserter_state.inserter.drop;
        if (drop !== undefined) {
            this.dropOffToLane(belt_state, drop, inserter_state);
            return;
        }
        const lane = this.selectLaneForDrop(belt.lanes, held_item.item_name);
        const traffic = this.local_traffic![belt.lanes.indexOf(lane)];
        if (traffic.tryPlace(this.tick_provider.getCurrentTick(), this.spotTicks(belt_state, {lane: 1, position: 0.5}))) {
            removeFromHand(inserter_state, lane.stack_size);
        } else {
            inserter_state.trace?.record({type: "wait", phase: "drop", reason: "output_space", item: held_item.item_name});
        }
    }

    /**
     * Drop on a lane that carries the stacks of the inserters that drop on it: one stack, in this tick, if the lane has
     * room for it where the stack would pass the spot (LaneTraffic); otherwise the hand tries again in the next tick.
     */
    private dropOffToLane(belt_state: BeltState, drop: BeltDropSpot, inserter_state: InserterState): void {
        const stack_size = belt_state.belt.lanes[drop.lane - 1].stack_size;
        const traffic = belt_state.lane_traffic[drop.lane - 1];
        if (traffic.tryPlace(this.tick_provider.getCurrentTick(), this.spotTicks(belt_state, drop))) {
            removeFromHand(inserter_state, stack_size);
        } else {
            inserter_state.trace?.record({type: "wait", phase: "drop", reason: "output_space", item: inserter_state.held_item?.item_name});
        }
    }

    /** Ticks a stack takes to travel from the origin of the belt's positions to the spot */
    private spotTicks(belt_state: BeltState, drop: BeltDropSpot): number {
        return Belt.ticksPerTile(belt_state.belt.belt_speed).toDecimal() * drop.position;
    }
}
