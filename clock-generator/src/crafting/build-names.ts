import type { Config } from "../config/schema";
import { Entity, EntityId } from "../entities";
import { entityNameOf, type BuildToName, type EndToName } from "./entity-name";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";

/** Where an inserter's end is, as entity-name.ts names an inserter by it */
const endOf = (type: string): EndToName => type === "belt" || type === "machine" || type === "chest" ? type : "other";

/**
 * The belts, inserters, chests and drills of the config as a text names them (entity-name.ts). An inserter's items are the
 * items it carries as the entity has them: its filters, or what its source has of what its sink takes; those it takes from
 * a belt in the belt's lane order. Where the entities cannot be made from the config, an inserter's items are its filters.
 */
export function buildToNameOf(config: Config): BuildToName {
    let carried = new Map<number, readonly string[]>();
    try {
        const registry = createEntityRegistryFromConfig(config);
        carried = new Map(registry.getAll().filter(Entity.isInserter).map(inserter => [inserter.entity_id.number, [...inserter.filtered_items]] as const));
    } catch {
        // the filters below
    }
    const belts = config.belts.map(belt => ({ id: belt.id, lanes: belt.lanes.map(lane => lane.ingredient) }));
    const inserters = config.inserters.map((inserter, index) => {
        const id = inserter.id ?? index + 1;
        const items = [...new Set(carried.get(EntityId.forInserter(id).number) ?? inserter.filters ?? [])];
        const lanes = inserter.source.type === "belt" ? config.belts.find(belt => belt.id === inserter.source.id)?.lanes.map(lane => lane.ingredient) ?? [] : [];
        const place = (item: string) => lanes.includes(item) ? lanes.indexOf(item) : lanes.length;
        return { id, from: endOf(inserter.source.type), to: endOf(inserter.sink.type), items: [...items].sort((a, b) => place(a) - place(b)) };
    });
    const chests = (config.chests ?? []).map(chest => ({ id: chest.id, kind: chest.type,
        holds: chest.type === "buffer-chest" ? [chest.item_filter] : chest.type === "infinity-chest" ? chest.item_filter.map(it => it.item_name) : [] }));
    const drills = (config.drills?.configs ?? []).map(drill => ({ id: drill.id, mines: drill.mined_item_name }));
    return { belts, inserters, chests, drills };
}

/**
 * The names a sentence gives each belt, inserter, chest and drill of the config, by entity id ("inserter:3"), without "the",
 * in the words textWords decides (entity-name.ts). Carried to why no clock is stable, which the site works out without the
 * game data.
 */
export function entityNamesInSentence(config: Config): Record<string, string> {
    const build = buildToNameOf(config);
    const ids = [...build.belts.map(it => `belt:${it.id}`), ...build.inserters.map(it => `inserter:${it.id}`),
        ...build.chests.map(it => `chest:${it.id}`), ...build.drills.map(it => `drill:${it.id}`)];
    return Object.fromEntries(ids.flatMap(id => {
        const name = entityNameOf(id, build);
        return name === undefined || /^(belt|inserter|chest|drill) \d/.test(name) ? [] : [[id, name] as const];
    }));
}
