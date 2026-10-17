import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { flowFocus } from './flowFocus';

const nodes = [
    { id: 'belt-in', data: { entityType: 'belt', entityId: 1 } },
    { id: 'belt-out', data: { entityType: 'belt', entityId: 1 } },
    { id: 'ins1', data: { inserterId: 1 } }, { id: 'ins2', data: { inserterId: 2 } },
    { id: 'machine', data: { entityType: 'machine', entityId: 1 } },
    { id: 'other', data: { entityType: 'machine', entityId: 2 } },
].map(node => ({ ...node, position: { x: 0, y: 0 } })) as Node[];
const edges = [ ['belt-in', 'ins1'], ['ins1', 'machine'], ['machine', 'ins2'], ['ins2', 'belt-out'], ['other', 'machine'] ].map(([source, target], id) => ({ id: String(id), source, target }));
describe('flow focus', () => {
    it('highlights both halves and the complete routes through their inserters', () => {
        const focus = flowFocus(nodes, edges, 'belt:1');
        expect([...focus.same]).toEqual(['belt-in', 'belt-out']);
        expect([...focus.routes]).toEqual(['0', '1', '2', '3']);
        expect(focus.related.has('other')).toBe(false);
    });
    it('highlights both ends when inspecting an inserter without spreading to the other inserter', () => {
        expect([...flowFocus(nodes, edges, 'inserter:1').routes]).toEqual(['0', '1']);
    });
});
