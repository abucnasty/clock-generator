import assert from "../../../../common/assert";
import { ItemName } from "../../../../data";
import { Belt } from "../../../../entities/belt";
import { BeltDropSpot } from "../../../../entities/inserter";
import { InserterState } from "../../../../state";
import { BeltLane, LaneDrop } from "../../../../simulation/components/belt-lane";
import { TransportBelt } from "../../../../simulation/archetypes/transport-belt";
import { TickProvider } from "../../../current-tick-provider";
import { InserterTransferLogic } from "../transfer-logic";
import { removeFromHand } from "../transfer-helpers";

export class BeltDropLogic implements InserterTransferLogic {
    /** The lane of the inserter's drop spot, or each lane of its own local tile when it has none */
    private readonly lanes: readonly BeltLane[];
    /** Where the hand puts its stacks down, by lane: the lane's shared traffic, or its own local tile */
    private readonly drops: readonly LaneDrop[];
    private readonly spot_ticks: number;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: TransportBelt,
        private readonly tick_provider: TickProvider,
    ) {
        const drop = inserter_state.inserter.drop;
        if (drop !== undefined) {
            const lane = sink_entity_state.lanes[drop.lane - 1];
            this.spot_ticks = spotTicks(sink_entity_state, drop);
            this.lanes = [lane];
            this.drops = [lane.sharedDrop(this.spot_ticks)];
        } else {
            const key = inserter_state.entity_id.id;
            this.spot_ticks = spotTicks(sink_entity_state, {lane: 1, position: 0.5});
            this.lanes = sink_entity_state.lanes;
            this.drops = this.lanes.map(lane => lane.ownDrop(key, this.spot_ticks));
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
        this.dropOffToBelt(this.inserter_state);
    }

    /**
     * Select the lane to use for dropping items.
     * Prefers the lane matching the held item's ingredient_name if found,
     * otherwise returns the lane with the maximum stack_size (the first of them).
     */
    private selectLaneForDrop(lanes: readonly BeltLane[], heldItemName: ItemName): number {
        for (let index = 0; index < lanes.length; index++) {
            if (lanes[index].item === heldItemName) return index;
        }
        let max = 0;
        for (let index = 1; index < lanes.length; index++) {
            if (lanes[index].stack_size > lanes[max].stack_size) max = index;
        }
        return max;
    }

    private dropOffToBelt(inserter_state: InserterState): void {
        const held_item = inserter_state.held_item;
        assert(
            held_item !== null,
            `${inserter_state.entity_id} Held item should not be null when dropping off to belt`
        );

        // One stack, in this tick, on the lane of the drop spot (or of the held item, without one), if the lane has room
        // for it where the stack would pass the spot (LaneTraffic); otherwise the hand tries again in the next tick
        const index = inserter_state.inserter.drop !== undefined ? 0 : this.selectLaneForDrop(this.lanes, held_item.item_name);
        const lane = this.lanes[index];
        if (lane.insert(this.drops[index], this.tick_provider.getCurrentTick(), this.spot_ticks)) {
            removeFromHand(inserter_state, lane.stack_size);
        } else {
            inserter_state.trace?.record({type: "wait", phase: "drop", reason: "output_space", item: held_item.item_name});
        }
    }
}

/** Ticks a stack takes to travel from the origin of the belt's positions to the spot */
function spotTicks(belt_state: TransportBelt, drop: BeltDropSpot): number {
    return Belt.ticksPerTile(belt_state.belt.belt_speed).toDecimal() * drop.position;
}
