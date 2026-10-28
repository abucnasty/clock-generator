// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import type { Config } from 'clock-generator/browser';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import lithiumSilo from '../../../clock-generator/resources/config-samples/real/owner/lithium-silo/lithium-silo.json?raw';
import { inserter, names, show } from '../test/fixtures';
import { buildFlowGraph, type EntityNodeData, type InserterNodeData } from '../utils/buildFlowGraph';
import { configToFormData } from '../utils/configForm/configMapping';
import { EntityFlowNode } from './EntityFlowNode';
import { InserterFlowNode } from './InserterFlowNode';

const machineFacts = vi.hoisted(() => ({ value: null as unknown, updating: false }));
vi.mock('../hooks/useMachineFacts', () => ({ useMachineFacts: () => ({ facts: machineFacts.value, error: null, updating: machineFacts.updating }) }));
// React tells of a key given twice in one list on the console
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => { machineFacts.value = null; machineFacts.updating = false; consoleError = vi.spyOn(console, 'error'); });
afterEach(() => { vi.restoreAllMocks(); });

type EntityNode = Node<EntityNodeData, 'entityNode'>;
type InserterNode = Node<InserterNodeData, 'inserterNode'>;
const form = configToFormData(JSON.parse(lithiumSilo) as Config);
const nodeProps = <T extends Node>(node: Node) => ({ id: node.id, data: node.data }) as NodeProps<T>;
// an item's name with its id's words, so a name shown is told apart from an id shown
const label = (id: string) => `${id[0].toUpperCase()}${id.slice(1).replaceAll('-', ' ')}`;
const draw = (node: ReactElement, ...items: string[]) =>
    show(<ReactFlowProvider>{node}</ReactFlowProvider>, { names: names(Object.fromEntries(items.map(item => [item, label(item)]))) });

it.each([
    { what: 'the lithium silo\'s belt, with lithium plates on both lanes,', id: 'belt-1', inserters: form.inserters,
        element: (node: Node) => <EntityFlowNode {...nodeProps<EntityNode>(node)} /> },
    { what: 'an inserter that takes from that belt', id: 'inserter-99',
        inserters: [...form.inserters, inserter(99, { source: { type: 'belt', id: 1 }, sink: { type: 'chest', id: 4 } })],
        element: (node: Node) => <InserterFlowNode {...nodeProps<InserterNode>(node)} /> },
])('draws $what with an icon per lane and no key twice', ({ id, inserters, element }) => {
    const { nodes } = buildFlowGraph(form.machines, inserters, form.belts, form.chests, form.drills?.configs ?? []);
    const node = nodes.find(candidate => candidate.id === id)!;
    expect((node.data as EntityNodeData | InserterNodeData).filterIcons).toEqual(['lithium-plate', 'lithium-plate']);
    draw(element(node), 'lithium-plate');
    expect(screen.getAllByRole('img', { name: 'Lithium plate' })).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalled();
});

const machineNode = { id: 'machine-1', data: {
    entityType: 'machine', entityId: 1, label: 'Machine 1', iconName: 'recycler', sublabel: 'scrap-recycling', detailed: true, nodeWidth: 340,
    machineParams: { recipe: 'scrap-recycling', productivity: 300, crafting_speed: 0.5, prototype: 'recycler' },
} } as Node<EntityNodeData>;
const drawMachine = (...items: string[]) => draw(<EntityFlowNode {...nodeProps<EntityNode>(machineNode)} />, ...items);
const outputCapacities = () => screen.getByRole('group', { name: 'Output capacities per machine' });

it('renders every fresh multi-output fact with its own rate and stochastic expectation marker', () => {
    const outputs = ['advanced-circuit', 'battery', 'concrete', 'copper-cable', 'holmium-ore', 'ice', 'iron-gear-wheel',
        'low-density-structure', 'processing-unit', 'solid-fuel', 'steel-plate', 'stone'].map((item_name, index) => ({
            item_name, rate_per_second: (index + 1) * 0.25, stochastic: index === 1 || index === 11,
        }));
    machineFacts.value = { outputs, inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    drawMachine(...outputs.map(output => output.item_name));
    const rates = ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '2.25', '2.5', '2.75', '3'];
    expect(within(outputCapacities()).getAllByRole('group').map(row => row.textContent)).toEqual(outputs.map((output, index) =>
        `${label(output.item_name)}${rates[index]}/s out${output.stochastic ? 'Expected' : ''}`));
    expect(screen.getAllByText('Expected')).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalled();
});

it('uses legacy scalar facts when old serialized facts have no output vector', () => {
    machineFacts.value = { output_item: 'scrap', output_rate_per_second: 0.75, inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    drawMachine('scrap');
    expect(within(outputCapacities()).getByRole('img', { name: 'Scrap' })).toBeDefined();
    expect(within(outputCapacities()).getByText('0.75/s out')).toBeDefined();
    // the legacy scalar remains a single compact row
    expect(screen.getAllByText(/\/s out$/)).toHaveLength(1);
});

it('withholds stale output facts while current production facts are updating', () => {
    machineFacts.value = { outputs: [{ item_name: 'stale-item', rate_per_second: 99, stochastic: false }], inputs: [], ticks_per_craft: 60, overload_multiplier: 1 };
    machineFacts.updating = true;
    drawMachine('stale-item');
    expect(screen.getByText('Updating production…')).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Output capacities per machine' })).toBeNull();
    expect(screen.queryByText(/Stale item|\/s out/)).toBeNull();
});
