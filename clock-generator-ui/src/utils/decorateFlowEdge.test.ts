import { describe, expect, it } from 'vitest';
import { MarkerType } from '@xyflow/react';
import { ChestType } from 'clock-generator/light';
import * as edits from './configForm/edits';
import { createDefaultConfig, type InserterFormData } from './configForm/formData';
import { buildFlowGraph } from './buildFlowGraph';
import type { OutputTransferSummary } from 'clock-generator/browser';
import { tokensFor } from '../theme/tokens';
import { decorateFlowEdge } from './decorateFlowEdge';

const itemLabel = (name: string) => name.replaceAll('-', ' ');
const getEdge = (summary: OutputTransferSummary) => {
    let config = createDefaultConfig();
    config = edits.addChest(config, ChestType.INFINITY_CHEST);
    const machine = { ...config.machines[0], recipe: 'iron-gear-wheel', prototype: 'recycler', result_target: { type: 'chest' as const, id: 1 } };
    const graph = buildFlowGraph([machine], [] as InserterFormData[], config.belts, config.chests, [], undefined, false,
        { itemLabel, recipeLabel: itemLabel }, 0, [summary]);
    const edge = graph.edges.find(candidate => candidate.id.startsWith('output-transfer-'));
    if (!edge) throw new Error('buildFlowGraph did not create an output transfer edge');
    return edge;
};

const summary = (status: OutputTransferSummary['status'], results: OutputTransferSummary['results']): OutputTransferSummary => ({
    source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 1 }, mechanism: 'result-placement', status, results,
});

describe('decorateFlowEdge', () => {
    it('keeps accepted result labels and descriptions when selected or neutral', () => {
        const original = getEdge(summary('known', [
            { item_name: 'iron-gear-wheel', direct: 'accepted', inserters: [], coverage: 'covered' },
            { item_name: 'copper-cable', direct: 'accepted', inserters: [], coverage: 'covered' },
        ]));
        for (const selected of [true, false]) {
            const decorated = decorateFlowEdge(original, tokensFor('dark'), false, selected);
            expect(decorated.selected).toBe(selected);
            expect(decorated.data).toMatchObject({
                outputItems: [
                    { name: 'copper-cable', label: 'copper cable' },
                    { name: 'iron-gear-wheel', label: 'iron gear wheel' },
                ],
                description: expect.stringContaining('Direct:'),
            });
            expect((decorated.markerEnd as { type: MarkerType }).type).toBe(MarkerType.ArrowClosed);
            expect(decorated.style?.strokeDasharray).toBeUndefined();
        }
    });

    it.each([
        ['known zero transfer', summary('known', [{ item_name: 'iron-gear-wheel', direct: 'rejected', inserters: [], coverage: 'missing' }]), 'No direct transfer'],
        ['unknown transfer', summary('unavailable', [{ item_name: 'iron-gear-wheel', direct: 'unknown', inserters: [], coverage: 'unknown' }]), 'Output routes unavailable'],
    ] as const)('preserves the marker-free dashed %s reference after selection', (_name, dto, labelText) => {
        const original = getEdge(dto);
        expect(original.markerEnd).toBeUndefined();
        const decorated = decorateFlowEdge(original, tokensFor('dark'), true, true);
        expect(decorated.selected).toBe(true);
        expect(decorated.markerEnd).toBeUndefined();
        expect(decorated.style?.strokeDasharray).toBe('5 4');
        expect(decorated.data).toMatchObject({ labelText, description: labelText });
    });
});
