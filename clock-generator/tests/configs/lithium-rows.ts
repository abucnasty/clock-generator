import type { Config } from '../../src/config/schema';

/**
 * The output path of the lithium plate sample's scaffold (resources/config-samples/smelting/lithium-plate/), as built or
 * with the output inserters of some furnaces dropping into a chest that removes all, in place of the belt:
 * - `as built`: the output of all six furnaces on the two rows' lines
 * - `no side loads`: furnaces 7 and 8 (the side-loaded hands) into the chest
 * - `one furnace a row`: furnaces 3, 4, 7 and 8 into the chest, so only furnaces 5 and 6 drop on the lines
 */
export type LithiumRowsForm = 'as built' | 'no side loads' | 'one furnace a row';

/** The furnaces of each row, upstream first, and the lane of the row's line that carries their plates */
const ROWS = [
    { furnaces: [3, 5, 7], lane: 'right' as const, curves: { right_curves: 1 } },
    { furnaces: [4, 6, 8], lane: 'left' as const, curves: { left_curves: 1 } },
];
const IN_CHEST: Record<LithiumRowsForm, readonly number[]> = { 'as built': [], 'no side loads': [7, 8], 'one furnace a row': [3, 4, 7, 8] };
const CHEST = 5;

/**
 * The lithium plate sample's config (`sample`, as loaded) with its output belt stated, in the form asked. Each row of three
 * furnaces puts its plates onto a line of its own, as the scaffold has it:
 * - the first furnace's output inserter drops in line onto an underground entrance; the second's drops in line onto its
 *   exit, 10 tiles on; the third's drops onto a side belt (an underground pair, 3 tiles) that side-loads onto the line 4
 *   tiles on, from the line's right side on row 1 and its left side on row 2;
 * - the line turns (row 1 right, row 2 left) and side-loads, 10 tiles on, onto an underground entrance: row 1 from the
 *   entrance's left side, row 2 from its right side. That entrance's line runs 6 tiles to the loader into the infinity chest.
 *
 * The two rows side-load onto one entrance from its two sides, so the plates of each row go to the loader on a lane of their
 * own. Each row is stated as a group: its line, and its lane of the entrance's line to the loader.
 *
 * The entrance's hood lets one lane of each row's line pass: the right lane of row 1 and the left lane of row 2. The plates
 * of a row are on that lane, or they would stop at the hood. The in-line drops of row 2 are mirrored inserters in the
 * scaffold, and those of row 1 are not.
 */
export function lithiumRows(sample: Config, form: LithiumRowsForm): Config {
    const in_chest = IN_CHEST[form];
    const output_of = (furnace: number) => sample.inserters.findIndex(inserter => inserter.source.type === 'machine' && inserter.source.id === furnace
        && inserter.sink.type === 'belt');
    const inserters = sample.inserters.map((inserter, index) => in_chest.some(furnace => output_of(furnace) === index)
        ? { ...inserter, sink: { type: 'chest' as const, id: CHEST } } : inserter);
    // a number names an output inserter by its place among those that still drop on the belt, in the config's order
    const on_belt = inserters.flatMap((inserter, index) => inserter.source.type === 'machine' && inserter.sink.type === 'belt' ? [index] : []);
    const number = (furnace: number) => on_belt.indexOf(output_of(furnace)) + 1;

    const rows = ROWS.map(({ furnaces: [first, second, third], lane, curves }) => {
        const points: NonNullable<Config['output_belt']>['stretches'][number]['points'] = [];
        // the tiles from the last point stated: a stretch's first point has none
        let tiles = 0;
        const point = (what: (typeof points)[number]) => {
            points.push(points.length === 0 ? what : { tiles, ...what });
            tiles = 0;
        };
        if (!in_chest.includes(first)) point({ drop: number(first), lane });
        tiles += 10;
        point({ drop: number(second), lane });
        tiles += 4;
        if (!in_chest.includes(third)) point({ side_load: [number(third)], lane, layout: 'side-straight' });
        tiles += 10;
        point(curves);
        return points;
    });
    const end = (stretch: number, lane: 'left' | 'right') => ({ points: [
        { side_load: { stretch }, lane, layout: 'side-entrance' as const },
        { tiles: 6, lane_end: { kind: 'infinite' as const } },
    ] });
    // each side-loaded output inserter drops in line onto an underground entrance, on its right lane
    const side_belt = in_chest.includes(7) && in_chest.includes(8) ? {} : { side_belt: { lane: 'right' as const, tiles: 3 } };

    return {
        ...sample,
        inserters,
        chests: [...(sample.chests ?? []), ...(in_chest.length === 0 ? [] : [{ type: 'infinity-chest' as const, id: CHEST, item_filter: [], remove_unfiltered_items: true }])],
        output_belt: {
            ...side_belt,
            stretch_groups: [[1, 3], [2, 4]],
            stretches: [{ points: rows[0] }, { points: rows[1] }, end(1, 'left'), end(2, 'right')],
        },
    } as Config;
}
