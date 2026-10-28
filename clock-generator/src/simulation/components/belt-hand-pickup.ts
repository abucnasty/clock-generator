import assert from "../../common/assert";
import { BeltPickupLayout, pickupLaneLength, pickupTargetRadius } from "../../common/belt-pickup-layout";
import type { TickProvider } from "../../control-logic/current-tick-provider";
import { FactorioDataService, ItemName } from "../../data";
import { beltPickupCalibrated } from "../../entities/inserter/metadata/inserter-spec";
import { BackedUpPickupLane } from "../../state/backed-up-pickup-lane";
import { BeltPickupArm } from "../../state/belt-pickup-arm";
import { BeltPickupLane } from "../../state/belt-pickup-lane";
import type { InserterState } from "../../state/inserter-state";
import type { TransportBelt } from "../archetypes/transport-belt";
import { InserterPhase } from "../status-codes";
import type { BeltLane, LanePickup } from "./belt-lane";
import { CarriedItems, HandDropPort, HandPickupPort, HandReason, HandScratch, takeIntoHand } from "./hand";
import { actsInTheTickTheBlockIsLifted, wokenByItsMachinesCraftStart } from "./machine-wakes";
import type { MachineWakes } from "./machine-wakes";

/**
 * A belt's pickup port, its lanes, as one hand reaches it: the stock the hand reaches on each lane (its slots in the
 * BeltLanes, bound at build and kept when the inserter's control is replaced), taken one belt stack a tick at most
 * (same-tick rule 16), from the lane nearest the inserter first. Only a kind of the calibration row runs the arm model.
 * A hand from a belt stops at every grab while the machine it puts into takes nothing of its item. The idle rule starts
 * a pickup from a belt whenever its sink takes what the hand brings: the stacks are on their way.
 */
export class BeltHandPickup implements HandPickupPort {

    /** The arm's reach, kept on the hand (`InserterState.pickup_arm`); only for a kind of the calibration row */
    private readonly arm?: BeltPickupArm;
    private readonly lanes: readonly BeltLane[];
    /** This inserter's reach on each lane of the belt, bound at build */
    private readonly pickups: readonly LanePickup[];
    /** The lanes in the order the hand tries them: the nearest first */
    private readonly pickup_lane_order: readonly number[];
    /** How the inserter reaches over the belt, the same in every tick */
    private readonly layout: BeltPickupLayout;
    /** The lane nearest the inserter, the same in every tick */
    private readonly near_lane: 1 | 2;
    /** What the sink machine's last tick tells the inserters that wait on it; null for any other sink */
    private readonly sink_wakes: MachineWakes | null;

    constructor(
        private readonly state: InserterState,
        private readonly scratch: HandScratch,
        private readonly items: CarriedItems,
        /** The sink's drop port: whether it takes an item now */
        private readonly sink: HandDropPort,
        private readonly source: TransportBelt,
        sink_wakes: MachineWakes | null,
        private readonly tick_provider?: TickProvider,
    ) {
        const inserter = state.inserter;
        this.pickup_lane_order = inserter.near_lane === 2 ? [1, 0] : [0, 1];
        this.layout = inserter.pickup_layout ?? "side-straight";
        this.near_lane = inserter.near_lane ?? 1;
        this.sink_wakes = sink_wakes;
        const pickup_length = inserter.pickup_length;
        assert(pickup_length !== undefined, "Belt pickups need pickup geometry");
        assert(inserter.belt_supply !== undefined, "Belt pickups need a supply setting");
        assert(tick_provider !== undefined, "Belt pickups need the simulation tick provider");

        // Keep this inserter's lane gaps and partial stacks when its control is replaced.
        const inserter_id = state.entity_id.id;
        const belt = source.belt;
        this.lanes = source.lanes;
        const stockOf = (lane: BeltLane, index: number) => {
            const length = pickupLaneLength(inserter.pickup_layout ?? "side-straight", index + 1, pickup_length);
            return inserter.belt_supply === "backed_up"
                ? new BackedUpPickupLane(belt.belt_speed, length, lane.stack_size)
                : new BeltPickupLane(belt.belt_speed, length, lane.stack_size, 0);
        };
        this.pickups = this.lanes.map((lane, index) => lane.pickupOf(inserter_id) ?? lane.addPickup(inserter_id, stockOf(lane, index)));
        const metadata = inserter.metadata;
        // Only a kind of the calibration row (inserter-spec.ts BELT_PICKUP_CALIBRATED) runs the arm model; other
        // prototypes and qualities remain separate calibrations.
        if (beltPickupCalibrated(metadata.type, metadata.quality)) {
            assert(inserter.pickup_layout !== undefined || pickup_length === 1, "Underground pickups need an explicit layout");
            const extension = FactorioDataService.findInserterOrThrow(metadata.type).extension_speed
                * (1 + 0.3 * FactorioDataService.findQualityOrThrow(metadata.quality).level) * 256;
            this.arm = state.pickup_arm ??= new BeltPickupArm(extension);
        }
    }

    /** Reads `waits_for_sink` before the pickup phase clears it (same-tick rule 10) */
    public enter(from: InserterPhase): void {
        const scratch = this.scratch;
        const waited_in_idle = from === InserterPhase.IDLE && this.state.waits_for_sink;
        // a hand that starts right after a swing back lands its first stack on the usual schedule
        scratch.belt_grab_decided = !(waited_in_idle || from === InserterPhase.WAITING_FOR_SINK);
        // A hand that stopped part way because the machine was at its output block goes on in the tick another
        // inserter takes the products down, when the machine finished a craft in the tick before: that craft had
        // woken the inserter already (see `actsInTheTickTheBlockIsLifted`, the rule of the game with its recorded
        // cases: 248 hands of 248 went on in that tick, 843 of 843 a tick later)
        const wakes = this.sink_wakes;
        if (from === InserterPhase.WAITING_FOR_SINK && wakes !== null && actsInTheTickTheBlockIsLifted(wakes)) {
            scratch.belt_grab_decided = true;
        }
        // A hand that waited for room the machine made by starting a craft finds it a tick after the start, which is
        // the tick the game takes its first stack in (see `wokenByItsMachinesCraftStart`)
        if (waited_in_idle && wakes !== null && wokenByItsMachinesCraftStart(wakes)) {
            scratch.belt_grab_decided = true;
        }
    }

    public key(): string {
        return `${this.scratch.belt_grab_decided}`;
    }

    public startsPickup(): boolean {
        this.scratch.reason = HandReason.PICKUP_FROM_BELT;
        return true;
    }

    public pickup(): void {
        const state = this.state;
        const scratch = this.scratch;
        const source = this.source;

        if (this.sink_wakes === null) {
            throw new Error("Inserter sink is not a machine");
        }

        const held_item = state.held_item;
        state.trace?.record({ type: "pickup_attempt", item: held_item?.item_name });

        if (held_item !== null) {
            // As in the game, a hand filling from a belt stops at every grab while the machine cannot take its item
            // (output at the block, or the ingredient at its insertion limit), and goes on once it can again
            if (!this.sink.takes(held_item.item_name)) {
                state.trace?.record({ type: "wait", phase: "pickup", reason: "destination_refused", item: held_item.item_name });
                return;
            }
            // the item has stopped arriving (a run that cuts a supply): the hand keeps what it holds
            if (source.supply.withheld.has(held_item.item_name)) {
                state.trace?.record({ type: "wait", phase: "pickup", reason: "supply_withheld", item: held_item.item_name });
                return;
            }
            if (!scratch.belt_grab_decided) {
                scratch.belt_grab_decided = true;
                state.trace?.record({ type: "wait", phase: "pickup", reason: "pickup_decision", item: held_item.item_name });
                return;
            }
            const remaining_capacity = this.items.handSizeOf(held_item.item_name) - held_item.quantity;
            const pickup_quantity = this.takeFromBelt(held_item.item_name, remaining_capacity);

            if (pickup_quantity <= 0) {
                return;
            }

            takeIntoHand(state, scratch, held_item.item_name, pickup_quantity);
            return;
        }

        const items = this.items.names;
        for (let index = 0; index < items.length; index++) {
            const item_name = items[index];
            if (!this.sink.takesAt(index)) {
                state.trace?.record({ type: "wait", phase: "pickup", reason: "destination_refused", item: item_name });
                continue;
            }
            if (source.supply.withheld.has(item_name)) {
                state.trace?.record({ type: "wait", phase: "pickup", reason: "supply_withheld", item: item_name });
                continue;
            }
            if (!scratch.belt_grab_decided) {
                scratch.belt_grab_decided = true;
                state.trace?.record({ type: "wait", phase: "pickup", reason: "pickup_decision", item: item_name });
                return;
            }
            const pickup_quantity = this.takeFromBelt(item_name, this.items.handSizeOf(item_name));
            if (pickup_quantity === 0) continue;
            takeIntoHand(state, scratch, item_name, pickup_quantity);
            return;
        }
        if (items.length === 0) state.trace?.record({ type: "wait", phase: "pickup", reason: "no_eligible_item" });
    }

    /** One stack from the nearest lane of the item that has one in reach, none if the hand took one in this tick */
    private takeFromBelt(item: ItemName, capacity: number): number {
        if (capacity <= 0) return 0;
        const state = this.state;
        const tick = this.tick_provider!.getCurrentTick();
        const lanes = this.lanes;
        const pickups = this.pickups;
        for (let index = 0; index < pickups.length; index++) {
            if (lanes[index].takenAt(pickups[index], tick)) {
                state.trace?.record({ type: "wait", phase: "pickup", reason: "already_collected_this_tick", item });
                return 0;
            }
        }
        const order = this.pickup_lane_order;
        let matching_lane = false;
        for (let position = 0; position < order.length; position++) {
            const index = order[position];
            const lane = lanes[index];
            if (!lane || lane.item !== item) continue;
            matching_lane = true;
            if (this.arm) {
                const stack = lane.peek(pickups[index], tick);
                if (!stack) continue;
                const target = pickupTargetRadius(this.layout, this.near_lane, index + 1, stack.position);
                if (!this.arm.tryCollect(tick, target, state.held_item === null)) {
                    state.trace?.record({ type: "wait", phase: "pickup", reason: "arm_travel", item });
                    return 0; // Reachable preferred stock remains the target; do not remove it or switch lanes while travelling.
                }
            }
            const limit = Math.min(lane.stack_size, capacity);
            const quantity = lane.take(pickups[index], tick, limit);
            // Retry the other matching lane only if this one had nothing reachable. One stack total per tick.
            if (quantity > 0) {
                state.trace?.record({ type: "pickup_lane", item, lane: index + 1, fallback: index !== order[0] });
                return quantity;
            }
        }
        if (!matching_lane) {
            assert.fail(`No belt lane found for item ${item}`);
        }
        state.trace?.record({ type: "wait", phase: "pickup", reason: "no_reachable_stack", item });
        return 0;
    }
}
