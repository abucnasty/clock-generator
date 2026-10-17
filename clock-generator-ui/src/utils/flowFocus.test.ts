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

it('keeps every supplying branch highlighted when selecting a belt with two output inserters', () => {
    const nodes: Node[] = [
        { id: 'belt-3', data: { entityType: 'belt', entityId: 3 }, position: { x: 0, y: 0 } },
        ...[7, 8].map(inserterId => ({ id: `ins-${inserterId}`, data: { inserterId }, position: { x: 0, y: 0 } })),
        ...[3, 4].map(entityId => ({ id: `machine-${entityId}`, data: { entityType: 'machine', entityId }, position: { x: 0, y: 0 } })),
    ];
    const edges = [['machine-3', 'ins-7'], ['ins-7', 'belt-3'], ['machine-4', 'ins-8'], ['ins-8', 'belt-3']].map(([source, target], i) => ({ id: String(i), source, target }));
    const beltFocus = flowFocus(nodes, edges, 'belt:3');
    expect([...beltFocus.same]).toEqual(['belt-3']);
    expect([...beltFocus.routes]).toEqual(['0', '1', '2', '3']);
    expect([...beltFocus.related].sort()).toEqual(nodes.map(node => node.id).sort());
});
