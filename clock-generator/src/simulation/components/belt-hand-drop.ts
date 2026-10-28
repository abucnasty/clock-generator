import { AssertionError } from "../../common/assert";
import type { TickProvider } from "../../control-logic/current-tick-provider";
import { ItemName } from "../../data";
import { Belt } from "../../entities/belt";
import type { BeltDropSpot } from "../../entities/inserter/inserter";
import type { InserterState } from "../../state/inserter-state";
import type { TransportBelt } from "../archetypes/transport-belt";
import type { BeltLane, LaneDrop } from "./belt-lane";
import { dropFromHand, HandDropPort } from "./hand";

/**
 * A belt's drop port, its lane, as one hand reaches it: one stack in a tick, on the lane of the hand's drop spot (or of
 * the held item, without one), if the lane has room for it where the stack would pass the spot (LaneTraffic); otherwise
 * the hand tries again in the next tick. The lane slots are bound at build: the lane's shared traffic for a hand with a
 * drop spot, else the hand's own local tile of each lane. A belt takes whatever a hand brings.
 */
export class BeltHandDrop implements HandDropPort {
    /** The lane of the inserter's drop spot, or each lane of its own local tile when it has none */
    private readonly lanes: readonly BeltLane[];
    /** Where the hand puts its stacks down, by lane: the lane's shared traffic, or its own local tile */
    private readonly drops: readonly LaneDrop[];
    /** Ticks a stack takes from the origin of the belt's positions to the spot, the same in every tick */
    private readonly spot_ticks: number;
    /** Whether the hand drops at a spot of the config, the same in every tick */
    private readonly at_spot: boolean;

    constructor(
        private readonly state: InserterState,
        private readonly sink: TransportBelt,
        private readonly tick_provider: TickProvider,
    ) {
        const drop = state.inserter.drop;
        this.at_spot = drop !== undefined;
        if (drop !== undefined) {
            const lane = sink.lanes[drop.lane - 1];
            this.spot_ticks = spotTicks(sink, drop);
            this.lanes = [lane];
            this.drops = [lane.sharedDrop(this.spot_ticks)];
        } else {
            const key = state.entity_id.id;
            this.spot_ticks = spotTicks(sink, { lane: 1, position: 0.5 });
            this.lanes = sink.lanes;
            this.drops = this.lanes.map(lane => lane.ownDrop(key, this.spot_ticks));
        }
    }

    public enter(): void { }

    public key(): string {
        return "";
    }

    public drop(): void {
        // A refused supply holds the hand; freely moving stock retains its own history.
        const state = this.state;
        const held_item_name = state.held_item?.item_name;
        state.trace?.record({ type: "drop_attempt", item: held_item_name });
        if (held_item_name !== undefined && this.sink.supply.refused.has(held_item_name)) {
            state.trace?.record({ type: "wait", phase: "drop", reason: "supply_refused", item: held_item_name });
            return;
        }
        this.dropOnLane();
    }

    public acceptsHand(): boolean {
        return true;
    }

    public takesAt(): boolean {
        return true;
    }

    public takes(): boolean {
        return true;
    }

    private dropOnLane(): void {
        const state = this.state;
        const held_item = state.held_item;
        if (held_item === null) {
            throw new AssertionError(`${state.entity_id} Held item should not be null when dropping off to belt`);
        }
        // the lane of the drop spot, or without one the lane of the held item, else the lane of the largest stack (a
        // known quirk, kept until after the refactor: P4 D14)
        const index = this.at_spot ? 0 : laneForDrop(this.lanes, held_item.item_name);
        const lane = this.lanes[index];
        if (lane.insert(this.drops[index], this.tick_provider.getCurrentTick(), this.spot_ticks)) {
            dropFromHand(state, lane.stack_size);
        } else {
            state.trace?.record({ type: "wait", phase: "drop", reason: "output_space", item: held_item.item_name });
        }
    }
}

/**
 * The lane a hand without a drop spot drops on: the lane of the held item if one carries it, otherwise the lane with
 * the largest stack (the first of them)
 */
function laneForDrop(lanes: readonly BeltLane[], held_item_name: ItemName): number {
    for (let index = 0; index < lanes.length; index++) {
        if (lanes[index].item === held_item_name) return index;
    }
    let max = 0;
    for (let index = 1; index < lanes.length; index++) {
        if (lanes[index].stack_size > lanes[max].stack_size) max = index;
    }
    return max;
}

/** Ticks a stack takes to travel from the origin of the belt's positions to the spot */
function spotTicks(belt_state: TransportBelt, drop: BeltDropSpot): number {
    return Belt.ticksPerTile(belt_state.belt.belt_speed).toDecimal() * drop.position;
}
