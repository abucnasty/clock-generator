import { handSizeFor } from "../../../../entities";
import assert from "../../../../common/assert";
import { ItemName } from "../../../../data";
import { BeltState, EntityState, InserterState, InserterStatus } from "../../../../state";
import { TickProvider } from "../../../current-tick-provider";
import { actsInTheTickTheBlockIsLifted } from "../../waiting-inserter";
import { BeltPickupLane } from "../../../../state/belt-pickup-lane";
import { InserterTransferLogic } from "../transfer-logic";
import { canPickupItemForSink, recordPickup } from "../transfer-helpers";

export class BeltPickupLogic implements InserterTransferLogic {
    private current_tick = 0;

    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: BeltState,
        private readonly sinkEntityState: EntityState,
        private readonly tick_provider?: TickProvider,
    ) {
        this.pickup_lane_order = inserterState.inserter.near_lane === 2 ? [1, 0] : [0, 1];
        const pickup_length = inserterState.inserter.pickup_length;
        if (pickup_length === undefined) {
            return;
        }

        assert(tick_provider !== undefined, "Moving belt pickups need the simulation tick provider");

        // Keep this inserter's lane gaps and partial stacks when its control is replaced.
        const inserter_id = inserterState.entity_id.id;
        let pickup_lanes = sourceEntityState.pickup_lanes.get(inserter_id);
        if (pickup_lanes === undefined) {
            const belt = sourceEntityState.belt;
            pickup_lanes = belt.lanes.map(lane => new BeltPickupLane(belt.belt_speed, pickup_length, lane.stack_size));
            sourceEntityState.pickup_lanes.set(inserter_id, pickup_lanes);
        }
        this.pickup_lanes = pickup_lanes;
    }

    private readonly pickup_lanes?: BeltPickupLane[];
    private readonly pickup_lane_order: number[];

    public onEnter(from_status: InserterStatus): void {
        // a hand that starts right after a swing back lands its first stack on the usual schedule
        this.belt_grab_decided = !(
            (from_status === InserterStatus.IDLE && this.inserterState.waits_for_sink)
            || from_status === InserterStatus.WAITING_FOR_SINK
        );
        // A hand that stopped part way because the machine was at its output block goes on in the tick another
        // inserter takes the products down, when the machine finished a craft in the tick before: that craft had
        // woken the inserter already (see `actsInTheTickTheBlockIsLifted`, the rule of the game with its recorded
        // cases: 248 hands of 248 went on in that tick, 843 of 843 a tick later)
        const sink = this.sinkEntityState;
        if (from_status === InserterStatus.WAITING_FOR_SINK && EntityState.isMachine(sink) && actsInTheTickTheBlockIsLifted(sink)) {
            this.belt_grab_decided = true;
        }
        this.current_tick = 0;
    }

    /**
     * As recorded in the game, a belt inserter that waited for its machine spends a tick deciding before the first
     * stack lands in its hand, both when the hand starts after an idle wait and when it goes on after a pause in
     * the middle; the stacks after that come a tick apart. True once that tick has passed.
     */
    private belt_grab_decided: boolean = true;

    public stateKey(): string {
        return `${this.current_tick},${this.belt_grab_decided}`;
    }

    public executeForTick(): void {
        this.current_tick += 1;
        const inserter_state = this.inserterState;
        const source = this.sourceEntityState;

        const sink = this.sinkEntityState;

        if (!EntityState.isMachine(sink)) {
            throw new Error("Inserter sink is not a machine");
        }

        const held_item = inserter_state.held_item

        if (held_item) {
            // As in the game, a hand filling from a belt stops at every grab while the machine cannot take its item
            // (output at the block, or the ingredient at its insertion limit), and goes on once it can again
            if (!canPickupItemForSink(this.sinkEntityState, held_item.item_name)) {
                return;
            }
            // the item has stopped arriving (a run that cuts a supply): the hand keeps what it holds
            if (source.supply.withheld.has(held_item.item_name)) {
                return;
            }
            if (!this.belt_grab_decided) {
                this.belt_grab_decided = true;
                return;
            }
            const remaining_capacity = handSizeFor(inserter_state.inserter, held_item.item_name) - held_item.quantity;
            const pickup_quantity = this.takeFromBelt(source, held_item.item_name, remaining_capacity);

            if (pickup_quantity <= 0) {
                return;
            }

            held_item.quantity = held_item.quantity + pickup_quantity;
            recordPickup(this.inserterState, held_item.item_name, pickup_quantity);
            inserter_state.held_item = held_item;
            return;
        }

        for (const item_name of inserter_state.inserter.filtered_items) {
            if (canPickupItemForSink(this.sinkEntityState, item_name) && !source.supply.withheld.has(item_name)) {
                if (!this.belt_grab_decided) {
                    this.belt_grab_decided = true;
                    return;
                }
                const pickup_quantity = this.takeFromBelt(source, item_name, handSizeFor(inserter_state.inserter, item_name));
                if (pickup_quantity === 0) continue;
                inserter_state.held_item = { item_name: item_name, quantity: pickup_quantity };
                recordPickup(this.inserterState, item_name, pickup_quantity);
                return;
            }
        }
    }

    private takeFromBelt(source: BeltState, item: ItemName, capacity: number): number {
        const tick = this.tick_provider?.getCurrentTick();
        if (this.pickup_lanes?.some(lane => lane.hasTakenAt(tick!))) return 0;
        let matching_lane = false;
        for (const index of this.pickup_lane_order) {
            const lane = source.belt.lanes[index];
            if (!lane || lane.ingredient_name !== item) continue;
            matching_lane = true;
            const limit = Math.min(lane.stack_size, capacity);
            const quantity = this.pickup_lanes
                ? this.pickup_lanes[index].take(tick!, limit) : limit;
            // Retry the other matching lane only if this one had nothing reachable. One stack total per tick.
            if (quantity > 0) return quantity;
        }
        assert(matching_lane, `No belt lane found for item ${item}`);
        return 0;
    }
}
