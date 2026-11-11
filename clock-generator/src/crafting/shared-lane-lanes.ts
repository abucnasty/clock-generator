import type { Config } from "../config/schema";
import { FlowAcrossCopySpacingError, FlowAcrossCopySpacingIssue } from "../config/errors";
import { FlowDirection, LaneEnd, laneFactsOf } from "../entities/traits/lane-facts";

/**
 * The lanes the check of the shared lanes runs (shared-lane-verdict.ts), and how far along a lane's flow a place on the
 * map is (shared-lane-model.ts). Apart from the check, so that the config can be refused on the same lanes and the same
 * distances before any run.
 */

/** A lane the model runs: whether the copies share it, its end, and the way its items move where the config states it */
export interface ModelLane {
    belt_id: number;
    lane: 1 | 2;
    shared: boolean;
    stated: LaneEnd;
    flow: FlowDirection | null;
}

/** How far along the flow a place on the map is, in tiles: the distance between two copies along a lane is that of their offset */
export function alongFlow(position: { x: number; y: number }, flow: FlowDirection): number {
    return position.x * flow.x + position.y * flow.y;
}

/** The belts an inserter of the config drops onto */
export function droppedOnto(config: Config): Set<number> {
    return new Set(config.inserters.flatMap(inserter => inserter.sink.type === "belt" ? [inserter.sink.id] : []));
}

/** The lanes a belt pickup of the config takes an item from: each belt's lanes with an item and a taker of it */
export function takenLanesOf(config: Config): { belt_id: number; lane: 1 | 2 }[] {
    return config.belts.flatMap(belt => ([1, 2] as const).flatMap(lane => {
        const item = belt.lanes[lane - 1]?.ingredient;
        if (item === undefined || item === "") return [];
        const taken = config.inserters.some(inserter => inserter.source.type === "belt" && inserter.source.id === belt.id
            && (inserter.filters === undefined || inserter.filters.length === 0
                || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item))));
        return taken ? [{ belt_id: belt.id, lane }] : [];
    }));
}

/** The lanes the model judges (see shared-lane-verdict.ts) */
export function modelLanesOf(config: Config): ModelLane[] {
    const facts = laneFactsOf(config);
    const dropped = droppedOnto(config);
    return takenLanesOf(config).flatMap(({ belt_id, lane }) => {
        if (dropped.has(belt_id)) return [];
        const lane_facts = facts.of(belt_id, lane);
        const shared = lane_facts.sharing === "shared_by_copies" && config.setpoint.copies > 1;
        if (!shared && lane_facts.lane_end.kind !== "unknown") return [];
        return [{ belt_id, lane, shared, stated: lane_facts.lane_end, flow: lane_facts.flow_direction }];
    });
}

/**
 * The belts that state a flow direction across `copy_offset` on a lane the copies share and the check runs: the copies
 * would stand no distance apart along the lane (`alongFlow` of the offset is 0), which the check cannot lay out. None
 * where the config gives no offset, an offset of 0 or one copy, or the belt states no flow direction.
 */
export function flowsAcrossCopySpacing(config: Config): FlowAcrossCopySpacingIssue[] {
    const offset = config.setpoint.copy_offset;
    if (offset === undefined || (offset.x === 0 && offset.y === 0)) return [];
    const across = modelLanesOf(config).filter(lane => lane.shared && lane.flow !== null && alongFlow(offset, lane.flow) === 0);
    return config.belts.flatMap(belt => {
        const lanes = across.filter(lane => lane.belt_id === belt.id).map(lane => lane.lane);
        return lanes.length === 0 || belt.flow_direction === undefined ? [] : [{ belt_id: belt.id, flow_direction: belt.flow_direction, lanes }];
    });
}

/** Throws a FlowAcrossCopySpacingError where a belt states a flow direction across the copy spacing (`flowsAcrossCopySpacing`) */
export function assertFlowAlongCopySpacing(config: Config): void {
    const across = flowsAcrossCopySpacing(config);
    if (across.length > 0) {
        throw new FlowAcrossCopySpacingError(across, config.setpoint.copy_offset!);
    }
}
