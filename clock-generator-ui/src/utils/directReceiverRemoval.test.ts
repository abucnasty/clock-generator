import { expect, it } from 'vitest';
import type { InserterCoverageIssue, OutputTransferSummary } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData } from './configForm/formData';
import { directReceiverRemovalOptions } from './directReceiverRemoval';

const issue: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling', item_name: 'electronic-circuit', fix_options: [] };
const transfer: OutputTransferSummary = { source: { type: 'machine', id: 7 }, mechanism: 'result-placement', status: 'known', physical_target: { type: 'chest', id: 3 },
    results: [{ item_name: 'electronic-circuit', direct: 'rejected', coverage: 'missing', inserters: [] }] };
const chest = { id: 3, _uuid: 'chest-3', type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 200 }], remove_unfiltered_items: false } satisfies ChestFormData;

it('offers the actual direct receiver once for grouped missing results and resolves its current index', () => {
    const other = { ...chest, id: 9, _uuid: 'other' };
    expect(directReceiverRemovalOptions([issue, issue], [transfer], [other, chest])).toEqual([{ chest, index: 1 }]);
    expect(directReceiverRemovalOptions([issue], [transfer], [chest, other])).toEqual([{ chest, index: 0 }]);
});

it('withholds the repair for missing or uncertain evidence and for accepted or unrelated items', () => {
    expect(directReceiverRemovalOptions([issue], null, [chest])).toEqual([]);
    for (const changed of [
        { ...transfer, status: 'unavailable' as const },
        { ...transfer, physical_target: null },
        { ...transfer, mechanism: 'mining-drop' as const },
        { ...transfer, source: { type: 'machine' as const, id: 8 } },
        { ...transfer, results: [{ ...transfer.results[0], direct: 'accepted' as const }] },
        { ...transfer, results: [{ ...transfer.results[0], item_name: 'advanced-circuit' }] },
    ]) expect(directReceiverRemovalOptions([issue], [changed], [chest])).toEqual([]);
});

it('does not offer a removal toggle for input gaps, other target kinds, deleted chests, or already enabled removal', () => {
    expect(directReceiverRemovalOptions([{ ...issue, kind: 'missing_input_inserter' }], [transfer], [chest])).toEqual([]);
    expect(directReceiverRemovalOptions([issue], [{ ...transfer, physical_target: { type: 'machine', id: 3 } }], [chest])).toEqual([]);
    expect(directReceiverRemovalOptions([issue], [transfer], [])).toEqual([]);
    expect(directReceiverRemovalOptions([issue], [transfer], [{ ...chest, remove_unfiltered_items: true }])).toEqual([]);
    expect(directReceiverRemovalOptions([issue], [transfer], [{ id: 3, _uuid: 'buffer', type: ChestType.BUFFER_CHEST, storage_size: 16, item_filter: 'iron-plate' }])).toEqual([]);
});
