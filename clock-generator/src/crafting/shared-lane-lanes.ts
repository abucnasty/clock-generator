import type { Config } from "../config/schema";
import { FlowAcrossCopySpacingError, FlowAcrossCopySpacingIssue } from "../config/errors";
import { withoutOutsideSupply } from "../config/outside-supply";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { FlowDirection, LaneEnd } from "../entities/traits/lane-facts";

/**
 * The lanes the check of the shared lanes runs (shared-lane-verdict.ts), and how far along a lane's flow a place on the
 * map is (shared-lane-model.ts). Apart from the check, so that the config can be refused on the same lanes and the same
 * distances before any run.
 */

/** A lane the model runs: whether the copies share it, its end, and the way its items move where the config states it */
export interface ModelLane {
    belt_id: number;
    lane: 1 | 2;
    /** Whether its takers take from it together (`takenTogether`): those of the copies, or several of one copy */
    shared: boolean;
    stated: LaneEnd;
    flow: FlowDirection | null;
}

/** How far along the flow a place on the map is, in tiles: the distance between two copies along a lane is that of their offset */
export function alongFlow(position: { x: number; y: number }, flow: FlowDirection): number {
    return position.x * flow.x + position.y * flow.y;
}

/** The belts an inserter of the config drops onto; outside supply (outside-supply.ts) drops onto none of the build's own */
export function droppedOnto(config: Config): Set<number> {
    return new Set(withoutOutsideSupply(config).inserters.flatMap(inserter => inserter.sink.type === "belt" ? [inserter.sink.id] : []));
}

/** Whether an inserter that takes from a belt takes an item, by its filters */
const takesItem = (inserter: Config["inserters"][number], item: string): boolean => inserter.filters === undefined || inserter.filters.length === 0
    || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item));

/** The inserters of the config that take the item of a lane of a belt from it (its takers): none where the lane has no item */
function takersOf(config: Config, belt_id: number, lane: 1 | 2): Config["inserters"] {
    const item = config.belts.find(belt => belt.id === belt_id)?.lanes[lane - 1]?.ingredient;
    if (item === undefined || item === "") return [];
    return config.inserters.filter(inserter => inserter.source.type === "belt" && inserter.source.id === belt_id && takesItem(inserter, item));
}

/** The lanes a belt pickup of the config takes an item from: each belt's lanes with an item and a taker of it */
export function takenLanesOf(config: Config): { belt_id: number; lane: 1 | 2 }[] {
    return config.belts.flatMap(belt => ([1, 2] as const).flatMap(lane => takersOf(config, belt.id, lane).length > 0 ? [{ belt_id: belt.id, lane }] : []));
}

/**
 * Whether the distance between the takers of a lane is not known: in a build of one copy, a lane that several takers take
 * from and at least one of them has no position. The model does not run such a lane with its takers together
 * (`modelLanesOf`), and its row says why (`taker_spacing_unknown`, checked-lanes.ts). With more than one copy the copies
 * stand apart by `copy_offset` or the width of a copy, and the takers of a copy without positions a tile apart
 * (shared-lane-model.ts).
 */
export function takerSpacingUnknown(config: Config, belt_id: number, lane: 1 | 2): boolean {
    const takers = takersOf(config, belt_id, lane);
    return !(config.setpoint.copies > 1) && takers.length >= 2 && takers.some(inserter => inserter.position === undefined);
}

/**
 * Whether the takers of a lane the copies share take from it together: two or more of them, counting the takers of every
 * copy on the lane (those of the config, each standing where its position puts it, times the copies, a part copy counted
 * as one). Then the check runs the lane with every one of them on it: the copies `copy_offset` apart, the takers of a copy
 * where their positions put them (shared-lane-model.ts). A build of one copy with one taker of the lane has none.
 */
export function takenTogether(config: Config, belt_id: number, lane: 1 | 2): boolean {
    return takersOf(config, belt_id, lane).length * Math.ceil(config.setpoint.copies) >= 2;
}

/** The lanes the model judges (see shared-lane-verdict.ts) */
export function modelLanesOf(config: Config): ModelLane[] {
    const facts = laneFactsOfConfig(config);
    const dropped = droppedOnto(config);
    return takenLanesOf(config).flatMap(({ belt_id, lane }) => {
        if (dropped.has(belt_id)) return [];
        const lane_facts = facts.of(belt_id, lane);
        // a lane of one copy whose takers' distance is not known is not run with them together: as one copy alone, where its end is unknown
        const shared = lane_facts.sharing === "shared" && takenTogether(config, belt_id, lane) && !takerSpacingUnknown(config, belt_id, lane);
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
    // the offset places the copies after the first: a build of one copy has none to place, whatever its takers
    if (offset === undefined || (offset.x === 0 && offset.y === 0) || !(config.setpoint.copies > 1)) return [];
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
