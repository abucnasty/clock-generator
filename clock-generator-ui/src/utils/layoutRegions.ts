import type { FoundOrbit } from 'clock-generator/browser';

/**
 * Which copied region each entity of the build is in, from the engine's answer, for the Layout view to tint. A key is the
 * engine's: "machine:3", "drill:1", "chest:2", "inserter:5".
 */
export interface RegionTints {
    /** The number of the region, from 1, that holds the entity; 0 for what stands between the regions */
    of: Map<string, number>;
    /** The inserters that match an inserter in another region, by inserter number */
    twins: Map<number, number[]>;
    /** How many regions there are of the most */
    count: number;
}

const inserterNumber = (key: string): number | null => {
    const match = /^inserter:(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
};

/**
 * The tints of the found regions: none (null) where the answer is null, still loading, or holds no orbit the copies may
 * use. A region the engine refused is not drawn.
 */
export function regionTintsOf(found: readonly FoundOrbit[] | null): RegionTints | null {
    const orbits = (found ?? []).flatMap(it => it.kind === 'orbit' ? [it.orbit] : []);
    if (orbits.length === 0) return null;
    const of = new Map<string, number>();
    const twins = new Map<number, number[]>();
    let count = 0;
    for (const orbit of orbits) {
        for (const key of orbit.anchor) if (!of.has(key)) of.set(key, 0);
        orbit.regions.forEach((region, index) => {
            for (const key of [...region.nodes, ...region.arms]) of.set(key, index + 1);
            count = Math.max(count, index + 1);
        });
        // `maps[i]` sends region 0's inserters to region i's: the inserters one key maps to match each other
        for (const key of Object.keys(orbit.maps[0] ?? {})) {
            if (inserterNumber(key) === null) continue;
            const group = [...new Set(orbit.maps.map(map => inserterNumber(map[key] ?? '')).filter((id): id is number => id !== null))];
            for (const id of group) twins.set(id, [...new Set([...(twins.get(id) ?? []), ...group.filter(other => other !== id)])]);
        }
    }
    return { of, twins, count };
}
