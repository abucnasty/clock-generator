import { describe, expect, it } from 'vitest';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { EXAMPLES } from '../../scripts/examples.ts';
import { configToFormData } from './configForm/configMapping';
import { layoutOf, type LayoutLists, type Point } from './layoutOf';
import { tileSizeOf } from './layoutSizes';

const SAMPLES = new URL('../../../clock-generator/resources/config-samples/', import.meta.url);

/** Whether a coordinate is on the grid a side of this many tiles sets: a whole tile for an even side, a half tile for an odd one */
const onGrid = (coordinate: number, side: number): boolean => {
    const fraction = Math.abs(coordinate) % 1;
    return Math.round(side) % 2 === 0 ? Math.min(fraction, 1 - fraction) < 1e-9 : Math.abs(fraction - 0.5) < 1e-9;
};

/** A place on the grid of its size; a box of unequal sides may lie either way round */
const placedOnGrid = (place: Point, size: readonly [number, number]): boolean =>
    (onGrid(place.x, size[0]) && onGrid(place.y, size[1])) || (onGrid(place.x, size[1]) && onGrid(place.y, size[0]));

// every example "Try an example" offers: a tenth one is held to the same, whatever its length
describe.each(EXAMPLES)('the example $id opens in the Layout view as a picture', ({ path }) => {
    it('has every entity placed, every inserter facing, and every end on an entity or a belt', async () => {
        const config = await loadConfigFromFile(new URL(path, SAMPLES).pathname);
        const form = configToFormData(config);
        const lists: LayoutLists = { machines: form.machines, drills: form.drills?.configs ?? [], inserters: form.inserters, belts: form.belts, chests: form.chests };
        const layout = layoutOf(lists, tileSizeOf);

        expect(layout.leftOut, 'entities with no position').toEqual([]);
        expect(layout.inserters, 'inserters drawn').toHaveLength(lists.inserters.length);
        expect(layout.inserters.filter(inserter => inserter.direction === null).map(inserter => inserter.number), 'inserters with no direction of 0, 4, 8 or 12').toEqual([]);
        const ends = layout.inserters.flatMap(inserter => inserter.ends.map(end => ({ inserter: inserter.number, role: end.role, check: end.check })));
        expect(ends.filter(end => end.check !== 'inside' && end.check !== 'belt'), 'ends that are not inside their entity or on a belt').toEqual([]);

        const boxes = layout.boxes;
        expect(boxes).toHaveLength(lists.machines.length + lists.drills.length + lists.chests.length);
        const off = [
            ...boxes.filter(box => !placedOnGrid(box, [box.width, box.height])).map(box => `${box.kind} ${box.id}`),
            ...layout.inserters.filter(inserter => !placedOnGrid(inserter, [1, 1])).map(inserter => `inserter ${inserter.number}`),
        ];
        expect(off, 'entities off the grid of their size').toEqual([]);
    });
});
