import { Belt } from "../entities"
import { BeltInventoryState } from "./belt-inventory-state"
import { EntityState } from "./entity-state"
import { LaneTraffic } from "./lane-traffic"
import { SupplyGate } from "./supply-gate"
import { BeltPickupStock } from "./belt-pickup-stock"
import { BeltPickupMerge } from "./belt-pickup-merge"

export interface BeltState extends EntityState {
    belt: Belt
    inventoryState: BeltInventoryState
    /** Items the belt does not give or take for now; nothing, unless a run cuts a supply (see SupplyGate) */
    supply: SupplyGate
    /** The stacks on each lane (in the order of the belt's `lanes`) that inserters with a drop spot put down on it */
    lane_traffic: LaneTraffic[]
    /** Reachable input lanes per pickup; kept when the runner replaces an inserter's control. */
    pickup_lanes: Map<string, BeltPickupStock[]>
    pickup_merges: Map<number, BeltPickupMerge>
}


function fromBelt(belt: Belt): BeltState {
    return {
        entity_id: belt.entity_id,
        belt: belt,
        inventoryState: BeltInventoryState.fromBelt(belt),
        supply: new SupplyGate(),
        lane_traffic: belt.lanes.map(() => new LaneTraffic()),
        pickup_lanes: new Map(),
        pickup_merges: new Map(),
    }
}

/** What the lanes carry besides the belt's inventory, for the key that tells whether a simulation repeats */
function stateKey(state: BeltState, tick: number): string {
    advancePickups(state, tick);
    return state.lane_traffic.map(it => it.stateKey(tick)).join("|")
        + ";" + [...state.pickup_lanes].map(([id, lanes]) => `${id}:${lanes.map(lane => lane.stateKey(tick)).join("|")}`).join(";")
        + ";" + [...state.pickup_merges].map(([lane, merge]) => `${lane}:${merge.stateKey(tick)}`).join(";")
}

function advancePickups(state: BeltState, tick: number): void {
    for (const merge of state.pickup_merges.values()) {
        merge.advanceTo(tick, merge.config.outlet === "open" && state.supply.refused.size === 0, state.supply.withheld);
    }
}

export const BeltState = {
    create: fromBelt,
    stateKey: stateKey,
    advancePickups,
}
