import { pickupTargetRadius } from "../../../../common/belt-pickup-layout";
import { BeltPickupArm } from "../../../../state/belt-pickup-arm";
import { handSizeFor } from "../../../../entities";
import assert from "../../../../common/assert";
import { FactorioDataService, ItemName } from "../../../../data";
import { BeltState, EntityState, InserterState, InserterStatus } from "../../../../state";
import { TickProvider } from "../../../current-tick-provider";
import { actsInTheTickTheBlockIsLifted, wokenByItsMachinesCraftStart } from "../../waiting-inserter";
import { BeltPickupLane } from "../../../../state/belt-pickup-lane";
import { BackedUpPickupLane } from "../../../../state/backed-up-pickup-lane";
import { BeltPickupStock } from "../../../../state/belt-pickup-stock";
import { InserterTransferLogic } from "../transfer-logic";
import { canPickupItemForSink, recordPickup } from "../transfer-helpers";

export class BeltPickupLogic implements InserterTransferLogic {

    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: BeltState,
        private readonly sinkEntityState: EntityState,
        private readonly tick_provider?: TickProvider,
    ) {
        this.pickup_lane_order = inserterState.inserter.near_lane === 2 ? [1, 0] : [0, 1];
        const pickup_length = inserterState.inserter.pickup_length;
        assert(pickup_length !== undefined, "Belt pickups need pickup geometry");
        assert(inserterState.inserter.belt_supply !== undefined, "Belt pickups need a supply setting");
        assert(tick_provider !== undefined, "Belt pickups need the simulation tick provider");

        // Keep this inserter's lane gaps and partial stacks when its control is replaced.
        const inserter_id = inserterState.entity_id.id;
        let pickup_lanes = sourceEntityState.pickup_lanes.get(inserter_id);
        if (pickup_lanes === undefined) {
            const belt = sourceEntityState.belt;
            pickup_lanes = belt.lanes.map(lane => inserterState.inserter.belt_supply === "backed_up"
                ? new BackedUpPickupLane(belt.belt_speed, pickup_length, lane.stack_size)
                : new BeltPickupLane(belt.belt_speed, pickup_length, lane.stack_size, 0));
            sourceEntityState.pickup_lanes.set(inserter_id, pickup_lanes);
        }
        this.pickup_lanes = pickup_lanes;
        const metadata = inserterState.inserter.metadata;
        // Other prototypes and qualities remain separate calibrations.
        if (metadata.type === "stack-inserter" && metadata.quality === "legendary") {
            assert(inserterState.inserter.pickup_layout !== undefined || pickup_length === 1, "Underground pickups need an explicit layout");
            const extension = FactorioDataService.findInserterOrThrow(metadata.type).extension_speed
                * (1 + 0.3 * FactorioDataService.findQualityOrThrow(metadata.quality).level) * 256;
            this.arm = inserterState.pickup_arm ??= new BeltPickupArm(extension);
        }
    }

    private readonly arm?: BeltPickupArm;
    private readonly pickup_lanes: BeltPickupStock[];
    private readonly pickup_lane_order: number[];

    public onEnter(from_status: InserterStatus): void {
        const waited_in_idle = from_status === InserterStatus.IDLE && this.inserterState.waits_for_sink;
        // a hand that starts right after a swing back lands its first stack on the usual schedule
        this.belt_grab_decided = !(waited_in_idle || from_status === InserterStatus.WAITING_FOR_SINK);
        // A hand that stopped part way because the machine was at its output block goes on in the tick another
        // inserter takes the products down, when the machine finished a craft in the tick before: that craft had
        // woken the inserter already (see `actsInTheTickTheBlockIsLifted`, the rule of the game with its recorded
        // cases: 248 hands of 248 went on in that tick, 843 of 843 a tick later)
        const sink = this.sinkEntityState;
        if (from_status === InserterStatus.WAITING_FOR_SINK && EntityState.isMachine(sink) && actsInTheTickTheBlockIsLifted(sink)) {
            this.belt_grab_decided = true;
        }
        // A hand that waited for room the machine made by starting a craft finds it a tick after the start, which is
        // the tick the game takes its first stack in (see `wokenByItsMachinesCraftStart`)
        if (waited_in_idle && EntityState.isMachine(sink) && wokenByItsMachinesCraftStart(sink)) {
            this.belt_grab_decided = true;
        }
    }

    /**
     * As recorded in the game, a belt inserter that waited for its machine to have its products taken spends a tick
     * deciding before the first stack lands in its hand, both when the hand starts after an idle wait and when it goes
     * on after a pause in the middle; the stacks after that come a tick apart. True once that tick has passed.
     */
    private belt_grab_decided: boolean = true;

    public stateKey(): string {
        return `${this.belt_grab_decided}`;
    }

    public executeForTick(): void {
        const inserter_state = this.inserterState;
        const source = this.sourceEntityState;

        const sink = this.sinkEntityState;

        if (!EntityState.isMachine(sink)) {
            throw new Error("Inserter sink is not a machine");
        }

        const held_item = inserter_state.held_item
        inserter_state.trace?.record({type: "pickup_attempt", item: held_item?.item_name});

        if (held_item) {
            // As in the game, a hand filling from a belt stops at every grab while the machine cannot take its item
            // (output at the block, or the ingredient at its insertion limit), and goes on once it can again
            if (!canPickupItemForSink(this.sinkEntityState, held_item.item_name)) {
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "destination_refused", item: held_item.item_name});
                return;
            }
            // the item has stopped arriving (a run that cuts a supply): the hand keeps what it holds
            if (source.supply.withheld.has(held_item.item_name)) {
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "supply_withheld", item: held_item.item_name});
                return;
            }
            if (!this.belt_grab_decided) {
                this.belt_grab_decided = true;
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "pickup_decision", item: held_item.item_name});
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

        const items = inserter_state.inserter.filtered_items;
        let has_items = false;
        for (const item_name of items) {
            has_items = true;
            if (!canPickupItemForSink(this.sinkEntityState, item_name)) {
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "destination_refused", item: item_name});
                continue;
            }
            if (source.supply.withheld.has(item_name)) {
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "supply_withheld", item: item_name});
                continue;
            }
            if (!this.belt_grab_decided) {
                this.belt_grab_decided = true;
                inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "pickup_decision", item: item_name});
                return;
            }
            const pickup_quantity = this.takeFromBelt(source, item_name, handSizeFor(inserter_state.inserter, item_name));
            if (pickup_quantity === 0) continue;
            inserter_state.held_item = { item_name: item_name, quantity: pickup_quantity };
            recordPickup(this.inserterState, item_name, pickup_quantity);
            return;
        }
        if (!has_items) inserter_state.trace?.record({type: "wait", phase: "pickup", reason: "no_eligible_item"});
    }

    private takeFromBelt(source: BeltState, item: ItemName, capacity: number): number {
        if (capacity <= 0) return 0;
        const tick = this.tick_provider?.getCurrentTick();
        if (this.pickup_lanes.some(lane => lane.hasTakenAt(tick!))) {
            this.inserterState.trace?.record({type: "wait", phase: "pickup", reason: "already_collected_this_tick", item});
            return 0;
        }
        let matching_lane = false;
        for (const index of this.pickup_lane_order) {
            const lane = source.belt.lanes[index];
            if (!lane || lane.ingredient_name !== item) continue;
            matching_lane = true;
            if (this.arm) {
                const stack = this.pickup_lanes[index].peek(tick!);
                if (!stack) continue;
                const layout = this.inserterState.inserter.pickup_layout ?? "side-straight";
                const target = pickupTargetRadius(layout, this.inserterState.inserter.near_lane ?? 1, index + 1, stack.position);
                if (!this.arm.tryCollect(tick!, target, this.inserterState.held_item === null)) {
                    this.inserterState.trace?.record({type: "wait", phase: "pickup", reason: "arm_travel", item});
                    return 0; // Reachable preferred stock remains the target; do not remove it or switch lanes while travelling.
                }
            }
            const limit = Math.min(lane.stack_size, capacity);
            const quantity = this.pickup_lanes[index].take(tick!, limit);
            // Retry the other matching lane only if this one had nothing reachable. One stack total per tick.
            if (quantity > 0) {
                this.inserterState.trace?.record({type: "pickup_lane", item, lane: index + 1, fallback: index !== this.pickup_lane_order[0]});
                return quantity;
            }
        }
        assert(matching_lane, `No belt lane found for item ${item}`);
        this.inserterState.trace?.record({type: "wait", phase: "pickup", reason: "no_reachable_stack", item});
        return 0;
    }
}
