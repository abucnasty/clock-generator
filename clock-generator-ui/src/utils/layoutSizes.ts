/**
 * The tile sizes and the reach of the entities the Layout view draws. A config holds a position and no size, and the UI
 * holds no game data of its own: the machine, drill and inserter rows are copied from `data-filtered.json`
 * (`layoutSizes.test.ts` holds them to it), the rest from the sizes of the blueprint tooling, facing north.
 */

/** Width and height in tiles */
export type TileSize = readonly [width: number, height: number];

export const TILE_SIZES: Readonly<Record<string, TileSize>> = {
    // crafting machines, `crafting_machine`
    'assembling-machine-1': [3, 3], 'assembling-machine-2': [3, 3], 'assembling-machine-3': [3, 3],
    'oil-refinery': [5, 5], 'chemical-plant': [3, 3], 'centrifuge': [3, 3], 'biochamber': [3, 3], 'crusher': [2, 3],
    'foundry': [5, 5], 'captive-biter-spawner': [5, 5], 'electromagnetic-plant': [4, 4], 'cryogenic-plant': [5, 5],
    'stone-furnace': [2, 2], 'electric-furnace': [3, 3], 'steel-furnace': [2, 2], 'recycler': [2, 4],
    // drills, `mining-drill`
    'electric-mining-drill': [3, 3], 'burner-mining-drill': [2, 2], 'pumpjack': [3, 3], 'big-mining-drill': [5, 5],
    // chests by type: one tile
    'buffer-chest': [1, 1], 'infinity-chest': [1, 1],
    // vehicles, the collision box facing north, and the silo
    'car': [1.4, 3], 'tank': [1.8, 3.8], 'cargo-wagon': [1.4, 5.4], 'rocket-silo': [9, 9],
};

/** The size of a machine prototype, a drill type or a chest type; null where the table has none */
export function tileSizeOf(name: string): TileSize | null {
    return Object.hasOwn(TILE_SIZES, name) ? TILE_SIZES[name] : null;
}

/** What faces by its orientation, which the Sidecar does not export: the view draws and tests it in either one */
const FREE_FACING = new Set(['car', 'tank', 'cargo-wagon', 'rocket-silo']);

export const facesFreely = (name: string): boolean => FREE_FACING.has(name);

/** Tiles from an inserter to the tile it picks from, and to the tile it drops on: `pickup_position` and `insert_position` */
export const INSERTER_REACH: Readonly<Record<string, { pickup: number; drop: number }>> = {
    'inserter': { pickup: 1, drop: 1 },
    'fast-inserter': { pickup: 1, drop: 1 },
    'long-handed-inserter': { pickup: 2, drop: 2 },
    'burner-inserter': { pickup: 1, drop: 1 },
    'bulk-inserter': { pickup: 1, drop: 1 },
    'stack-inserter': { pickup: 1, drop: 1 },
};

/** The reach of an inserter prototype; one tile at each end for a prototype the table does not have */
export function reachOf(prototype: string | undefined): { pickup: number; drop: number } {
    return prototype !== undefined && Object.hasOwn(INSERTER_REACH, prototype) ? INSERTER_REACH[prototype] : { pickup: 1, drop: 1 };
}
