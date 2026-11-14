import type { Config } from 'clock-generator/browser';

/** The inserters that take the item of one lane from its belt, in the order along the belt from its entry */
export interface LaneTakers {
    beltId: number;
    lane: 1 | 2;
    takers: {
        inserterId: number;
        /** Tiles along the way the belt flows, from the map's origin; null where the build gives no place for every taker or no flow */
        along: number | null;
    }[];
}

/** A cardinal direction of the game (0 north, 4 east, 8 south, 12 west) as a map step, as the engine reads a belt's flow */
const FLOW: Record<number, { x: number; y: number }> = { 0: { x: 0, y: -1 }, 4: { x: 1, y: 0 }, 8: { x: 0, y: 1 }, 12: { x: -1, y: 0 } };

/** Whether an inserter that takes from a belt takes an item, by its filters */
const takesItem = (inserter: Config['inserters'][number], item: string): boolean => inserter.filters === undefined || inserter.filters.length === 0
    || (inserter.filter_mode === 'blacklist' ? !inserter.filters.includes(item) : inserter.filters.includes(item));

/**
 * The takers of every lane of the config that has an item: the inserters that take from its belt and take its item, in the
 * order the engine lays them along the lane (its check of the lanes several inserters take from): by their places along the
 * flow where every taker has one, else in the config's order, a tile apart. The result of the engine gives only the takers that
 * miss swings; the page draws the others beside them from this.
 */
export function laneTakersOf(config: Pick<Config, 'belts' | 'inserters'>): LaneTakers[] {
    return config.belts.flatMap(belt => ([1, 2] as const).flatMap(lane => {
        const item = belt.lanes[lane - 1]?.ingredient;
        if (item === undefined || item === '') return [];
        const taking = config.inserters.flatMap((inserter, index) =>
            inserter.source.type === 'belt' && inserter.source.id === belt.id && takesItem(inserter, item) ? [{ inserterId: inserter.id ?? index + 1, position: inserter.position }] : []);
        if (taking.length === 0) return [];
        const flow = belt.flow_direction === undefined ? undefined : FLOW[belt.flow_direction];
        const placed = flow !== undefined && taking.every(it => it.position !== undefined);
        const takers = taking.map(it => ({ inserterId: it.inserterId, along: placed ? it.position!.x * flow.x + it.position!.y * flow.y : null }));
        return [{ beltId: belt.id, lane, takers: placed ? takers.sort((a, b) => a.along! - b.along!) : takers }];
    }));
}

/**
 * The takers a picture of a build of one copy draws for the lanes that miss swings: those of the lanes in `lanes` in the order
 * along the belt, each once, then any taker the engine names that the build's lanes do not (by number). Also the tiles between
 * each taker and the next, where the places of all are known.
 */
export function takersAlongOf(laneTakers: readonly LaneTakers[] | undefined, lanes: readonly { belt_id: number; lane: number }[], named: readonly number[]): { ids: number[]; tiles: number[] | null } {
    const found = (laneTakers ?? []).filter(it => lanes.some(lane => lane.belt_id === it.beltId && lane.lane === it.lane)).flatMap(it => it.takers);
    const first = new Map<number, number | null>();
    for (const taker of found) if (!first.has(taker.inserterId)) first.set(taker.inserterId, taker.along);
    const known = [...first.values()].every(along => along !== null);
    const ordered = known ? [...first.entries()].sort((a, b) => a[1]! - b[1]!) : [...first.entries()];
    const ids = [...ordered.map(it => it[0]), ...[...named].sort((a, b) => a - b).filter(id => !first.has(id))];
    const placed = known && ids.length === ordered.length && ids.length > 1;
    return { ids, tiles: placed ? ordered.slice(1).map((it, index) => Math.abs(it[1]! - ordered[index][1]!)) : null };
}
