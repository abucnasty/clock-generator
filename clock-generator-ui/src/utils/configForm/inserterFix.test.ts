import { describe, expect, it } from 'vitest';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { belt, build, inserter, machine } from '../../test/fixtures';
import { entityLabel } from '../entityLabel';
import { DROP_BELT_READ_ONLY } from '../inserterMetadata';
import * as edits from './edits';
import type { InserterFormData } from './formData';
import { applyInserterFix, inserterFixProblem } from './inserterFix';

const issue = (kind: InserterCoverageIssue['kind'], machine_id = 2): InserterCoverageIssue =>
    ({ kind, machine_id, recipe: 'electronic-circuit', item_name: 'copper-cable', fix_options: [] });
const missingInput = issue('missing_input_inserter');

const fromMachine: InserterFixOption = { type: 'machine_to_machine', source_machine_id: 1, item_name: 'copper-cable' };
const newBelt: InserterFixOption = { type: 'new_belt', item_name: 'copper-cable' };
const newChest: InserterFixOption = { type: 'infinity_chest', item_name: 'copper-cable' };
const addLane = (belt_id: number): InserterFixOption => ({ type: 'add_lane_to_existing_belt', belt_id, item_name: 'copper-cable' });

/** Machine 2 making electronic circuits, two fast belts (the second of iron plates in stacks of 2) and a turbo one, and two inserters of stack size 12 */
const form = () => build({
    machines: [machine(1), machine(2, { recipe: 'electronic-circuit' })],
    belts: [belt(1, { type: 'fast-transport-belt' }), belt(2, { type: 'fast-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 2 }] }), belt(3)],
    inserters: [1, 2].map(id => inserter(id, { sink: { type: 'belt', id: 1 }, stack_size: 12 })),
});

describe('applyInserterFix', () => {
    it('does not duplicate a machine connection while coverage is catching up', () => {
        const once = applyInserterFix(form(), missingInput, fromMachine);
        expect(applyInserterFix(once, missingInput, fromMachine)).toBe(once);
    });

    it.each(['missing_input_inserter', 'missing_output_inserter'] as const)('does not add redundant belts or chests for a stale %s repair', kind => {
        const missing = issue(kind);
        for (const first of [newBelt, newChest]) {
            const once = applyInserterFix(form(), missing, first);
            expect(applyInserterFix(once, missing, newBelt)).toBe(once);
            expect(applyInserterFix(once, missing, newChest)).toBe(once);
        }
    });

    it('still repairs an item excluded by an existing connection’s filters', () => {
        const once = applyInserterFix(form(), missingInput, newBelt);
        const filtered = edits.updateInserter(once, once.inserters.length - 1, { filters: ['iron-plate'] });
        expect(applyInserterFix(filtered, missingInput, newBelt).inserters).toHaveLength(filtered.inserters.length + 1);
    });

    it('ignores repairs whose machine endpoints have been removed', () => {
        const before = form();
        expect(applyInserterFix(before, missingInput, { type: 'machine_to_machine', source_machine_id: 99, item_name: 'copper-cable' })).toBe(before);
        for (const fix of [newBelt, newChest]) expect(applyInserterFix(before, issue('missing_input_inserter', 99), fix)).toBe(before);
    });

    it('ignores a stale repair after the target recipe changes', () => {
        const before = edits.updateMachine(form(), 1, 'recipe', 'advanced-circuit');
        expect(applyInserterFix(before, missingInput, newBelt)).toBe(before);
    });

    it.each<[string, InserterCoverageIssue['kind'], InserterFixOption, Pick<InserterFormData, 'source' | 'sink'>]>([
        ['between two machines', 'missing_input_inserter', fromMachine, { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 } }],
        ['from a new belt', 'missing_input_inserter', newBelt, { source: { type: 'belt', id: 4 }, sink: { type: 'machine', id: 2 } }],
        ['onto a new belt', 'missing_output_inserter', newBelt, { source: { type: 'machine', id: 2 }, sink: { type: 'belt', id: 4 } }],
        ['from a new infinity chest', 'missing_input_inserter', newChest, { source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 2 } }],
        ['into a new infinity chest', 'missing_output_inserter', newChest, { source: { type: 'machine', id: 2 }, sink: { type: 'chest', id: 1 } }],
    ])('adds an inserter %s for a %s, of the most common stack size', (_where, kind, fix, route) => {
        expect(applyInserterFix(form(), issue(kind), fix).inserters[2]).toEqual({ id: 3, _uuid: expect.any(String), ...route, stack_size: 12 });
    });

    it('adds a belt of the most common type with a lane of the item, and an infinity chest asking for 100 of it', () => {
        expect(applyInserterFix(form(), missingInput, newBelt).belts[3]).toEqual({
            id: 4, _uuid: expect.any(String), type: 'fast-transport-belt', lanes: [{ ingredient: 'copper-cable', stack_size: 4 }],
        });
        expect(applyInserterFix(form(), missingInput, newChest).chests).toEqual([
            { type: ChestType.INFINITY_CHEST, id: 1, _uuid: expect.any(String), item_filter: [{ item_name: 'copper-cable', request_count: 100 }] },
        ]);
    });

    it('adds a second lane to a belt, with the stack size of its first', () => {
        const config = applyInserterFix(form(), missingInput, addLane(2));
        expect(config.belts[1].lanes).toEqual([{ ingredient: 'iron-plate', stack_size: 2 }, { ingredient: 'copper-cable', stack_size: 2 }]);
        expect(config.inserters).toEqual(form().inserters);
    });

    it('leaves the form as it is when the belt is gone or has two lanes', () => {
        const before = form();
        expect(applyInserterFix(before, missingInput, addLane(9))).toBe(before);
        const full = edits.updateBelt(before, 0, { lanes: [{ ingredient: 'a', stack_size: 4 }, { ingredient: 'b', stack_size: 4 }] });
        expect(applyInserterFix(full, missingInput, addLane(1))).toBe(full);
        const protectedForm = form();
        protectedForm.inserters[0].sink = { type: 'belt', id: 2, drop: { lane: 1, position: 0.5 } };
        expect(inserterFixProblem(protectedForm, addLane(2))).toBe(`${entityLabel('belt', 2)}: ${DROP_BELT_READ_ONLY}`);
        expect(applyInserterFix(protectedForm, missingInput, addLane(2))).toBe(protectedForm);
        const withBelt = applyInserterFix(protectedForm, missingInput, newBelt);
        const withChest = applyInserterFix(protectedForm, missingInput, newChest);
        expect(withBelt.belts).toHaveLength(protectedForm.belts.length + 1);
        expect(withChest.chests).toHaveLength(1);
        expect(withBelt.inserters[0]).toEqual(protectedForm.inserters[0]);
        expect(withChest.inserters[0]).toEqual(protectedForm.inserters[0]);
    });

    it('adds a turbo belt and an inserter of stack size 4 to a form without belts or inserters', () => {
        const config = applyInserterFix(build({ machines: [machine(1, { recipe: 'electronic-circuit' })] }), issue('missing_input_inserter', 1), newBelt);
        expect(config.belts[0].type).toBe('turbo-transport-belt');
        expect(config.inserters[0]).toMatchObject({ id: 1, source: { type: 'belt', id: 1 }, stack_size: 4 });
    });

    it('numbers what it adds one past the highest id left after a remove', () => {
        let config = edits.removeChest(edits.addChest(form()), 0);
        config = edits.removeBelt(edits.removeInserter(config, 1), 2);
        const withBelt = applyInserterFix(config, missingInput, newBelt);
        expect(withBelt.belts.at(-1)!.id).toBe(3);
        expect(withBelt.inserters.at(-1)!.id).toBe(2);
        expect(applyInserterFix(withBelt, missingInput, fromMachine).inserters.at(-1)!.id).toBe(3);
        const withChest = applyInserterFix(config, missingInput, newChest);
        expect(withChest.chests.at(-1)!.id).toBe(1);
        expect(withChest.inserters.at(-1)!.id).toBe(2);
    });
});
