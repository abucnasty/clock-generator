import type { Config } from 'clock-generator/browser';
import type { LaneRole } from 'clock-generator/light';
import type { LaneRoleOfLane } from './types';

/**
 * The worker's answer to 'lane-roles': each lane the belts state, belt by belt and lane 1 first, with the role the
 * engine's lane facts give it (`laneFactsOfConfig`)
 */
export function laneRolesAnswer(config: Pick<Config, 'belts'>, facts: { lanesOf(belt_id: number): readonly { role: LaneRole | null }[] }): LaneRoleOfLane[] {
    return config.belts.flatMap(belt => facts.lanesOf(belt.id).map((lane, index) => ({ belt_id: belt.id, lane: index + 1 as 1 | 2, role: lane.role })));
}
