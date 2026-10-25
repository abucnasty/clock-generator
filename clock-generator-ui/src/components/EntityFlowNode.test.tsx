import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import type { Config } from 'clock-generator/browser';
import lithiumSilo from '../../../clock-generator/resources/config-samples/real/owner/lithium-silo/lithium-silo.json?raw';
import { configToFormData } from '../utils/configForm/configMapping';
import { buildFlowGraph, type EntityNodeData, type InserterNodeData } from '../utils/buildFlowGraph';
import { EntityFlowNode } from './EntityFlowNode';
import { InserterFlowNode } from './InserterFlowNode';

// React reports two children with the same key only when it renders in a browser, not in the server render these tests
// use, so each Box of the nodes checks the keys of its children as React does: within each list, every key once.
const keys = vi.hoisted(() => ({ repeated: [] as string[] }));
const machineFacts = vi.hoisted(() => ({ value: null as unknown, updating: false }));
vi.mock('../hooks/useMachineFacts', () => ({ useMachineFacts: () => ({ facts: machineFacts.value, error: null, updating: machineFacts.updating }) }));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ names: {}, itemLabel: (id: string) => id.replaceAll('-', ' '),
    recipeLabel: (id: string) => id, iconLabel: (id: string) => id, nameIdsIn: (text: string) => text }) }));
vi.mock('@mui/material', async importOriginal => {
    const actual = await importOriginal<typeof import('@mui/material')>();
    const { createElement, isValidElement } = await import('react');
    const check = (children: ReactNode) => {
        if (!Array.isArray(children)) return;
        const listed = children.filter(isValidElement).map(child => child.key).filter(key => key !== null);
        keys.repeated.push(...listed.filter((key, index) => listed.indexOf(key) !== index));
        children.forEach(check);
    };
    return { ...actual, Box: (props: { children?: ReactNode }) => { check(props.children); return createElement(actual.Box, props); } };
});
beforeEach(() => { keys.repeated = []; machineFacts.value = null; machineFacts.updating = false; });

const form = configToFormData(JSON.parse(lithiumSilo) as Config);
const nodeOf = <T extends Node>(nodes: Node[], id: string) => nodes.find(node => node.id === id) as T;
const render = (node: ReactNode) => renderToStaticMarkup(<ReactFlowProvider>{node}</ReactFlowProvider>);
const icons = (html: string, item: string) => html.split(`src="/icons/${item}.png"`).length - 1;

it('draws the lithium silo\'s belt, with lithium plates on both lanes, with an icon per lane and no key twice', () => {
    const { nodes } = buildFlowGraph(form.machines, form.inserters, form.belts, form.chests, form.drills?.configs ?? []);
    const belt = nodeOf<Node<EntityNodeData>>(nodes, 'belt-1');
    expect(belt.data.filterIcons).toEqual(['lithium-plate', 'lithium-plate']);
    const html = render(<EntityFlowNode {...{ id: belt.id, data: belt.data } as NodeProps<Node<EntityNodeData, 'entityNode'>>} />);
    expect(icons(html, 'lithium-plate')).toBe(2);
    expect(keys.repeated).toEqual([]);
});

it('draws an inserter that takes from that belt with no key twice', () => {
    const takes = { ...form.inserters[0], id: 99, _uuid: 'inserter-99', source: { type: 'belt' as const, id: 1 }, sink: { type: 'chest' as const, id: 4 } };
    const { nodes } = buildFlowGraph(form.machines, [...form.inserters, takes], form.belts, form.chests, form.drills?.configs ?? []);
    const inserter = nodeOf<Node<InserterNodeData>>(nodes, 'inserter-99');
    expect(inserter.data.filterIcons).toEqual(['lithium-plate', 'lithium-plate']);
    render(<InserterFlowNode {...{ id: inserter.id, data: inserter.data } as NodeProps<Node<InserterNodeData, 'inserterNode'>>} />);
    expect(keys.repeated).toEqual([]);
});

const machineNode = { id: 'machine-1', data: {
    entityType: 'machine', entityId: 1, label: 'Machine 1', iconName: 'recycler', sublabel: 'scrap-recycling', detailed: true, nodeWidth: 340,
    machineParams: { recipe: 'scrap-recycling', productivity: 300, crafting_speed: 0.5, prototype: 'recycler' },
} } as Node<EntityNodeData>;
const renderMachine = () => render(<EntityFlowNode {...{ id: machineNode.id, data: machineNode.data } as NodeProps<Node<EntityNodeData, 'entityNode'>>} />);

it('renders every fresh multi-output fact with its own rate and stochastic expectation marker', () => {
    const outputs = ['advanced-circuit', 'battery', 'concrete', 'copper-cable', 'holmium-ore', 'ice', 'iron-gear-wheel',
        'low-density-structure', 'processing-unit', 'solid-fuel', 'steel-plate', 'stone'].map((item_name, index) => ({
            item_name, rate_per_second: (index + 1) * 0.25, stochastic: index === 1 || index === 11,
        }));
    machineFacts.value = { outputs, inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    const html = renderMachine();
    expect(html).toContain('Output capacities per machine');
    for (const [index, output] of outputs.entries()) {
        expect(html).toContain(output.item_name.replaceAll('-', ' '));
        const rateText = ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '2.25', '2.5', '2.75', '3'][index];
        expect(html).toContain(`${rateText}/s out`);
    }
    expect(html.match(/Expected/g)).toHaveLength(2);
});

it('uses legacy scalar facts when old serialized facts have no output vector', () => {
    machineFacts.value = { output_item: 'scrap', output_rate_per_second: 0.75, inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    const html = renderMachine();
    expect(html).toContain('0.75/s out');
    expect(html).toContain('aria-label="Output capacities per machine"');
    expect(html.match(/\/s out/g)).toHaveLength(1); // the legacy scalar remains a single compact row
});

it('withholds stale output facts while current production facts are updating', () => {
    machineFacts.value = { outputs: [{ item_name: 'stale-item', rate_per_second: 99, stochastic: false }], inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    machineFacts.updating = true;
    const html = renderMachine();
    expect(html).toContain('Updating production');
    expect(html).not.toContain('stale item');
    expect(html).not.toContain('99/s out');
});
