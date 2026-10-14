import { describe, expect, it } from 'vitest';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import * as edits from './edits';
import { createDefaultConfig, type ConfigFormData } from './formData';
import { applyInserterFix } from './inserterFix';

const issue = (kind: InserterCoverageIssue['kind'], machine_id = 2): InserterCoverageIssue =>
    ({ kind, machine_id, recipe: 'electronic-circuit', item_name: 'copper-cable', fix_options: [] });

/** Two machines, a fast belt and a turbo belt, and two inserters of stack size 12 */
function form(): ConfigFormData {
    let config = edits.addMachine(createDefaultConfig());
    config = edits.addBelt(edits.addBelt(edits.addBelt(config)));
    config = edits.updateBelt(config, 0, { type: 'fast-transport-belt' });
    config = edits.updateBelt(config, 1, { type: 'fast-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 2 }] });
    config = edits.addInserter(edits.addInserter(config));
    config = edits.updateInserter(config, 0, { stack_size: 12 });
    return edits.updateInserter(config, 1, { stack_size: 12 });
}

describe('applyInserterFix', () => {
    it('adds an inserter between two machines', () => {
        const fix: InserterFixOption = { type: 'machine_to_machine', source_machine_id: 1, item_name: 'copper-cable' };
        const config = applyInserterFix(form(), issue('missing_input_inserter'), fix);
        expect(config.inserters[2]).toEqual({
            id: 3, _uuid: expect.any(String), source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 12,
        });
    });

    it('adds a second lane to a belt, with the stack size of its first', () => {
        const fix: InserterFixOption = { type: 'add_lane_to_existing_belt', belt_id: 2, item_name: 'copper-cable' };
        const config = applyInserterFix(form(), issue('missing_input_inserter'), fix);
        expect(config.belts[1].lanes).toEqual([{ ingredient: 'iron-plate', stack_size: 2 }, { ingredient: 'copper-cable', stack_size: 2 }]);
        expect(config.inserters).toEqual(form().inserters.map(() => expect.anything()));
    });

    it('leaves the form as it is when the belt is gone or has two lanes', () => {
        const before = form();
        expect(applyInserterFix(before, issue('missing_input_inserter'), { type: 'add_lane_to_existing_belt', belt_id: 9, item_name: 'x' })).toBe(before);
        const full = edits.updateBelt(before, 0, { lanes: [{ ingredient: 'a', stack_size: 4 }, { ingredient: 'b', stack_size: 4 }] });
        expect(applyInserterFix(full, issue('missing_input_inserter'), { type: 'add_lane_to_existing_belt', belt_id: 1, item_name: 'x' })).toBe(full);
    });

    it('adds a belt of the most common type and an inserter from it for a missing input', () => {
        const config = applyInserterFix(form(), issue('missing_input_inserter'), { type: 'new_belt', item_name: 'copper-cable' });
        expect(config.belts[3]).toEqual({
            id: 4, _uuid: expect.any(String), type: 'fast-transport-belt', lanes: [{ ingredient: 'copper-cable', stack_size: 4 }],
        });
        expect(config.inserters[2]).toMatchObject({ id: 3, source: { type: 'belt', id: 4 }, sink: { type: 'machine', id: 2 }, stack_size: 12 });
    });

    it('adds a belt and an inserter onto it for a missing output', () => {
        const config = applyInserterFix(form(), issue('missing_output_inserter'), { type: 'new_belt', item_name: 'copper-cable' });
        expect(config.inserters[2]).toMatchObject({ source: { type: 'machine', id: 2 }, sink: { type: 'belt', id: 4 } });
    });

    it('adds a turbo belt and an inserter of stack size 4 to a form without belts or inserters', () => {
        const config = applyInserterFix(createDefaultConfig(), issue('missing_input_inserter', 1), { type: 'new_belt', item_name: 'iron-plate' });
        expect(config.belts[0].type).toBe('turbo-transport-belt');
        expect(config.inserters[0]).toMatchObject({ id: 1, source: { type: 'belt', id: 1 }, stack_size: 4 });
    });

    it('adds an infinity chest of the item and an inserter between it and the machine', () => {
        const input = applyInserterFix(form(), issue('missing_input_inserter'), { type: 'infinity_chest', item_name: 'copper-cable' });
        expect(input.chests).toEqual([
            { type: ChestType.INFINITY_CHEST, id: 1, _uuid: expect.any(String), item_filter: [{ item_name: 'copper-cable', request_count: 100 }] },
        ]);
        expect(input.inserters[2]).toMatchObject({ source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 2 } });

        const output = applyInserterFix(form(), issue('missing_output_inserter'), { type: 'infinity_chest', item_name: 'copper-cable' });
        expect(output.inserters[2]).toMatchObject({ source: { type: 'machine', id: 2 }, sink: { type: 'chest', id: 1 } });
    });

    it('numbers what it adds one past the highest id left after a remove', () => {
        let config = edits.removeChest(edits.addChest(form()), 0);
        config = edits.removeBelt(edits.removeInserter(config, 1), 2);
        const belt = applyInserterFix(config, issue('missing_input_inserter'), { type: 'new_belt', item_name: 'copper-cable' });
        expect(belt.belts.at(-1)!.id).toBe(3);
        expect(belt.inserters.at(-1)!.id).toBe(2);
        expect(applyInserterFix(belt, issue('missing_input_inserter'), { type: 'machine_to_machine', source_machine_id: 1, item_name: 'x' }).inserters.at(-1)!.id).toBe(3);
        const chest = applyInserterFix(config, issue('missing_input_inserter'), { type: 'infinity_chest', item_name: 'copper-cable' });
        expect(chest.chests.at(-1)!.id).toBe(1);
        expect(chest.inserters.at(-1)!.id).toBe(2);
    });
});
