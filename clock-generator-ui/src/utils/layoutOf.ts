import { reachOf, facesFreely, type TileSize } from './layoutSizes';

/** A place in the game, in tiles; x grows to the east and y to the south */
export interface Point { x: number; y: number }

type EntityKind = 'machine' | 'drill' | 'chest' | 'inserter';
type EndType = 'machine' | 'belt' | 'chest';

/**
 * What the picture reads: the rows of the form, or the lists of a Sidecar export as they are (an exported inserter has no
 * number, so it takes its place in the list). Only these fields are read.
 */
export interface LayoutLists {
    machines: readonly { id: number; prototype?: string; position?: Point }[];
    drills: readonly { id: number; type: string; position?: Point }[];
    inserters: readonly {
        id?: number;
        prototype?: string;
        position?: Point;
        direction?: number;
        source: { type: EndType; id: number };
        sink: { type: EndType; id: number; belt_direction?: number };
    }[];
    belts: readonly { id: number }[];
    chests: readonly { id: number; type: string; position?: Point }[];
}

/** The size of a machine prototype, a drill type or a chest type, or null where the view has none */
type SizeOf = (name: string) => TileSize | null;

export interface EntityRef { kind: EntityKind; id: number }

export interface LayoutBox extends EntityRef {
    kind: 'machine' | 'drill' | 'chest';
    /** The prototype of a machine, the type of a drill or a chest */
    name: string;
    /** The centre, as the config gives it */
    x: number;
    y: number;
    width: number;
    height: number;
    /** No size is known for the name: the box is one tile, a marker with its name */
    unsized: boolean;
    /** It has no orientation in the config (a vehicle, a silo): the view draws both footprints */
    freeFacing: boolean;
    /** Other entities of the same kind at the same place */
    samePlace: EntityRef[];
}

/**
 * How one end of an inserter lies against the entity the config names for it.
 * - inside: the tile of the end is inside the entity's box
 * - outside: it is not, which means the direction rule is wrong
 * - belt: the end is a belt; the config holds no belt tile to test against
 * - no-tile: the inserter has no usable direction
 * - no-entity: the config has no such machine or chest
 * - no-position: the entity has no position
 * - no-size: the entity has no size in the table
 */
type EndCheck = 'inside' | 'outside' | 'belt' | 'no-tile' | 'no-entity' | 'no-position' | 'no-size';

interface LayoutEnd {
    role: 'pickup' | 'drop';
    type: EndType;
    id: number;
    /** The centre of the tile the inserter reaches, null without a direction */
    tile: Point | null;
    check: EndCheck;
}

export interface LayoutInserter {
    /** The number the List and the diagram show: its id, else its place in the list from 1 */
    number: number;
    /** The id the selection is made with */
    id: number;
    x: number;
    y: number;
    /** The side it picks from, 0 north, 4 east, 8 south, 12 west; null where the config has none of these */
    direction: 0 | 4 | 8 | 12 | null;
    ends: LayoutEnd[];
    samePlace: EntityRef[];
}

/** A tile an inserter picks from or drops on, of one belt */
export interface LayoutBeltTile {
    beltId: number;
    /** The centre of the tile */
    x: number;
    y: number;
    pickup: boolean;
    drop: boolean;
    /** The direction the belt runs at a drop tile, where the config states it */
    direction: number | null;
}

/** An entity the picture leaves out because the config gives it no position */
interface LayoutLeftOut extends EntityRef { number: number }

export interface Layout {
    boxes: LayoutBox[];
    inserters: LayoutInserter[];
    beltTiles: LayoutBeltTile[];
    /** Each belt of the build and the number of tiles the picture holds of it */
    belts: { id: number; tiles: number }[];
    leftOut: LayoutLeftOut[];
}

const VECTOR: Record<number, Point> = { 0: { x: 0, y: -1 }, 4: { x: 1, y: 0 }, 8: { x: 0, y: 1 }, 12: { x: -1, y: 0 } };
const EPSILON = 1e-9;

const tileOf = (point: Point): Point => ({ x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5 });
const placeKey = (point: Point) => `${point.x},${point.y}`;

function inBox(box: LayoutBox, tile: Point): boolean {
    // an entity with no orientation in the config, or with unequal sides, is held in either one
    const turnable = box.freeFacing || box.width !== box.height;
    const within = (width: number, height: number) => Math.abs(tile.x - box.x) <= width / 2 + EPSILON && Math.abs(tile.y - box.y) <= height / 2 + EPSILON;
    return within(box.width, box.height) || (turnable && within(box.height, box.width));
}

/** Gives each entity of a group the others of the group that stand at the same place */
function samePlaceOf<T extends EntityRef>(entities: readonly (T & Point)[]): Map<T, EntityRef[]> {
    const byPlace = new Map<string, (T & Point)[]>();
    for (const entity of entities) byPlace.set(placeKey(entity), [...(byPlace.get(placeKey(entity)) ?? []), entity]);
    return new Map(entities.map(entity => [entity, (byPlace.get(placeKey(entity)) ?? []).filter(other => other !== entity).map(({ kind, id }) => ({ kind, id }))]));
}

/**
 * The picture of a build from its positions: the boxes of its machines, drills and chests, each inserter with the tile it
 * picks from (one reach ahead of it, on the side it faces) and the tile it drops on (one reach behind it), and the tiles of
 * belts those ends fall on. It draws nothing the config does not hold: a belt has no position in the config, so a belt is
 * its tiles at the ends of inserters, and an entity with no position is left out and named.
 */
export function layoutOf(lists: LayoutLists, sizeOf: SizeOf): Layout {
    const leftOut: LayoutLeftOut[] = [];
    const boxes: LayoutBox[] = [];
    const boxOf = (kind: LayoutBox['kind'], id: number, name: string, position: Point | undefined, number: number) => {
        if (position === undefined) { leftOut.push({ kind, id, number }); return; }
        const size = sizeOf(name);
        boxes.push({ kind, id, name, x: position.x, y: position.y, width: size?.[0] ?? 1, height: size?.[1] ?? 1,
            unsized: size === null, freeFacing: size !== null && facesFreely(name), samePlace: [] });
    };
    // a machine with no prototype has no size to claim
    lists.machines.forEach((machine, index) => boxOf('machine', machine.id, machine.prototype ?? '', machine.position, index + 1));
    lists.drills.forEach((drill, index) => boxOf('drill', drill.id, drill.type, drill.position, index + 1));
    lists.chests.forEach((chest, index) => boxOf('chest', chest.id, chest.type, chest.position, index + 1));
    for (const kind of ['machine', 'drill', 'chest'] as const) {
        for (const [box, others] of samePlaceOf(boxes.filter(box => box.kind === kind))) box.samePlace = others;
    }
    const boxFor = (type: 'machine' | 'chest', id: number) => boxes.find(box => box.kind === type && box.id === id);
    const existsInConfig = (type: 'machine' | 'chest', id: number) => (type === 'machine' ? lists.machines : lists.chests).some(entity => entity.id === id);

    const placedInserters: { id: number; position: Point; direction: LayoutInserter['direction']; entry: LayoutLists['inserters'][number] }[] = [];
    lists.inserters.forEach((entry, index) => {
        const id = entry.id ?? index + 1;
        if (entry.position === undefined) { leftOut.push({ kind: 'inserter', id, number: id }); return; }
        const direction = entry.direction !== undefined && Object.hasOwn(VECTOR, entry.direction) ? entry.direction as LayoutInserter['direction'] : null;
        placedInserters.push({ id, position: entry.position, direction, entry });
    });
    const spots = placedInserters.map(it => ({ ...it.position, kind: 'inserter' as const, id: it.id }));
    const marks = samePlaceOf(spots);

    const tiles = new Map<string, LayoutBeltTile>();
    const inserters: LayoutInserter[] = placedInserters.map((it, at) => {
        const { entry, position, direction } = it;
        const reach = reachOf(entry.prototype);
        const vector = direction === null ? null : VECTOR[direction];
        const endOf = (role: 'pickup' | 'drop', end: { type: EndType; id: number; belt_direction?: number }): LayoutEnd => {
            const away = role === 'pickup' ? reach.pickup : -reach.drop;
            const tile = vector === null ? null : { x: position.x + vector.x * away, y: position.y + vector.y * away };
            if (end.type === 'belt') {
                if (tile !== null) {
                    const centre = tileOf(tile);
                    const key = `${end.id}|${centre.x}|${centre.y}`;
                    const known = tiles.get(key) ?? { beltId: end.id, x: centre.x, y: centre.y, pickup: false, drop: false, direction: null };
                    tiles.set(key, { ...known, pickup: known.pickup || role === 'pickup', drop: known.drop || role === 'drop',
                        direction: known.direction ?? (role === 'drop' && end.belt_direction !== undefined ? end.belt_direction : null) });
                }
                return { role, type: end.type, id: end.id, tile, check: 'belt' };
            }
            if (tile === null) return { role, type: end.type, id: end.id, tile, check: 'no-tile' };
            const box = boxFor(end.type, end.id);
            const check: EndCheck = box !== undefined ? (box.unsized ? 'no-size' : inBox(box, tile) ? 'inside' : 'outside')
                : existsInConfig(end.type, end.id) ? 'no-position' : 'no-entity';
            return { role, type: end.type, id: end.id, tile, check };
        };
        return {
            number: it.id, id: it.id, x: position.x, y: position.y, direction,
            ends: [endOf('pickup', entry.source), endOf('drop', entry.sink)],
            samePlace: marks.get(spots[at]) ?? [],
        };
    });
    const beltTiles = [...tiles.values()];
    return {
        boxes, inserters, beltTiles, leftOut,
        belts: lists.belts.map(belt => ({ id: belt.id, tiles: beltTiles.filter(tile => tile.beltId === belt.id).length })),
    };
}
