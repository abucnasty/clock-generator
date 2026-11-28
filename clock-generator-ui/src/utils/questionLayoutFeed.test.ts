import { describe, expect, it } from 'vitest';
import { questionLayoutFeed, type FeedSource } from './questionLayoutFeed';

const machine = (id: number) => ({ id, recipe: '', productivity: 0, crafting_speed: 1, position: { x: id * 4, y: 0 } });
const belt = (id: number, ingredients: string[]) => ({ id, type: 'transport-belt' as const, lanes: ingredients.map(ingredient => ({ ingredient, stack_size: 1 })) });
const inserter = (id: number, source: { type: 'machine' | 'belt' | 'chest'; id: number }, sink: { type: 'machine' | 'belt' | 'chest'; id: number }) =>
    ({ id, source, sink, position: { x: id, y: 2 }, direction: 0 });
const drill = (id: number, mined_item_name: string) =>
    ({ id, type: 'electric-mining-drill' as const, mined_item_name, speed_bonus: 0, productivity: 0, target: { type: 'machine' as const, id: 1 }, position: { x: 0, y: 9 }, direction: 0 });
const piece = (entity_number: number, x: number) => ({ entity_number, x, y: 5, direction: 4, shape: 'straight' as const });

/**
 * A paste whose belt 1 of the lists spans two lines (places 2 and 4), one line of a belt of its own (place 3), and one line
 * that an open question keeps out (place 1, its row and its inserter held back, after the kept ones). Its drill 1 is the
 * drill of place 2; the drill of place 1 is asked.
 */
const paste = (): FeedSource => ({
    machines: [machine(1), machine(2)] as FeedSource['machines'],
    drills: [drill(1, 'iron-ore')] as FeedSource['drills'],
    inserters: [inserter(1, { type: 'machine', id: 1 }, { type: 'belt', id: 1 }), inserter(2, { type: 'belt', id: 1 }, { type: 'machine', id: 2 }),
        inserter(3, { type: 'belt', id: 2 }, { type: 'machine', id: 2 })] as FeedSource['inserters'],
    belts: [belt(1, ['iron-plate', '']), belt(2, ['copper-plate'])] as FeedSource['belts'],
    chests: [] as FeedSource['chests'],
    layout: {
        drop_lanes: [], drop_positions: [], output_lines: [],
        lines: [
            { first: 10, place: 2, belt: 1, lane_lines: [1, 2], pieces: [piece(10, 1)] },
            { first: 20, place: 4, belt: 1, lane_lines: [1, 2], pieces: [piece(20, 9)] },
            { first: 30, place: 3, belt: 2, lane_lines: [2], pieces: [piece(30, 13)] },
            { first: 40, place: 1, belt: null, lane_lines: [1, 2], pieces: [piece(40, 17)] },
        ],
        drills: [{ entity_number: 100, place: 2, drill: 1 }, { entity_number: 101, place: 1, drill: null }],
        inserter_lines: [
            { entity_number: 200, id: 1, held_back: false, source_line: null, sink_line: 10 },
            { entity_number: 201, id: 2, held_back: false, source_line: 20, sink_line: null },
            { entity_number: 202, id: 3, held_back: false, source_line: 30, sink_line: null },
            { entity_number: 203, id: 4, held_back: true, source_line: 40, sink_line: null },
        ],
        held_back: {
            belts: [belt(1, ['', ''])],
            inserters: [inserter(4, { type: 'belt', id: 1 }, { type: 'machine', id: 1 })],
            drills: [drill(1, '')],
        },
    } as unknown as FeedSource['layout'],
});

const ids = (rows: readonly { id: number }[]) => rows.map(row => row.id);

describe('the lists the layout view is given while the import is asked', () => {
    it('no two rows of a list share an id', () => {
        const feed = questionLayoutFeed(paste());
        for (const list of [feed.machines, feed.inserters, feed.belts, feed.chests, feed.drills]) expect(new Set(ids(list)).size).toBe(list.length);
        expect(ids(feed.belts).sort()).toEqual([1, 2, 3, 4]);
        expect(ids(feed.drills).sort()).toEqual([1, 2]);
    });

    it('every inserter\'s belt end names a belt row of the lists', () => {
        const feed = questionLayoutFeed(paste());
        const beltIds = new Set(ids(feed.belts));
        const ends = feed.inserters.flatMap(it => [it.source, it.sink]).filter(end => end.type === 'belt');
        expect(ends.length).toBe(4);
        for (const end of ends) expect(beltIds.has(end.id)).toBe(true);
        // the kept inserters are on the place of their line, the held-back one on the place it came with
        expect(feed.inserters.map(it => [it.id, it.source.type === 'belt' ? it.source.id : 0, it.sink.type === 'belt' ? it.sink.id : 0]))
            .toEqual([[1, 0, 2], [2, 4, 0], [3, 3, 0], [4, 1, 0]]);
    });

    it('a belt whose id spans two lines gives two rows, each with its lanes', () => {
        const feed = questionLayoutFeed(paste());
        const rows = feed.belts.filter(row => row.id === 2 || row.id === 4);
        expect(rows.map(row => row.lanes.map(lane => lane.ingredient))).toEqual([['iron-plate', ''], ['iron-plate', '']]);
        expect(feed.belts.find(row => row.id === 3)?.lanes.map(lane => lane.ingredient)).toEqual(['copper-plate']);
        expect(feed.belts.find(row => row.id === 1)?.lanes.map(lane => lane.ingredient)).toEqual(['', '']);
    });

    it('a drill takes the place of its drill and the held-back drill keeps its own', () => {
        const feed = questionLayoutFeed(paste());
        expect(feed.drills.map(row => [row.id, row.mined_item_name])).toEqual([[2, 'iron-ore'], [1, '']]);
    });

    it('a paste with no chest gives no chest, and no machine of an empty form is drawn', () => {
        const feed = questionLayoutFeed(paste());
        expect(feed.chests).toEqual([]);
        expect(ids(feed.machines)).toEqual([1, 2]);
        expect(questionLayoutFeed({ ...paste(), machines: [] }).machines).toEqual([]);
    });
});
