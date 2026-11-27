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

interface KnownMismatch {
    /** The id of the example in the list */
    example: string;
    /** The inserter's number and the end that lies outside its entity */
    inserter: number;
    role: 'pickup' | 'drop';
    reason: string;
}

/**
 * Where the build the example comes from has more chests than the example states, an inserter's end lies on a chest the example does
 * not have. The example keeps what it states, so that end is drawn from the place the inserter has and lies outside the one chest
 * box. Only these ends may; each must still be there, so a mended example takes its line out.
 */
const KNOWN_MISMATCHES: KnownMismatch[] = [
    { example: 'automation-science', inserter: 4, role: 'pickup', reason: 'the build has a chest for each of the four feeders; the example states two, each for two feeders' },
    { example: 'automation-science', inserter: 6, role: 'pickup', reason: 'the build has a chest for each of the four feeders; the example states two, each for two feeders' },
    { example: 'electromagnetic-science', inserter: 3, role: 'drop', reason: 'the build has a chest for each of the two output inserters; the example states one for both' },
];

// every example "Try an example" offers: a tenth one is held to the same, whatever its length
describe.each(EXAMPLES)('the example $id opens in the Layout view as a picture', ({ id, path }) => {
    it('has every entity placed, every inserter facing, and every end on an entity or a belt', async () => {
        const config = await loadConfigFromFile(new URL(path, SAMPLES).pathname);
        const form = configToFormData(config);
        const lists: LayoutLists = { machines: form.machines, drills: form.drills?.configs ?? [], inserters: form.inserters, belts: form.belts, chests: form.chests };
        const layout = layoutOf(lists, tileSizeOf);

        expect(layout.leftOut, 'entities with no position').toEqual([]);
        expect(layout.inserters, 'inserters drawn').toHaveLength(lists.inserters.length);
        const withoutDirection = layout.inserters.filter(inserter => inserter.direction === null).map(inserter => inserter.number);
        expect(withoutDirection, 'inserters with no direction of 0, 4, 8 or 12').toEqual([]);
        const ends = layout.inserters.flatMap(inserter => inserter.ends.map(end => ({ inserter: inserter.number, role: end.role, check: end.check })));
        const known = KNOWN_MISMATCHES.filter(mismatch => mismatch.example === id);
        const isKnown = (end: { inserter: number; role: string }) => known.some(mismatch => mismatch.inserter === end.inserter && mismatch.role === end.role);
        // every end is inside its entity or on a belt
        expect(ends.filter(end => end.check !== 'inside' && end.check !== 'belt' && !isKnown(end)),
            'ends that are not inside their entity or on a belt').toEqual([]);
        expect(known.filter(mismatch => !ends.some(end => end.inserter === mismatch.inserter && end.role === mismatch.role && end.check === 'outside')),
            'known mismatches that are no longer outside their entity').toEqual([]);

        const boxes = layout.boxes;
        expect(boxes).toHaveLength(lists.machines.length + lists.drills.length + lists.chests.length);
        const off = [
            ...boxes.filter(box => !placedOnGrid(box, [box.width, box.height])).map(box => `${box.kind} ${box.id}`),
            ...layout.inserters.filter(inserter => !placedOnGrid(inserter, [1, 1])).map(inserter => `inserter ${inserter.number}`),
        ];
        expect(off, 'entities off the grid of their size').toEqual([]);
    });
});
