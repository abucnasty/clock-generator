import type { Config } from 'clock-generator/browser';
import { beltLaneFactsOf, type LaneEnd, type LaneRole, type LaneSharing } from 'clock-generator/light';
import type { LaneRoleOfLane } from '../worker/types';

/**
 * The fields of a config that the roles of its lanes come from, as the engine's own store of roles keys them
 * (build-traits.ts `laneRolesOfConfig`): the belts' items, the machines, chests and drills, and each inserter's ends and
 * filters. Two configs with the same key have the same roles, so an edit of a lane's end or supply rate asks nothing new.
 */
export function laneRolesKeyOf(config: Pick<Config, 'belts' | 'machines' | 'chests' | 'drills' | 'inserters'>): string {
    return JSON.stringify([
        config.belts.map(belt => [belt.id, (belt.lanes as readonly { ingredient: string }[]).map(lane => lane.ingredient)]),
        config.machines, config.chests ?? null, config.drills ?? null,
        config.inserters.map(inserter => [inserter.source.type, inserter.source.id, inserter.sink.type, inserter.sink.id, inserter.filters ?? null]),
    ]);
}

/** One lane as the engine reads it, for the form */
export interface FormLaneFact {
    /** Its role; null where no inserter takes or drops its item; undefined while the engine cannot tell */
    role: LaneRole | null | undefined;
    /** The end the engine reads: the stated one, else the one its role (or the config's switch) gives; undefined while the engine cannot tell */
    end: LaneEnd['kind'] | undefined;
    /** Items a second the lane carries: the supply rate of a lane that states none */
    capacity: number;
    /** Whether the copies share it: the stated value, else the engine's default */
    sharing: LaneSharing;
}

/** The lanes of a config as the engine reads them, by belt id and lane number */
export interface FormLaneFacts {
    of(belt_id: number, lane: 1 | 2): FormLaneFact | undefined;
    /** Every lane the belts state, belt by belt and lane 1 first */
    readonly lanes: readonly (FormLaneFact & { belt_id: number; lane: 1 | 2 })[];
}

const decimal = (ratio: { numerator: number; denominator: number }) => ratio.numerator / ratio.denominator;

/**
 * The facts of the lanes of `config` from the light entry (`beltLaneFactsOf`), with the roles the engine gave (the
 * worker's 'lane-roles'). Without roles, the capacity and the sharing only: the role and the end are left unknown, never
 * guessed. Null where the light entry cannot read the belts.
 */
export function formLaneFactsOf(config: Pick<Config, 'belts' | 'overrides'>, roles: readonly LaneRoleOfLane[] | null): FormLaneFacts | null {
    const by_lane = new Map((roles ?? []).map(lane => [`${lane.belt_id}.${lane.lane}`, lane.role]));
    let read: ReturnType<typeof beltLaneFactsOf>;
    try {
        read = beltLaneFactsOf(config, { of: (belt_id, lane) => by_lane.get(`${belt_id}.${lane}`) ?? null });
    } catch {
        return null;
    }
    const lanes = read.map(lane => ({
        belt_id: lane.belt_id,
        lane: lane.lane,
        role: roles === null ? undefined : lane.role,
        end: roles === null ? undefined : lane.lane_end.kind,
        capacity: decimal(lane.capacity),
        sharing: lane.sharing,
    }));
    const of = new Map(lanes.map(lane => [`${lane.belt_id}.${lane.lane}`, lane]));
    return { of: (belt_id, lane) => of.get(`${belt_id}.${lane}`), lanes };
}

/** Whether an inserter takes from the lane: an input or a buffer lane */
export const isTakenLane = (fact: Pick<FormLaneFact, 'role'> | undefined) => fact?.role === 'input' || fact?.role === 'buffer';

/** The input and buffer lanes of a build by the end the engine reads; null while the engine cannot tell */
export function inputLaneEnds(facts: FormLaneFacts | null): { dead_end: number; infinite: number; unknown: number } | null {
    if (facts === null || facts.lanes.some(lane => lane.role === undefined)) return null;
    const taken = facts.lanes.filter(isTakenLane);
    const count = (kind: LaneEnd['kind']) => taken.filter(lane => lane.end === kind).length;
    return { dead_end: count('dead_end'), infinite: count('infinite'), unknown: count('unknown') };
}

/** The words of the lane facts, in one place for the glossary */
export const LANE_FACT_COPY = {
    laneEnd: 'Lane end',
    supplyRate: 'Supply rate /s',
    sharing: 'Sharing',
    flowDirection: 'Flow direction (the way items pass the copies)',
    ends: { dead_end: 'Dead end', infinite: 'Infinite', unknown: 'Unknown' } satisfies Record<LaneEnd['kind'], string>,
    sharings: { shared: 'Shared', per_copy: 'Per copy' } satisfies Record<LaneSharing, string>,
    /** What a control shows for a fact the lane does not state (a placeholder until the words are settled) */
    notStated: 'Not stated',
    unknownChoice: 'Unknown: set the end',
    unknownNote: 'The Sidecar could not tell this lane\'s end.',
    countLabel: 'Input lanes',
    outputBeltLabel: 'Output belt:',
    outputBeltStated: 'stated in the file.',
    outputBeltKept: 'The page keeps it as it is stated. Change it in the configuration file.',
} as const;

/** The way the items on a belt move, as the config states it: 0 north, 4 east, 8 south, 12 west */
export type FlowDirectionValue = NonNullable<Config['belts'][number]['flow_direction']>;
export const FLOW_DIRECTIONS: readonly { value: FlowDirectionValue; label: string }[] = [
    { value: 0, label: 'North' },
    { value: 4, label: 'East' },
    { value: 8, label: 'South' },
    { value: 12, label: 'West' },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Input lanes: 2 dead ends · 0 infinite", with "· 1 unknown" where a lane carries an unknown end */
export function inputLanesText(ends: { dead_end: number; infinite: number; unknown: number }): string {
    return [plural(ends.dead_end, 'dead end', 'dead ends'), `${ends.infinite} infinite`, ...(ends.unknown > 0 ? [`${ends.unknown} unknown`] : [])].join(' · ');
}

/** What a stated output belt holds: "5 stretches, 1 splitter, 1 infinite end." */
export function outputBeltSummary(outputBelt: NonNullable<Config['output_belt']>): string {
    const ends = outputBelt.stretches.flatMap(stretch => stretch.points).filter(point => point.lane_end !== undefined).length;
    const parts = [plural(outputBelt.stretches.length, 'stretch', 'stretches'),
        ...(outputBelt.splitter !== undefined ? ['1 splitter'] : []),
        ...(ends > 0 ? [plural(ends, 'infinite end', 'infinite ends')] : [])];
    return `${parts.join(', ')}.`;
}
