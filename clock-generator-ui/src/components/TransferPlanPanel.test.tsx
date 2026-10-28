// @vitest-environment happy-dom
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import cell02 from '../../../clock-generator/resources/config-samples/real/stupidfathobbit/cell02/stupidfathobbit-cell02.json?raw';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, validateConfig, type SerializableTransferPlan } from 'clock-generator/browser';
import { show } from '../test/fixtures';
import { TransferPlanPanel } from './TransferPlanPanel';

FactorioDataService.initialize(JSON.parse(factorioData));

afterEach(() => { vi.restoreAllMocks(); });

const transferPlan = { computed_lcm: 2, entities: [{ entity_id: 'inserter-one', entity_type: 'inserter', entity_number: 1,
    item_transfers: [{ item_name: 'iron-plate', numerator: 3, denominator: 2 }] }] } as SerializableTransferPlan;
function showPlan(interaction: 'editable' | 'checking' | 'read-only', excludedIngredients: string[] = []) {
    const onExcludeChange = vi.fn();
    const { user } = show(<TransferPlanPanel transferPlan={transferPlan} usedLcm={2} excludedIngredients={excludedIngredients}
        onExcludeChange={onExcludeChange} interaction={interaction} />);
    return { user, action: screen.getByLabelText(/ LCM: iron-plate$/), onExcludeChange };
}

describe('Swing Plan mutation boundary', () => {
    it.each([{ excluded: [], next: ['iron-plate'] }, { excluded: ['iron-plate'], next: [] }])('editable actions add and remove the actual item once (%j)', async ({ excluded, next }) => {
        const { user, action, onExcludeChange } = showPlan('editable', excluded);
        await user.click(action);
        expect(onExcludeChange).toHaveBeenCalledExactlyOnceWith(next);
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('checking keeps the chip a focusable button but guards every exclusion mutation (%j)', async ({ excluded }) => {
        const { user, action, onExcludeChange } = showPlan('checking', excluded);
        expect(action.getAttribute('aria-disabled')).toBe('true');
        expect(action).toBe(screen.getByRole('button', { name: /LCM: iron-plate$/ }));
        await user.click(action);
        expect(document.activeElement).toBe(action);
        for (const key of ['Enter', ' ']) {
            expect(fireEvent.keyDown(action, { key })).toBe(false);
            await user.keyboard(key === ' ' ? '[Space]' : '[Enter]');
        }
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('read-only exposes state without an action or disabled-data subtree (%j)', async ({ excluded }) => {
        const { user, action, onExcludeChange } = showPlan('read-only', excluded);
        expect(screen.queryByRole('button', { name: /LCM: iron-plate$/ })).toBeNull();
        expect(action.hasAttribute('tabindex')).toBe(false);
        expect(action.hasAttribute('aria-disabled')).toBe(false);
        expect(action.textContent).toBe(excluded.length ? 'Excluded' : 'Included');
        await user.click(action);
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
});

it('lists the swing plan of cell 02, whose export inserters fill both lanes of a belt with circuits, with no key twice', () => {
    const plan = validateConfig(ConfigSchema.parse(JSON.parse(cell02))).transfer_plan;
    const exports = plan.entities.filter(entity => ['inserter:16', 'inserter:17'].includes(entity.entity_id));
    expect(exports.map(entity => entity.item_transfers.map(transfer => transfer.item_name))).toEqual([
        ['electronic-circuit', 'electronic-circuit'],
        ['electronic-circuit', 'electronic-circuit'],
    ]);
    // React says in the console when two rows of a list have the same key
    const error = vi.spyOn(console, 'error');
    show(<TransferPlanPanel transferPlan={plan} usedLcm={plan.computed_lcm} excludedIngredients={[]} onExcludeChange={() => {}} />);
    expect(error).not.toHaveBeenCalled();
    // a row for each lane, the entity's type and name on its first
    const rows = screen.getAllByRole('row').map(row => within(row).queryAllByRole('cell').map(cell => cell.textContent));
    const first = rows.findIndex(([entity]) => entity === 'InserterInserter 16');
    expect(rows.slice(first, first + 4)).toEqual([
        ['InserterInserter 16', 'electronic-circuit', '2', 'Included'], ['', 'electronic-circuit', '2', 'Included'],
        ['InserterInserter 17', 'electronic-circuit', '2', 'Included'], ['', 'electronic-circuit', '2', 'Included'],
    ]);
});
