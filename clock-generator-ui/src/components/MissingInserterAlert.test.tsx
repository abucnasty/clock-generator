// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { InserterCoverageIssue, OutputTransferSummary } from 'clock-generator/browser';
import type { ChestFormData } from '../hooks/useConfigForm';
import { MissingInserterAlert } from './MissingInserterAlert';

it('offers receiver removal in Other options and invokes the existing chest update without adding an inserter', async () => {
    const issue: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling', item_name: 'electronic-circuit',
        fix_options: [{ type: 'review_filters', inserter_id: 4, item_name: 'electronic-circuit' }] };
    const transfer: OutputTransferSummary = { source: { type: 'machine', id: 7 }, mechanism: 'result-placement', status: 'known', physical_target: { type: 'chest', id: 3 },
        results: [{ item_name: issue.item_name, direct: 'rejected', coverage: 'missing', inserters: [] }] };
    const onEnableRemoval = vi.fn(), onApplyFix = vi.fn();
    const chests = [
        { id: 9, _uuid: 'unrelated', type: 'infinity-chest', item_filter: [] },
        { id: 3, _uuid: 'receiver', type: 'infinity-chest', item_filter: [], remove_unfiltered_items: false },
    ] as ChestFormData[];
    render(<MissingInserterAlert issues={[issue]} outputTransfers={[transfer]} chests={chests} onEnableRemoval={onEnableRemoval} onApplyFix={onApplyFix} />);
    const user = userEvent.setup();
    const other = screen.getByRole('button', { name: 'Other options…' });
    await user.click(other);
    await user.click(screen.getByRole('menuitem', { name: /Chest 3/ }));
    expect(onEnableRemoval).toHaveBeenCalledExactlyOnceWith(1);
    expect(onApplyFix).not.toHaveBeenCalled();
    // the menu is closed: its button no longer controls one
    expect(other.hasAttribute('aria-controls')).toBe(false);
});
