import type { Config } from "../../config/schema";

/**
 * What the build does with a lane, from what its inserters carry: an input lane is taken from and not dropped onto, an
 * output lane is dropped onto and not taken from, and a buffer lane is both. The configuration does not state it.
 */
export type LaneRole = "input" | "output" | "buffer";

/** The items an inserter of a config carries (inserter.ts carriedItems), by its place in the config's list of inserters */
export type CarriedItemsOf = (index: number) => ReadonlySet<string>;

/** The role of each lane the belts of a config state */
export interface LaneRolesOfBuild {
    /** The role of lane 1 or 2 of a belt; null where no inserter takes or drops the lane's item */
    of(belt_id: number, lane: 1 | 2): LaneRole | null;
}

/**
 * The role of each lane the belts of a config state, by the lane's item. An inserter takes from a lane when its source is
 * the lane's belt and it carries the lane's item: its filters name the item, or, without filters, its sink takes the item.
 * An inserter drops onto a lane when its sink is the lane's belt and it carries the lane's item. A lane with no item (an
 * empty lane) has the role of the other lane of its belt. A lane that no inserter takes from or drops onto has no role,
 * and so has a belt with no inserter on either lane.
 */
export function laneRolesOf(config: Pick<Config, "belts" | "inserters">, carried: CarriedItemsOf): LaneRolesOfBuild {
    const taken = new Set<string>();
    const dropped = new Set<string>();
    config.inserters.forEach((inserter, index) => {
        for (const item of carried(index)) {
            if (inserter.source.type === "belt") taken.add(`${inserter.source.id}|${item}`);
            if (inserter.sink.type === "belt") dropped.add(`${inserter.sink.id}|${item}`);
        }
    });
    const roleOfItem = (belt_id: number, item: string): LaneRole | null => {
        const is_taken = taken.has(`${belt_id}|${item}`);
        const is_dropped = dropped.has(`${belt_id}|${item}`);
        return is_taken && is_dropped ? "buffer" : is_taken ? "input" : is_dropped ? "output" : null;
    };
    const by_belt = new Map<number, readonly (LaneRole | null)[]>();
    for (const belt of config.belts) {
        const listed: readonly { ingredient: string }[] = belt.lanes;
        const items = listed.map(lane => lane.ingredient);
        const own = items.map(item => item === "" ? null : roleOfItem(belt.id, item));
        by_belt.set(belt.id, items.map((item, index) => item !== "" ? own[index] : own[1 - index] ?? null));
    }
    return {
        of: (belt_id, lane) => by_belt.get(belt_id)?.[lane - 1] ?? null,
    };
}
