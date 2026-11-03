import { BeltSpeed, Entity, Inserter, ReadableEntityRegistry } from "../entities";
import type { BeltLineTakers } from "./wake-ups";

/**
 * The belt lines each inserter that takes from the side of a straight belt takes from (every lane of its belt), with the
 * inserters whose takes move each line: the wake-up rule "kept-lists" works out from their recorded takes when a line is
 * moving (`BeltLineTakers`). A taker is put on the first lane, nearest first, that carries an item it takes: the lane a
 * backed-up belt gives it its stacks from. Inserters at any other pickup are left out (their lines are not measured).
 */
export function beltLinesOf(registry: ReadableEntityRegistry): Map<string, BeltLineTakers[]> {
    const inserters = registry.getAll().filter(Entity.isInserter);
    const lines = new Map<string, BeltLineTakers[]>();
    const takers = new Map<string, string[]>();
    for (const inserter of inserters) {
        const source = registry.getEntityByIdOrThrow(inserter.source.entity_id);
        if (!Entity.isBelt(source)) continue;
        const lane = takenLaneOf(inserter, source.lanes.map(it => it.ingredient_name));
        if (lane === undefined) continue;
        const key = `${source.entity_id.id}:${lane}`;
        takers.set(key, [...takers.get(key) ?? [], inserter.entity_id.id]);
    }
    for (const inserter of inserters) {
        const source = registry.getEntityByIdOrThrow(inserter.source.entity_id);
        if (!Entity.isBelt(source) || (inserter.pickup_layout ?? "side-straight") !== "side-straight") continue;
        lines.set(inserter.entity_id.id, source.lanes.map((lane, index) => ({
            line_id: `${source.entity_id.id}:${index}`,
            speed: source.belt_speed / BeltSpeed.TRANSPORT_BELT * 8,
            stack_size: lane.stack_size,
            takers: takers.get(`${source.entity_id.id}:${index}`) ?? [],
        })));
    }
    return lines;
}

/** The lane index a belt-fed inserter takes its stacks from: the first, nearest first, with an item it carries */
function takenLaneOf(inserter: Inserter, lane_items: readonly string[]): number | undefined {
    const order = inserter.near_lane === 2 ? [1, 0] : [0, 1];
    return order.find(index => index < lane_items.length
        && (inserter.filtered_items.size === 0 || inserter.filtered_items.has(lane_items[index])));
}
