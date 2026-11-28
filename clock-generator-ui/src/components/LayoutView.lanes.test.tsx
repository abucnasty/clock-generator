// @vitest-environment happy-dom
import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { belt, bufferChest, inserter, show } from '../test/fixtures';
import type { LaneEditor, LaneEditorBelt } from '../utils/layoutLanes';
import { tileKey } from '../utils/layoutLanes';
import { LayoutView } from './LayoutView';

const LEFT_OF: Record<number, [number, number]> = { 0: [-1, 0], 4: [0, -1], 8: [1, 0], 12: [0, 1] };

/** The tile of belt 1 at (0.5, 0.5), picked from by an inserter that takes its items to a chest */
const lists = () => ({
    machines: [], drills: [],
    inserters: [inserter(1, { source: { type: 'belt', id: 1 }, sink: { type: 'chest', id: 1 }, position: { x: 1.5, y: 0.5 }, direction: 12 })],
    belts: [belt(1)],
    chests: [bufferChest(1, { position: { x: 2.5, y: 0.5 } })],
});

const lanesOf = (directions: ReadonlyMap<string, number>, candidates: readonly string[] | null = ['iron-plate', 'copper-plate']): LaneEditorBelt => ({
    lanes: [{ id: 1, side: 'left', item: null, candidates }, { id: 2, side: 'right', item: 'iron-plate', candidates: null }],
    directions,
});
const editor = (belts: ReadonlyMap<number, LaneEditorBelt>, onEdit: LaneEditor['onEdit'] = () => {}, markedLane: number | null = null): LaneEditor =>
    ({ belts, itemNames: ['iron-plate', 'copper-plate', 'steel-plate'], markedLane, onEdit });

const draw = (laneEditor: LaneEditor | null | undefined, props: Partial<Parameters<typeof LayoutView>[0]> = {}, shown = lists()) => show(
    <LayoutView {...shown} orbits={null} selection={null} onSelectionChange={() => {}} laneEditor={laneEditor} {...props} />,
);
const lane = (tile: Element, side: 'left' | 'right') => tile.querySelector(`[data-lane-side="${side}"]`)!;
const centre = (element: Element): [number, number] =>
    [Number(element.getAttribute('x')) + Number(element.getAttribute('width')) / 2, Number(element.getAttribute('y')) + Number(element.getAttribute('height')) / 2];

describe('the lane editor mode of the Layout view', () => {
    it.each([[0, 'north'], [4, 'east'], [8, 'south'], [12, 'west']])('with the belt facing %i (%s), the left lane is on the left of travel', direction => {
        const { container } = draw(editor(new Map([[1, lanesOf(new Map([[tileKey(0.5, 0.5), direction]]))]])));
        const tile = within(container).getByRole('button', { name: 'Belt 1' });
        const [left, right] = [centre(lane(tile, 'left')), centre(lane(tile, 'right'))];
        const [dx, dy] = LEFT_OF[direction];
        expect(Math.sign(left[0])).toBe(dx);
        expect(Math.sign(left[1])).toBe(dy);
        expect(right[0]).toBeCloseTo(-left[0]);
        expect(right[1]).toBeCloseTo(-left[1]);
        expect(lane(tile, 'left').getAttribute('data-lane')).toBe('1');
        expect(lane(tile, 'right').getAttribute('data-lane')).toBe('2');
    });

    it('draws an underground entrance and its exit of one belt id, each with its two lanes and one number', () => {
        const two = lists();
        two.inserters.push(inserter(2, { source: { type: 'belt', id: 1 }, sink: { type: 'chest', id: 2 }, position: { x: 11.5, y: 0.5 }, direction: 12 }));
        two.chests.push(bufferChest(2, { position: { x: 12.5, y: 0.5 } }));
        const directions = new Map([[tileKey(0.5, 0.5), 4], [tileKey(10.5, 0.5), 4]]);
        const { container } = draw(editor(new Map([[1, lanesOf(directions)]])), {}, two);
        const tiles = within(container).getAllByRole('button', { name: 'Belt 1' });
        expect(tiles).toHaveLength(2);
        for (const tile of tiles) expect(tile.querySelectorAll('[data-lane]')).toHaveLength(2);
        expect([...container.querySelectorAll('[data-belt-label]')].map(label => label.textContent)).toEqual(['b1', 'b1']);
    });

    it('draws no lane with the mode off, or on a belt the mode has no lanes for', () => {
        expect(draw(undefined).container.querySelector('[data-lane]')).toBeNull();
        expect(draw(null).container.querySelector('[data-lane]')).toBeNull();
        expect(draw(editor(new Map())).container.querySelector('[data-lane]')).toBeNull();
    });

    it('shows the editor of the selected belt: the candidates and "Another item" for a lane that has them, the item alone for a fixed lane', () => {
        const { container } = draw(editor(new Map([[1, lanesOf(new Map([[tileKey(0.5, 0.5), 4]]))]])), { selection: { kind: 'belt', id: 1 } });
        const group = within(container).getByRole('group', { name: 'Lanes of Belt 1' });
        expect(within(group).getByRole('button', { name: 'iron-plate for lane 1' })).toBeDefined();
        expect(within(group).getByRole('button', { name: 'copper-plate for lane 1' })).toBeDefined();
        expect(within(group).getByRole('combobox', { name: 'Another item for lane 1' })).toBeDefined();
        // lane 2 carries iron plate and has no control
        expect(within(group).queryByRole('button', { name: /for lane 2/ })).toBeNull();
        expect(within(group).queryByRole('combobox', { name: /lane 2/ })).toBeNull();
        expect(group.querySelector('[data-lane-editor="2"]')?.textContent).toContain('iron-plate');
    });

    it('shows no editor where no belt is selected, or where the selected belt is not in the mode', () => {
        const belts = new Map([[1, lanesOf(new Map([[tileKey(0.5, 0.5), 4]]))]]);
        expect(within(draw(editor(belts)).container).queryByRole('group', { name: /^Lanes of/ })).toBeNull();
        expect(within(draw(editor(new Map()), { selection: { kind: 'belt', id: 1 } }).container).queryByRole('group', { name: /^Lanes of/ })).toBeNull();
    });

    it('marks the lane that the caller marks', () => {
        const { container } = draw(editor(new Map([[1, lanesOf(new Map([[tileKey(0.5, 0.5), 4]]))]]), () => {}, 1), { selection: { kind: 'belt', id: 1 } });
        const group = within(container).getByRole('group', { name: 'Lanes of Belt 1' });
        expect(group.querySelector('[data-lane-editor="1"]')?.getAttribute('data-marked')).toBe('');
        expect(group.querySelector('[data-lane-editor="2"]')?.getAttribute('data-marked')).toBeNull();
    });

    it('calls back with the belt id, the lane and the item on an edit, and changes none of the lists it was given', async () => {
        const onEdit = vi.fn();
        const shown = lists();
        const before = JSON.stringify(shown);
        const { container, user } = draw(editor(new Map([[1, lanesOf(new Map([[tileKey(0.5, 0.5), 4]]))]]), onEdit), { selection: { kind: 'belt', id: 1 } }, shown);
        await user.click(within(container).getByRole('button', { name: 'copper-plate for lane 1' }));
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onEdit).toHaveBeenCalledWith(1, 1, 'copper-plate');
        expect(JSON.stringify(shown)).toBe(before);
    });

    it('shows a number field under the item of a lane that has a rate, for an item picked and for a fixed one, and none for a lane with none', () => {
        const rated: LaneEditorBelt = { directions: new Map([[tileKey(0.5, 0.5), 4]]), lanes: [
            { id: 1, side: 'left', item: 'iron-plate', candidates: null, rate: null }, { id: 2, side: 'right', item: 'iron-plate', candidates: null },
        ] };
        const { container } = draw(editor(new Map([[1, rated]])), { selection: { kind: 'belt', id: 1 } });
        const group = within(container).getByRole('group', { name: 'Lanes of Belt 1' });
        expect(within(group).getByRole('textbox', { name: 'Items a second for lane 1' })).toBeDefined();
        expect(within(group).queryByRole('textbox', { name: /lane 2/ })).toBeNull();
    });

    it('calls back with the belt id, the lane and the rate typed, when the field is left', async () => {
        const onRate = vi.fn();
        const rated: LaneEditorBelt = { directions: new Map([[tileKey(0.5, 0.5), 4]]), lanes: [
            { id: 1, side: 'left', item: 'iron-plate', candidates: null, rate: 40 }, { id: 2, side: 'right', item: 'iron-plate', candidates: null },
        ] };
        const { container, user } = draw({ ...editor(new Map([[1, rated]])), onRate }, { selection: { kind: 'belt', id: 1 } });
        const field = within(container).getByRole('textbox', { name: 'Items a second for lane 1' }) as HTMLInputElement;
        expect(field.value).toContain('40');
        await user.clear(field);
        await user.type(field, '25');
        await user.tab();
        expect(onRate).toHaveBeenLastCalledWith(1, 1, 25);
    });
});
