import type { SharedLane } from "../../state/shared-lane";
import type { SimulationContext } from "../sequence";
import { simulationStateKey } from "./steady-state";

/**
 * The state key of a run that holds lanes its context's states do not: a run of the copies holds the lanes they share
 * (`installSharedLanes`), which each taker's reach reads but no belt keys. The context's key (`simulationStateKey`),
 * then each lane brought up to the tick and keyed (`SharedLane.key`), in the order given. Without lanes it is the
 * context's key. The warm-up's stop and the loss trial's repeat both compare this key.
 */
export function stateKeyWithLanes(context: SimulationContext, lanes: readonly SharedLane[]): string {
    const tick = context.tick_provider.getCurrentTick();
    return [simulationStateKey(context), ...lanes.map(lane => {
        lane.advanceTo(tick);
        return lane.key();
    })].join("\n");
}
