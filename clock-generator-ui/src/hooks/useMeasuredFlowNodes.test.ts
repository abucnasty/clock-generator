import { expect, it } from 'vitest';
import { adoptUserNodes } from '@xyflow/system';
import type { InternalNode, Node } from '@xyflow/react';
import { retainFlowMeasurements } from './useMeasuredFlowNodes';

it('keeps React Flow measurements through controlled hover and replay frame replacements', () => {
    const base: Node = { id: 'machine-1', position: { x: 100, y: 200 }, data: { craft: 0 } };
    const dimensions = { 'machine-1': { width: 200, height: 168 } };
    const lookup = new Map<string, InternalNode>();
    const parents = new Map<string, Map<string, InternalNode>>();
    const frames = [base, { ...base, style: { opacity: 0.65 } }, { ...base, data: { craft: 85 }, selected: true }];
    for (const frame of frames) {
        const [node] = retainFlowMeasurements([frame], dimensions);
        adoptUserNodes([node], lookup, parents);
        expect(lookup.get(base.id)?.measured).toEqual(dimensions['machine-1']);
        expect(node.position).toEqual(base.position);
        expect(node.data).toEqual(frame.data);
        expect(node.selected).toBe(frame.selected);
    }
    expect(base.measured).toBeUndefined();
});
