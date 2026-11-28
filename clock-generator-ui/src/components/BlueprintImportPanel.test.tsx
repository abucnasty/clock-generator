// @vitest-environment happy-dom
import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImportQuestion } from 'clock-generator/browser';
import { show } from '../test/fixtures';
import type { PastedBlueprint } from '../worker/types';
import { BlueprintImportPanel } from './BlueprintImportPanel';

const ITEMS = ['iron-plate', 'copper-plate', 'inserter', 'transport-belt'];
const PROFILES = [{ id: 'none', name: 'No research', isTemplate: true }];

/** The belt line of a lane question: its pieces run south at x, with an inserter at its west side that takes into a machine */
const lineAt = (first: number, place: number, x: number, belt: number | null = null) =>
    ({ first, place, belt, lane_lines: [1, 2], pieces: [{ entity_number: first, x: x + 0.5, y: 0.5, direction: 8, shape: 'straight' }] });
const beltRow = (id: number, lanes: string[]) => ({ id, type: 'transport-belt', lanes: lanes.map(ingredient => ({ ingredient, stack_size: 1 })) });
const takerAt = (id: number, belt: number, x: number) =>
    ({ id, source: { type: 'belt', id: belt }, sink: { type: 'machine', id }, prototype: 'inserter', position: { x: x + 1.5, y: 0.5 }, direction: 12 });
const laneQuestion = (first: number, place: number, lane: 1 | 2): ImportQuestion =>
    ({ key: `lane-item:${first}:${lane}`, kind: 'lane-item', subject: { label: `Belt ${place}`, entity_number: first, lane }, candidates: ['inserter', 'transport-belt'] });
const sharingQuestion = (first: number, place: number): ImportQuestion =>
    ({ key: `lane-sharing:${first}`, kind: 'lane-sharing', subject: { label: `Belt ${place}`, entity_number: first }, candidates: ['shared', 'per_copy'] });
const exportQuestion = (first: number, place: number, lane: 1 | 2): ImportQuestion =>
    ({ key: `lane-export:${first}:${lane}`, kind: 'lane-export', subject: { label: `Belt ${place}`, entity_number: first, lane, item: 'iron-plate' }, candidates: [] });
const drillQuestion = (): ImportQuestion =>
    ({ key: 'drill-ore:300', kind: 'drill-ore', subject: { label: 'Drill 2', entity_number: 300 }, candidates: ['iron-ore', 'copper-ore'] });

interface Hand { places?: [number, number]; questions?: ImportQuestion[]; written?: boolean; drill?: boolean }

/**
 * A pasted blueprint made by hand: two belt lines at the given places, each with a taker into a machine, and the questions
 * given. With `written`, the first line is a belt of the lists (its lanes are filled), as after one answer.
 */
function pastedOf({ places = [1, 2], questions = [], written = false, drill = false }: Hand = {}): PastedBlueprint {
    const [one, two] = places;
    const held = [beltRow(one, ['', '']), beltRow(two, ['', ''])];
    return {
        machines: [{ id: 1, recipe: 'logistic-science-pack', prototype: 'assembling-machine-3', productivity: 0, crafting_speed: 1, position: { x: 3.5, y: 0.5 } },
            { id: 2, recipe: 'logistic-science-pack', prototype: 'assembling-machine-3', productivity: 0, crafting_speed: 1, position: { x: 13.5, y: 0.5 } }],
        drills: [], inserters: written ? [takerAt(1, 1, 0)] : [], belts: written ? [beltRow(1, ['inserter', 'transport-belt'])] : [], chests: [],
        guidance: { _tag: 'None' }, suggested_target: { _tag: 'None' },
        questions, notes: [], read: [{ name: 'belt', count: 2 }], ignored: [], copy_offset: null,
        research: { profile: 'No research', template: 'no-research', bonuses: { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} } },
        entities: [{ entity_number: 14, name: 'transport-belt' }, { entity_number: 38, name: 'transport-belt' }, { entity_number: 300, name: 'electric-mining-drill' }],
        speeds: [],
        layout: {
            drop_lanes: [], drop_positions: [], output_lines: [],
            lines: [lineAt(14, one, 0, written ? 1 : null), lineAt(38, two, 10)],
            drills: drill ? [{ entity_number: 300, place: 2, drill: null }] : [],
            inserter_lines: [{ entity_number: 500, id: written ? 1 : 1, held_back: !written, source_line: 14, sink_line: null }, { entity_number: 501, id: 2, held_back: true, source_line: 38, sink_line: null }],
            held_back: {
                belts: written ? [held[1]] : held,
                inserters: [...(written ? [] : [takerAt(1, one, 0)]), takerAt(2, two, 10)],
                drills: drill ? [{ id: 2, type: 'electric-mining-drill', mined_item_name: '', speed_bonus: 0, productivity: 0, target: { type: 'machine', id: 1 }, position: { x: 20, y: 0 }, direction: 0 }] : [],
            },
        },
    } as unknown as PastedBlueprint;
}

const LANES = (places: [number, number] = [1, 2]) => [laneQuestion(14, places[0], 1), laneQuestion(14, places[0], 2), laneQuestion(38, places[1], 1), laneQuestion(38, places[1], 2)];

function draw(pasted: PastedBlueprint, props: { answers?: Record<string, string>; onAnswer?: (key: string, value: string) => void } = {}) {
    const onAnswer = props.onAnswer ?? vi.fn();
    const shown = show(<BlueprintImportPanel pasted={pasted} profiles={PROFILES} profileId="none" onProfileChange={() => {}} answers={props.answers ?? {}} onAnswer={onAnswer} itemNames={ITEMS} />);
    const again = (next: PastedBlueprint, answers: Record<string, string> = props.answers ?? {}) =>
        shown.rerender(<BlueprintImportPanel pasted={next} profiles={PROFILES} profileId="none" onProfileChange={() => {}} answers={answers} onAnswer={onAnswer} itemNames={ITEMS} />);
    return { ...shown, onAnswer, again };
}
const row = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-question="${key}"]`);
const view = (container: HTMLElement) => container.querySelector('svg[aria-label="The layout of the build"]');

describe('the layout view of the import dialog', () => {
    it('draws each belt that the questions name with the number of its label: the tile label, its accessible name and its legend row', () => {
        const { container } = draw(pastedOf({ questions: LANES() }));
        expect(view(container)).not.toBeNull();
        expect([...container.querySelectorAll('[data-belt-label]')].map(label => label.textContent).sort()).toEqual(['b1', 'b2']);
        expect(within(container).getAllByRole('button', { name: /^Belt \d+$/ }).map(tile => tile.getAttribute('aria-label')).sort()).toEqual(['Belt 1', 'Belt 2']);
        const legend = container.querySelector('[data-layout-legend]')!;
        expect(legend.textContent).toContain('Belt 1');
        expect(legend.textContent).toContain('Belt 2');
        // the rows say the same numbers
        expect(row(container, 'lane-item:14:1')!.textContent).toContain('Belt 1, lane 1');
        expect(row(container, 'lane-item:38:2')!.textContent).toContain('Belt 2, lane 2');
    });

    it('draws a build whose place numbers skip, 3 and 5, with 3 and 5', () => {
        const { container } = draw(pastedOf({ places: [3, 5], questions: LANES([3, 5]) }));
        expect([...container.querySelectorAll('[data-belt-label]')].map(label => label.textContent).sort()).toEqual(['b3', 'b5']);
        expect(within(container).getAllByRole('button', { name: /^Belt \d+$/ }).map(tile => tile.getAttribute('aria-label')).sort()).toEqual(['Belt 3', 'Belt 5']);
        expect(container.querySelector('[data-layout-legend]')!.textContent).toMatch(/Belt 3.*Belt 5/);
    });

    it.each([
        ['an item button', (r: HTMLElement) => within(r).getByRole('button', { name: 'inserter' })],
        ['the select', (r: HTMLElement) => within(r).getByRole('combobox')],
    ])('focusing %s of a lane row selects its belt and marks its lane, and only that lane\'s row', (_, control) => {
        const { container } = draw(pastedOf({ questions: LANES() }));
        const target = row(container, 'lane-item:38:2')!;
        fireEvent.focus(control(target));
        expect(container.textContent).toContain('Selected: Belt 2.');
        const marked = [...container.querySelectorAll('[data-question][data-marked]')].map(it => it.getAttribute('data-question'));
        expect(marked).toEqual(['lane-item:38:2']);
        expect(container.querySelector('[data-lane-editor="2"]')?.getAttribute('data-marked')).toBe('');
        expect(container.querySelector('[data-lane-editor="1"]')?.getAttribute('data-marked')).toBeNull();
    });

    it('marks the whole belt for a sharing row, and a pointer on a row selects as focus does', () => {
        const { container } = draw(pastedOf({ questions: [...LANES(), sharingQuestion(38, 2)] }));
        fireEvent.focus(within(row(container, 'lane-sharing:38')!).getAllByRole('radio')[0]);
        expect(container.textContent).toContain('Selected: Belt 2.');
        expect([...container.querySelectorAll('[data-question][data-marked]')].map(it => it.getAttribute('data-question')).sort())
            .toEqual(['lane-item:38:1', 'lane-item:38:2', 'lane-sharing:38']);
        fireEvent.pointerEnter(row(container, 'lane-item:14:1')!);
        expect(container.textContent).toContain('Selected: Belt 1.');
        expect([...container.querySelectorAll('[data-question][data-marked]')].map(it => it.getAttribute('data-question'))).toEqual(['lane-item:14:1']);
    });

    it('marks the rows of a belt that is selected on the layout', async () => {
        const { container, user } = draw(pastedOf({ questions: LANES() }));
        await user.click(within(container).getByRole('button', { name: 'Belt 2' }));
        expect([...container.querySelectorAll('[data-question][data-marked]')].map(it => it.getAttribute('data-question')).sort()).toEqual(['lane-item:38:1', 'lane-item:38:2']);
    });

    it('calls onAnswer with the row\'s key for an answer made on the layout, and the answer shows in its row', async () => {
        const onAnswer = vi.fn();
        const { container, user, again } = draw(pastedOf({ questions: LANES() }), { onAnswer });
        fireEvent.focus(within(row(container, 'lane-item:14:1')!).getByRole('button', { name: 'transport-belt' }));
        await user.click(within(container).getByRole('button', { name: 'inserter for lane 1' }));
        expect(onAnswer).toHaveBeenCalledWith('lane-item:14:1', 'inserter');
        // the dialog gives the answer back
        again(pastedOf({ questions: LANES().slice(1) }), { 'lane-item:14:1': 'inserter' });
        expect(within(row(container, 'lane-item:14:1')!).getByRole('button', { name: 'inserter' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps an answered lane row, marked answered with its answer, after the import is asked again and has dropped its question', () => {
        const { container, again } = draw(pastedOf({ questions: LANES() }));
        again(pastedOf({ questions: LANES().slice(1) }), { 'lane-item:14:1': 'inserter' });
        const answered = row(container, 'lane-item:14:1')!;
        expect(answered).not.toBeNull();
        expect(answered.getAttribute('data-answered')).toBe('');
        expect(answered.textContent).toContain('Answered');
        expect(row(container, 'lane-item:14:2')!.getAttribute('data-answered')).toBeNull();
    });

    it('shows a lane that the import filled with its item and no control, and gives it no row', () => {
        const { container, again } = draw(pastedOf({ questions: [laneQuestion(14, 1, 1), laneQuestion(14, 1, 2)] }));
        // lane 1 is answered and lane 2 is filled: the first line is a belt of the lists now
        again(pastedOf({ written: true, questions: [] }), { 'lane-item:14:1': 'inserter' });
        expect(row(container, 'lane-item:14:1')).not.toBeNull();
        expect(row(container, 'lane-item:14:2')).toBeNull();
        fireEvent.click(within(container).getByRole('button', { name: 'Belt 1' }));
        const filled = container.querySelector('[data-lane-editor="2"]')!;
        expect(filled.textContent).toContain('transport-belt');
        expect(within(filled as HTMLElement).queryByRole('button')).toBeNull();
        expect(within(filled as HTMLElement).queryByRole('combobox')).toBeNull();
    });

    it('keeps the view after the last question is answered, while the panel is shown', () => {
        const { container, again } = draw(pastedOf({ questions: LANES() }));
        again(pastedOf({ written: true, questions: [] }), { 'lane-item:14:1': 'inserter', 'lane-item:38:1': 'inserter', 'lane-item:38:2': 'transport-belt' });
        expect(view(container)).not.toBeNull();
        expect(container.querySelector('[role="group"][aria-label="Questions"]')).not.toBeNull();
    });

    it('does not remount the view for an answer: a lane picked on the layout keeps the view\'s own svg', async () => {
        const { container, user, again } = draw(pastedOf({ questions: LANES() }));
        const before = view(container);
        fireEvent.focus(within(row(container, 'lane-item:14:1')!).getByRole('button', { name: 'transport-belt' }));
        await user.click(within(container).getByRole('button', { name: 'inserter for lane 1' }));
        again(pastedOf({ questions: LANES().slice(1) }), { 'lane-item:14:1': 'inserter' });
        expect(view(container)).toBe(before);
    });

    it('shows the view for a build whose only question is a drill question, and marks that drill', () => {
        const { container, again } = draw(pastedOf({ drill: true, questions: [drillQuestion()] }));
        expect(view(container)).not.toBeNull();
        fireEvent.focus(within(row(container, 'drill-ore:300')!).getByRole('combobox'));
        expect(container.textContent).toContain('Selected: Drill 2.');
        expect(row(container, 'drill-ore:300')!.getAttribute('data-marked')).toBe('');
        // the answer takes the question away, as before, and the view stays
        again(pastedOf({ drill: true, questions: [] }), { 'drill-ore:300': 'iron-ore' });
        expect(row(container, 'drill-ore:300')).toBeNull();
        expect(view(container)).not.toBeNull();
    });

    it('shows a sharing row until it is answered, as before', () => {
        const { container, again } = draw(pastedOf({ questions: [sharingQuestion(14, 1)] }));
        expect(row(container, 'lane-sharing:14')).not.toBeNull();
        again(pastedOf({ questions: [] }), { 'lane-sharing:14': 'shared' });
        expect(row(container, 'lane-sharing:14')).toBeNull();
    });

    it('shows no layout view for a build that asks no question', () => {
        const { container } = draw(pastedOf({ questions: [] }));
        expect(view(container)).toBeNull();
        expect(container.querySelector('[data-layout-legend]')).toBeNull();
        expect(container.querySelector('[role="group"][aria-label="Questions"]')).toBeNull();
    });
});

describe('the rate of a lane', () => {
    const RATE = /a second leave Belt 1, lane 1\?$/;
    const field = (container: HTMLElement, key: string) => within(row(container, key)!).getByRole('textbox', { name: RATE }) as HTMLInputElement;

    it('asks how many items a second leave the lane, in a number field, and sends the typed value as the answer when it is left', async () => {
        const onAnswer = vi.fn();
        const { container, user } = draw(pastedOf({ questions: [exportQuestion(14, 1, 1)] }), { onAnswer });
        const input = field(container, 'lane-export:14:1');
        expect(row(container, 'lane-export:14:1')!.textContent).toContain('How many');
        await user.type(input, '40');
        await user.tab();
        expect(onAnswer).toHaveBeenLastCalledWith('lane-export:14:1', '40');
    });

    it('selects its belt and marks its lane on focus, and no other lane\'s row', () => {
        const { container } = draw(pastedOf({ questions: [...LANES(), exportQuestion(14, 1, 1), exportQuestion(14, 1, 2)] }));
        fireEvent.focus(field(container, 'lane-export:14:1'));
        expect(container.textContent).toContain('Selected: Belt 1.');
        expect([...container.querySelectorAll('[data-question][data-marked]')].map(it => it.getAttribute('data-question'))).toEqual(['lane-item:14:1', 'lane-export:14:1']);
    });

    it('lists the rate rows after the lane rows and before the sharing rows', () => {
        const { container } = draw(pastedOf({ questions: [sharingQuestion(14, 1), exportQuestion(14, 1, 2), laneQuestion(14, 1, 1), exportQuestion(14, 1, 1)] }));
        expect([...container.querySelectorAll('[data-question]')].map(it => it.getAttribute('data-question')))
            .toEqual(['lane-item:14:1', 'lane-export:14:1', 'lane-export:14:2', 'lane-sharing:14']);
    });

    it('keeps an answered row, marked answered with its value, after the import is asked again and has dropped its question', () => {
        const { container, again } = draw(pastedOf({ questions: [exportQuestion(14, 1, 1)] }));
        again(pastedOf({ questions: [] }), { 'lane-export:14:1': '40' });
        const answered = row(container, 'lane-export:14:1')!;
        expect(answered.getAttribute('data-answered')).toBe('');
        expect(answered.textContent).toContain('Answered');
        expect(field(container, 'lane-export:14:1').value).toContain('40');
    });

    it('is answered in the lane editor under the key of the rate question, not of the lane\'s item', async () => {
        const onAnswer = vi.fn();
        const { container, user } = draw(pastedOf({ questions: [laneQuestion(14, 1, 1), exportQuestion(14, 1, 1)] }), { onAnswer });
        await user.click(within(container).getByRole('button', { name: 'Belt 1' }));
        const editor = container.querySelector<HTMLElement>('[data-lane-editor="1"]')!;
        const input = within(editor).getByRole('textbox', { name: 'Items a second for lane 1' });
        await user.type(input, '25');
        await user.tab();
        expect(onAnswer).toHaveBeenLastCalledWith('lane-export:14:1', '25');
        expect(onAnswer).not.toHaveBeenCalledWith('lane-item:14:1', expect.anything());
    });
});

