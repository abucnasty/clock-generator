import { beltLaneFactsOf, migrateBeltSupplyOverrides, type LaneRolesOfBuild } from 'clock-generator/light';
import type { Config } from 'clock-generator/browser';

/** The parts of a config or of the form state the conversion reads and writes */
interface Convertible {
    belts: readonly { id: number; type: string; lanes: readonly { ingredient: string; lane_end?: unknown; consumption_per_second?: number }[] }[];
    overrides?: object;
}

/**
 * A build that states the former belt setting (`overrides.backed_up_belts`, or its older spelling) turned into one that
 * states lane ends, or null where it states no setting. Each input or buffer lane (its role from `roles`) that states no
 * end and no consumption gets the end the engine's lane facts give it under the setting (the light entry's
 * `beltLaneFactsOf`): a dead end for `true`, an infinite end for `false`. An output lane, and a lane with no role, gets
 * nothing: it has the end its role gives it. The setting goes in every case, and the overrides with it when it was the
 * only one.
 */
export function convertBeltSetting<C extends Convertible>(config: C, roles: LaneRolesOfBuild): C | null {
    const overrides = migrateBeltSupplyOverrides(config.overrides) as { backed_up_belts?: unknown } | undefined;
    if (overrides === undefined || typeof overrides.backed_up_belts !== 'boolean') return null;
    const facts = beltLaneFactsOf({ ...config, overrides } as unknown as Pick<Config, 'belts' | 'overrides'>, roles);
    const belts = config.belts.map(belt => ({ ...belt, lanes: belt.lanes.map((lane, index) => {
        const fact = facts.find(it => it.belt_id === belt.id && it.lane === index + 1);
        return fact === undefined || (fact.role !== 'input' && fact.role !== 'buffer') || lane.lane_end !== undefined
            || lane.consumption_per_second !== undefined ? lane : { ...lane, lane_end: { kind: fact.lane_end.kind } };
    }) }));
    const { backed_up_belts: _setting, ...rest } = overrides;
    void _setting;
    const converted = { ...config, belts } as C & { overrides?: object };
    if (Object.keys(rest).length > 0) converted.overrides = rest;
    else delete converted.overrides;
    return converted;
}
