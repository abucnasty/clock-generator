import { beltLaneFactsOf, migrateBeltSupplyOverrides, type LaneRolesOfBuild } from 'clock-generator/light';
import type { Config } from 'clock-generator/browser';
import { nameInSentence } from './entityLabel';

/** The answer the former belt setting stored: `true` was Backed up, `false` Moving */
type BeltSetting = 'backed_up' | 'moving';

/** A lane the conversion stated an end on */
interface ConvertedLane {
    belt_id: number;
    lane: 1 | 2;
    item: string;
}

/** A build that stated the belt setting, with the lane ends that now say what it said */
interface BeltSettingConversion<C> {
    config: C;
    setting: BeltSetting;
    end: 'dead_end' | 'infinite';
    lanes: ConvertedLane[];
}

/** The parts of a config or of the form state the conversion reads and writes */
interface Convertible {
    belts: readonly { id: number; type: string; lanes: readonly { ingredient: string; lane_end?: unknown; consumption_per_second?: number }[] }[];
    overrides?: object;
}

/**
 * A build that states the former belt setting (`overrides.backed_up_belts`, or its older spelling) turned into one that
 * states lane ends, or null where it states no setting. Each input or buffer lane (its role from `roles`) that states no
 * end and no consumption gets the end the engine's lane facts give it under the setting (the light entry's
 * `beltLaneFactsOf`): a dead end for Backed up, an infinite end for Moving. An output lane, and a lane with no role, gets
 * nothing: it has the end its role gives it. The setting goes in every case, and the overrides with it when it was the
 * only one.
 */
export function convertBeltSetting<C extends Convertible>(config: C, roles: LaneRolesOfBuild): BeltSettingConversion<C> | null {
    const overrides = migrateBeltSupplyOverrides(config.overrides) as { backed_up_belts?: unknown } | undefined;
    if (overrides === undefined || typeof overrides.backed_up_belts !== 'boolean') return null;
    const setting: BeltSetting = overrides.backed_up_belts ? 'backed_up' : 'moving';
    const read = { ...config, overrides } as unknown as Pick<Config, 'belts' | 'overrides'>;
    const facts = beltLaneFactsOf(read, roles);
    const lanes: ConvertedLane[] = [];
    const belts = config.belts.map(belt => ({ ...belt, lanes: belt.lanes.map((lane, index) => {
        const fact = facts.find(it => it.belt_id === belt.id && it.lane === index + 1);
        if (fact === undefined || (fact.role !== 'input' && fact.role !== 'buffer') || lane.lane_end !== undefined
            || lane.consumption_per_second !== undefined) return lane;
        lanes.push({ belt_id: belt.id, lane: index + 1 as 1 | 2, item: lane.ingredient });
        return { ...lane, lane_end: { kind: fact.lane_end.kind } };
    }) }));
    const { backed_up_belts: _setting, ...rest } = overrides;
    void _setting;
    const converted = { ...config, belts } as C & { overrides?: object };
    if (Object.keys(rest).length > 0) converted.overrides = rest;
    else delete converted.overrides;
    return { config: converted, setting, end: setting === 'backed_up' ? 'dead_end' : 'infinite', lanes };
}

/** "a", "a and b", "a, b and c" */
function listed(names: string[]): string {
    return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The words of the note */
const BELT_SETTING_NOTE_COPY = {
    setting: { backed_up: 'Backed up', moving: 'Moving' },
    end: { dead_end: 'Dead end', infinite: 'Infinite' },
} as const;

/**
 * What the page tells the user once, where a build that stated the former belt setting was converted:
 * "Backed up is no longer a belt setting: the iron plate and copper plate lanes now state the lane end Dead end."
 * Each item once, in the config's order; a lane with no item is not named. `itemLabel` gives an item's game name.
 */
export function beltSettingNoteOf(conversion: Pick<BeltSettingConversion<unknown>, 'setting' | 'end' | 'lanes'>, itemLabel: (id: string) => string = id => id): string {
    const lead = `${BELT_SETTING_NOTE_COPY.setting[conversion.setting]} is no longer a belt setting`;
    const items = [...new Set(conversion.lanes.map(lane => lane.item).filter(item => item !== ''))];
    if (items.length === 0) return `${lead}.`;
    const lanes = conversion.lanes.filter(lane => lane.item !== '').length;
    return `${lead}: the ${listed(items.map(item => nameInSentence(itemLabel(item))))} ${lanes === 1 ? 'lane now states' : 'lanes now state'}`
        + ` the lane end ${BELT_SETTING_NOTE_COPY.end[conversion.end]}.`;
}
