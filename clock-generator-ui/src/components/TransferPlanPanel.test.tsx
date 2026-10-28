// @vitest-environment happy-dom
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import cell02 from '../../../clock-generator/resources/config-samples/real/stupidfathobbit/cell02/stupidfathobbit-cell02.json?raw';
import { screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, validateConfig } from 'clock-generator/browser';
import { show } from '../test/fixtures';
import { TransferPlanPanel } from './TransferPlanPanel';

FactorioDataService.initialize(JSON.parse(factorioData));

afterEach(() => { vi.restoreAllMocks(); });

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
