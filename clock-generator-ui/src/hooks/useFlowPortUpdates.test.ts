// @vitest-environment happy-dom
import { createElement } from 'react';
import { render, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import type { Config } from 'clock-generator/browser';
import lithiumSilo from '../../../clock-generator/resources/config-samples/real/owner/lithium-silo/lithium-silo.json?raw';
import { configToFormData } from '../utils/configForm/configMapping';
import { buildFlowGraph } from '../utils/buildFlowGraph';
import { FlowNodeHandles } from '../components/FlowNodeHandles';
import { changedPortNodes, useFlowPortUpdates } from './useFlowPortUpdates';

const updateNodeInternals = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async importOriginal => ({
    ...await importOriginal<typeof import('@xyflow/react')>(),
    useUpdateNodeInternals: () => updateNodeInternals,
}));
beforeEach(() => { updateNodeInternals.mockClear(); });

const form = configToFormData(JSON.parse(lithiumSilo) as Config);
const graph = (inserters = form.inserters, detailed = false) =>
    buildFlowGraph(form.machines, inserters, form.belts, form.chests, form.drills?.configs ?? [], undefined, detailed).nodes;

// An update per node was a full render of the diagram per node, in one frame: opening this build's diagram blocked the
// page for half a second in the production build.
it('asks React Flow to remeasure handles only for the nodes whose handles moved, in one update', () => {
    const nodes = graph();
    expect(nodes.length).toBe(29);
    // opening: React Flow measures each new node, handles included, when it mounts
    const { rerender } = renderHook(useFlowPortUpdates, { initialProps: nodes });
    expect(updateNodeInternals).not.toHaveBeenCalled();
    // the graph built again with the same connections (the machine rates shown, the build re-read): nothing moved
    rerender(graph(form.inserters, true));
    rerender(graph());
    expect(updateNodeInternals).not.toHaveBeenCalled();
    // a second inserter between the same chest and machine: both ends get one more port
    const first = form.inserters[0];
    const added = { ...first, id: Math.max(...form.inserters.map(it => it.id)) + 1 };
    rerender(graph([...form.inserters, added]));
    expect(updateNodeInternals).toHaveBeenCalledOnce();
    const [ids] = updateNodeInternals.mock.calls[0] as [string[]];
    expect(ids).toEqual(expect.arrayContaining([`${first.source.type}-${first.source.id}`, `${first.sink.type}-${first.sink.id}`]));
    expect(ids).not.toContain(`inserter-${added.id}`);
});

it('lists a node seen before whose ports changed, never a new one', () => {
    const node = (id: string, ports: string[]): Node => ({ id, position: { x: 0, y: 0 }, data: {
        routePorts: ports.map(port => ({ id: port, type: 'source', position: 'right', fraction: 0.5 })) } });
    const { next } = changedPortNodes(new Map(), [node('a', ['x']), node('b', ['y'])]);
    expect(changedPortNodes(next, [node('a', ['x']), node('b', ['y', 'z']), node('c', [])]).changed).toEqual(['b']);
});

it('leaves a node\'s handles to the diagram: drawing one asks React Flow for nothing', () => {
    render(createElement(ReactFlowProvider, null, graph().map(node => createElement(FlowNodeHandles, { key: node.id, data: node.data }))));
    expect(updateNodeInternals).not.toHaveBeenCalled();
});
