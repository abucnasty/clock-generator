import { describe, expect, it } from 'vitest';
import { questionLanes, questionLayoutFeed, type FeedQuestion, type FeedSource } from './questionLayoutFeed';
import { tileKey } from './layoutLanes';

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

const question = (first: number, lane: 1 | 2, candidates = ['iron-plate', 'copper-plate']): FeedQuestion =>
    ({ key: `lane-item:${first}:${lane}`, kind: 'lane-item', subject: { label: `Belt ${first}`, entity_number: first, lane }, candidates });
const shownOf = (...questions: FeedQuestion[]) => new Map(questions.map(q => [q.key, q]));

/** The paste of the feed, with the questions that are asked now */
const asking = (...asked: FeedQuestion[]) => ({ ...paste(), questions: asked });

describe('the lanes the layout view edits, from a paste, the questions the panel has shown and the answers', () => {
    it('maps each asked lane of a line to the key of its question, with its candidates, on the belt of the line\'s place', () => {
        const asked = [question(40, 1), question(40, 2, ['steel-plate'])];
        const { belts, keyOf } = questionLanes(asking(...asked), shownOf(...asked), {});
        expect(belts.get(1)?.lanes.map(lane => [lane.id, lane.side, lane.item, lane.candidates])).toEqual([[1, 'left', null, ['iron-plate', 'copper-plate']], [2, 'right', null, ['steel-plate']]]);
        expect(keyOf(1, 1)).toEqual({ first: 40, key: 'lane-item:40:1' });
        expect(keyOf(1, 2)).toEqual({ first: 40, key: 'lane-item:40:2' });
        expect(keyOf(9, 1)).toBeNull();
    });

    it('gives a lane that is answered, and no longer asked, its answer as the item and the candidates of its shown question', () => {
        const first = question(40, 1);
        const { belts } = questionLanes(asking(question(40, 2)), shownOf(first, question(40, 2)), { 'lane-item:40:1': 'copper-plate' });
        expect(belts.get(1)?.lanes.map(lane => [lane.item, lane.candidates])).toEqual([['copper-plate', ['iron-plate', 'copper-plate']], [null, ['iron-plate', 'copper-plate']]]);
    });

    it('gives a lane that the import filled its item with no control, though its question was shown and no answer was given', () => {
        // lane 1 of the line is answered; lane 2 was asked in the first round and is filled now
        const filled = { ...paste(), questions: [], belts: [belt(1, ['copper-plate', 'iron-plate']), belt(2, ['copper-plate'])] as FeedSource['belts'] };
        const { belts } = questionLanes(filled, shownOf(question(10, 1), question(10, 2)), { 'lane-item:10:1': 'copper-plate' });
        expect(belts.get(2)?.lanes.map(lane => [lane.id, lane.item, lane.candidates !== null])).toEqual([[1, 'copper-plate', true], [2, 'iron-plate', false]]);
    });

    it('gives a lane with an item and no shown question a fixed item, and a lane with neither no item and no control', () => {
        const { belts } = questionLanes(asking(), shownOf(), {});
        // belt 3 is a line whose lanes are the one lane 2
        expect(belts.get(3)?.lanes.map(lane => [lane.id, lane.item, lane.candidates])).toEqual([[1, null, null], [2, 'copper-plate', null]]);
    });

    describe('the rate of a lane', () => {
        const rateQuestion = (first: number, lane: 1 | 2): FeedQuestion => ({ key: `lane-export:${first}:${lane}`, kind: 'lane-export', subject: { label: 'Belt 1', entity_number: first, lane, item: 'iron-plate' }, candidates: [] });

        it('gives a lane its rate where its question is shown and asked, empty until it is answered, with the key of that question', () => {
            const asked = [rateQuestion(40, 1)];
            const { belts, rateKeyOf } = questionLanes(asking(...asked), shownOf(...asked), {});
            expect(belts.get(1)?.lanes.map(lane => [lane.id, lane.rate])).toEqual([[1, null], [2, undefined]]);
            expect(rateKeyOf(1, 1)).toEqual({ first: 40, key: 'lane-export:40:1' });
            expect(rateKeyOf(1, 2)).toEqual({ first: 40, key: 'lane-export:40:2' });
            expect(rateKeyOf(9, 1)).toBeNull();
        });

        it('gives a lane that is answered, and no longer asked, the rate answered', () => {
            const { belts } = questionLanes(asking(), shownOf(rateQuestion(40, 1)), { 'lane-export:40:1': '40' });
            expect(belts.get(1)?.lanes.map(lane => lane.rate)).toEqual([40, undefined]);
        });

        it('gives a lane no rate where its question was never shown, or is neither asked nor answered, and leaves the lane\'s item key as it was', () => {
            expect(questionLanes(asking(), shownOf(), {}).belts.get(1)?.lanes.map(lane => lane.rate)).toEqual([undefined, undefined]);
            expect(questionLanes(asking(), shownOf(rateQuestion(40, 1)), {}).belts.get(1)?.lanes.map(lane => lane.rate)).toEqual([undefined, undefined]);
            expect(questionLanes(asking(), shownOf(), {}).keyOf(1, 1)).toEqual({ first: 40, key: 'lane-item:40:1' });
        });

        it('takes an answer that is no positive number for an empty field', () => {
            const asked = [rateQuestion(40, 1)];
            expect(questionLanes(asking(...asked), shownOf(...asked), { 'lane-export:40:1': 'abc' }).belts.get(1)?.lanes[0].rate).toBeNull();
        });
    });

    it('gives each tile a piece covers the direction of the piece: one tile, and two for a piece whose centre is on a tile edge', () => {
        const lines = [{ first: 10, place: 1, belt: null, lane_lines: [1, 2], pieces: [
            { entity_number: 10, x: 0.5, y: 0.5, direction: 4, shape: 'straight' }, { entity_number: 11, x: 2, y: 0.5, direction: 0, shape: null }, { entity_number: 12, x: 4.5, y: 3, direction: 8, shape: null },
        ] }];
        const { belts } = questionLanes({ ...asking(), layout: { ...paste().layout, lines } } as never, shownOf(), {});
        expect([...belts.get(1)!.directions].sort()).toEqual([
            [tileKey(0.5, 0.5), 4], [tileKey(1.5, 0.5), 0], [tileKey(2.5, 0.5), 0], [tileKey(4.5, 2.5), 8], [tileKey(4.5, 3.5), 8],
        ].sort());
    });

    it('has no belt for a line that no inserter end reaches', () => {
        const lines = [{ first: 10, place: 1, belt: null, lane_lines: [1, 2], pieces: [] }];
        expect(questionLanes({ ...asking(), layout: { ...paste().layout, lines } } as never, shownOf(), {}).belts.size).toBe(0);
    });
});
