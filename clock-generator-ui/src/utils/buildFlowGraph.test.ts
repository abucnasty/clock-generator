import { describe, expect, it } from 'vitest';
import { MarkerType, Position, type Node } from '@xyflow/react';
import type { OutputTransferResult as Result, OutputTransferSummary as Summary } from 'clock-generator/browser';
import { belt as beltRow, build, drill as drillRow, infinityChest, machine as machineRow } from '../test/fixtures';
import type { ConfigFormData, DrillFormData, EnableControlOverride, InserterFormData, MachineFormData } from './configForm/formData';
import { buildFlowGraph, flowNodeEntity, type InserterNodeData } from './buildFlowGraph';
import { flowNodeRect, routeFlowEdges, type FlowPort } from './flowRouting';
import { describeEnableRule } from './enableRuleLabel';

type End = InserterFormData['source'];

const belt = (id: number) => ({ type: 'belt' as const, id });
const chest = (id: number) => ({ type: 'chest' as const, id });
const machine = (id: number) => ({ type: 'machine' as const, id });

const inserter = (id: number, source: End, sink: End, overrides?: InserterFormData['overrides']): InserterFormData =>
    ({ id, _uuid: `inserter-${id}`, source, sink, stack_size: 16, ...(overrides && { overrides }) });

const ids = (count = 0) => Array.from({ length: count }, (_, i) => i + 1);

/**
 * A build with this many machines and drills (into these targets) as the form adds them, with no recipe or resource chosen yet,
 * belts (two lanes), infinity chests (that keep what they are given) and these inserters
 */
function form(counts: { machines: number; belts?: number; chests?: number; drills?: DrillFormData['target'][] }, inserters: InserterFormData[]): ConfigFormData {
    return build({
        machines: ids(counts.machines).map(id => machineRow(id, { recipe: '' })),
        belts: ids(counts.belts).map(id => beltRow(id, { lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'copper-plate', stack_size: 4 }] })),
        chests: ids(counts.chests).map(id => infinityChest(id, { remove_unfiltered_items: false })),
        drills: { configs: (counts.drills ?? []).map((target, i) => drillRow(i + 1, { mined_item_name: '', target })) },
        inserters,
    });
}

// a recycler whose car is emptied back into it by an inserter: the car both feeds the machine and takes its results
const recycler = (result_target: MachineFormData['result_target'], inserters = [inserter(1, chest(1), machine(1))]) =>
    ({ ...form({ machines: 1, chests: 2 }, inserters), machines: [machineRow(1, { prototype: 'recycler', result_target })] });

interface Drawing { detail?: boolean; labels?: Parameters<typeof buildFlowGraph>[7]; nodeHeight?: number; transfers?: Summary[] }

/** The graph of a build, in detail unless told otherwise */
function graph(config: ConfigFormData, { detail = true, labels, nodeHeight, transfers }: Drawing = {}) {
    return buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, config.drills?.configs ?? [], undefined, detail, labels, nodeHeight, transfers);
}

const x = (nodes: Node[], id: string) => {
    const node = nodes.find(it => it.id === id);
    if (!node) throw new Error(`no node ${id} in ${nodes.map(it => it.id).join(', ')}`);
    return node.position.x;
};

const pairs = <T>(items: T[]) => items.flatMap((a, i) => items.slice(i + 1).map(b => [a, b] as const));

const result = (item_name: string, direct: Result['direct'], coverage: Result['coverage'], inserters: Result['inserters'] = []): Result =>
    ({ item_name, direct, inserters, coverage });
/** What the engine says of the recycler's results, placed into chest 2 */
const placed = (status: Summary['status'], results: Result[]): Summary =>
    ({ source: machine(1), physical_target: chest(2), mechanism: 'result-placement', status, results });
/** What the engine says of drill 1's iron ore, dropped into chest 1 */
const dropped = (status: Summary['status'], direct: Result['direct'], coverage: Result['coverage']): Summary =>
    ({ source: { type: 'drill', id: 1 }, physical_target: chest(1), mechanism: 'mining-drop', status, results: [result('iron-ore', direct, coverage)] });
/** Drill 1 mining iron ore into chest 1 */
const drillIntoChest = () => ({ ...form({ machines: 1, chests: 1 }, []), drills: { configs: [drillRow(1, { target: chest(1) })] } });

const FIXTURES: Record<string, () => ConfigFormData> = {
    // as logistic-science.json
    'belt in and out': () => form({ machines: 1, belts: 1 }, [
        inserter(1, belt(1), machine(1)), inserter(2, belt(1), machine(1)), inserter(3, machine(1), belt(1)),
    ]),
    'chest in and out': () => form({ machines: 1, chests: 1 }, [inserter(1, chest(1), machine(1)), inserter(2, machine(1), chest(1))]),
    'a chain machine to belt to machine': () => form({ machines: 2, belts: 2 }, [
        inserter(1, belt(1), machine(1)), inserter(2, machine(1), belt(2)), inserter(3, belt(2), machine(2)),
    ]),
    'two input belts and a chest output': () => form({ machines: 1, belts: 2, chests: 1 }, [
        inserter(1, belt(1), machine(1)), inserter(2, belt(2), machine(1)), inserter(3, machine(1), chest(1)),
    ]),
    'a drill feeding a machine with a belt output': () => form({ machines: 1, belts: 1, drills: [machine(1)] }, [inserter(1, machine(1), belt(1))]),
    'a recycler placing its results into a chest': () => recycler(chest(2)),
    'an unused belt': () => form({ machines: 1, belts: 2 }, [inserter(1, belt(1), machine(1))]),
    // two biochambers that feed each other, fed by a belt and giving to a chest, as iron-bacteria-cultivation.json
    'a machine loop': () => form({ machines: 2, belts: 1, chests: 1 }, [
        inserter(1, machine(1), machine(2)), inserter(2, machine(2), machine(1)), inserter(3, belt(1), machine(1)),
        inserter(4, belt(1), machine(2)), inserter(5, machine(1), chest(1)), inserter(6, machine(2), chest(1)),
    ]),
    'loop beside an unrelated belt': () => form({ machines: 3, belts: 2, chests: 1 }, [
        inserter(1, machine(1), machine(2)), inserter(2, machine(2), machine(1)), inserter(3, belt(1), machine(1)), inserter(4, belt(1), machine(2)),
        inserter(5, belt(2), machine(3)), inserter(6, machine(1), machine(3)), inserter(7, machine(2), machine(3)), inserter(8, machine(3), chest(1)),
    ]),
    'many reciprocal inserters': () => form({ machines: 2 }, Array.from({ length: 8 }, (_, i) => inserter(i + 1, machine(i % 2 + 1), machine((i + 1) % 2 + 1)))),
    'three machine cycle': () => form({ machines: 3, belts: 1 }, [
        inserter(1, machine(1), machine(2)), inserter(2, machine(2), machine(3)), inserter(3, machine(3), machine(1)), inserter(4, belt(1), machine(2)),
    ]),
    'self loop': () => form({ machines: 1 }, [inserter(1, machine(1), machine(1))]),
};

/** The graph of every fixture, with its name */
const graphs = (drawing?: Drawing) => Object.entries(FIXTURES).map(([name, fixture]) => ({ name, ...graph(fixture(), drawing) }));

describe('buildFlowGraph', () => {
    it('says the game names in the nodes\' aria-labels while the data keeps the ids', () => {
        const label = (id: string) => `<${id}>`;
        const config = { ...form({ machines: 1, belts: 1 }, []), machines: [machineRow(1, { recipe: 'iron-gear-wheel' })] };
        const { nodes } = graph(config, { detail: false, labels: { itemLabel: label, recipeLabel: label } });
        const aria = nodes.map(n => n.ariaLabel ?? '');
        expect(aria.some(a => a.includes('makes <iron-gear-wheel>'))).toBe(true);
        expect(aria.some(a => a.includes('carries <iron-plate> and <copper-plate>'))).toBe(true);
        expect(JSON.stringify(nodes.map(n => n.data))).toContain('iron-gear-wheel');
    });

    it('gives every edge an arrowhead, loop and drill edges included', () => {
        for (const { name, edges } of graphs()) {
            expect(edges.length, name).toBeGreaterThan(0);
            for (const edge of edges) {
                if (/^output-transfer-(unknown|none|drill-unknown)-/.test(edge.id)) {
                    expect(edge.markerEnd, `${name}: ${edge.id}`).toBeUndefined();
                    expect(edge.style?.strokeDasharray, `${name}: ${edge.id}`).toBe('5 4');
                } else {
                    expect((edge.markerEnd as { type: MarkerType }).type, `${name}: ${edge.id}`).toBe(MarkerType.ArrowClosed);
                }
            }
        }
    });

    it('draws a drill into a chest as an edge to the chest', () => {
        const { edges } = graph(form({ machines: 1, belts: 1, chests: 1, drills: [chest(1)] }, [inserter(1, chest(1), machine(1)), inserter(2, machine(1), belt(1))]));
        expect(edges.some(edge => edge.source === 'drill-1' && edge.target === 'chest-1')).toBe(true);
        expect(edges.some(edge => edge.source === 'drill-1' && edge.target.startsWith('machine'))).toBe(false);
    });

    it('shows a drill\'s known accepted result as an active drop', () => {
        const { edges } = graph(drillIntoChest(), { detail: false, transfers: [dropped('known', 'accepted', 'covered')] });
        const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-drill-1-'))!;
        expect((edge.markerEnd as { type: MarkerType }).type).toBe(MarkerType.ArrowClosed);
        expect(edge.data?.outputItems).toEqual([{ name: 'iron-ore', label: 'iron-ore' }]);
    });

    it.each([
        ['a machine\'s selected target that accepts none of its results', recycler(chest(2)),
            placed('known', [result('advanced-circuit', 'rejected', 'missing')]), 'output-transfer-none-1-', 'No direct transfer'],
        // an unavailable result-less source, kept distinct from a known zero-transfer target
        ['a machine\'s unavailable results', recycler(chest(2)), placed('unavailable', []), 'output-transfer-none-1-', 'Output routes unavailable'],
        ['a drill\'s known rejected result', drillIntoChest(), dropped('known', 'rejected', 'missing'), 'output-transfer-drill-none-1-', 'No direct transfer'],
        ['a drill\'s unavailable result, visibly unknown', drillIntoChest(), dropped('unavailable', 'unknown', 'unknown'),
            'output-transfer-drill-unknown-1-', 'Output routes unavailable'],
    ])('shows %s as a dashed reference with no direct arrow', (_, config, summary, id, labelText) => {
        const edge = graph(config, { detail: false, transfers: [summary] }).edges.find(candidate => candidate.id.startsWith(id))!;
        expect(edge.markerEnd).toBeUndefined();
        expect(edge.style?.strokeDasharray).toBe('5 4');
        expect(edge.data?.labelText).toBe(labelText);
    });

    describe('a machine that places its results itself', () => {
        it('draws its results into its result target as an edge to the container, as a drill\'s drop is', () => {
            // the engine has said nothing of them yet; the fixture of a recycler checks the arrowheads of this graph
            const { edges } = graph(recycler(chest(2)));
            expect(edges.find(edge => edge.source === 'machine-1' && edge.target === 'chest-2')?.id).toMatch(/^output-transfer-unknown-/);
        });

        it('draws no edge for a machine without a result target, or whose container is deleted', () => {
            expect(graph(recycler(undefined)).edges.some(edge => edge.source === 'machine-1' && edge.target.startsWith('chest'))).toBe(false);
            expect(graph(recycler(chest(0))).edges.some(edge => edge.source === 'machine-1' && edge.target.startsWith('chest'))).toBe(false);
        });

        it('draws the container twice, in and out, when inserters take the results back into the machine', () => {
            const { nodes, edges } = graph(recycler(chest(1)));
            expect(nodes.map(node => node.id)).toEqual(expect.arrayContaining(['chest-1-in', 'chest-1-out']));
            expect(edges.some(edge => edge.source === 'machine-1' && edge.target === 'chest-1-out')).toBe(true);
            expect(edges.some(edge => edge.source === 'chest-1-in' && edge.target === 'inserter-1')).toBe(true);
            expect(x(nodes, 'chest-1-in')).toBeLessThan(x(nodes, 'inserter-1'));
            expect(x(nodes, 'inserter-1')).toBeLessThan(x(nodes, 'machine-1'));
            expect(x(nodes, 'machine-1')).toBeLessThan(x(nodes, 'chest-1-out'));
        });

        it('draws the container once when nothing takes the results back', () => {
            const { nodes } = graph(recycler(chest(2)));
            expect(nodes.some(node => node.id === 'chest-2')).toBe(true);
            expect(nodes.some(node => node.id.startsWith('chest-2-'))).toBe(false);
        });

        it('groups accepted product labels on one physical target edge and reads inserter items from shared output facts', () => {
            const { nodes, edges } = graph(recycler(chest(2), [inserter(9, machine(1), belt(1))]), {
                detail: false, labels: { itemLabel: name => name === 'electronic-circuit' ? 'Electronic circuit' : 'Advanced circuit', recipeLabel: name => name },
                transfers: [placed('known', [
                    result('electronic-circuit', 'accepted', 'covered'), result('advanced-circuit', 'accepted', 'covered', [{ inserter_id: 9, target: belt(1) }]),
                ])],
            });
            expect(edges.filter(edge => edge.id.startsWith('output-transfer-machine-1-')).map(edge => edge.data?.outputItems)).toEqual([[
                { name: 'advanced-circuit', label: 'Advanced circuit' }, { name: 'electronic-circuit', label: 'Electronic circuit' },
            ]]);
            expect(nodes.find(node => node.id === 'inserter-9')?.data.filterIcons).toEqual(['advanced-circuit']);
            expect(nodes.filter(node => node.id === 'machine-1')).toHaveLength(1);
        });

        it('says in the node\'s name where the results go', () => {
            const { nodes } = graph(recycler(chest(1)), { detail: false });
            expect(nodes.find(node => node.id === 'machine-1')?.ariaLabel).toContain('puts its results into Chest 1');
        });
    });

    it('places the sources, then the machine, then the outputs', () => {
        const { nodes } = graph(FIXTURES['belt in and out']());
        expect(x(nodes, 'belt-1-in')).toBeLessThan(x(nodes, 'inserter-1'));
        expect(x(nodes, 'belt-1-in')).toBeLessThan(x(nodes, 'inserter-2'));
        expect(Math.max(x(nodes, 'inserter-1'), x(nodes, 'inserter-2'))).toBeLessThan(x(nodes, 'machine-1'));
        expect(x(nodes, 'machine-1')).toBeLessThan(x(nodes, 'inserter-3'));
        expect(x(nodes, 'inserter-3')).toBeLessThan(x(nodes, 'belt-1-out'));
    });

    it('points every edge to the right, except those that connect a machine loop from above or below', () => {
        for (const { name, nodes, edges } of graphs()) {
            const rightward = edges.filter(edge => (nodes.find(node => node.id === edge.source)!.data.routePorts as FlowPort[])
                .find(port => port.id === edge.sourceHandle)?.position === Position.Right);
            for (const edge of rightward) expect(x(nodes, edge.source), `${name}: ${edge.id}`).toBeLessThan(x(nodes, edge.target));
        }
    });

    it('draws a belt or chest that feeds a machine and takes its output as two halves, and any other as one node', () => {
        const nodeIds = (fixture: string) => graph(FIXTURES[fixture]()).nodes.map(it => it.id);
        const halves = graph(FIXTURES['belt in and out']()).nodes.filter(it => it.id.startsWith('belt-1'));
        expect(halves.map(it => ({ id: it.id, entity: flowNodeEntity(it), label: it.data.label }))).toEqual([
            { id: 'belt-1-in', entity: { type: 'belt', id: 1 }, label: 'Belt 1 (in)' },
            { id: 'belt-1-out', entity: { type: 'belt', id: 1 }, label: 'Belt 1 (out)' },
        ]);
        expect(nodeIds('a chain machine to belt to machine')).toContain('belt-2');
        expect(nodeIds('two input belts and a chest output')).toEqual(expect.arrayContaining(['belt-1', 'belt-2', 'chest-1']));
        expect(nodeIds('chest in and out')).toEqual(expect.arrayContaining(['chest-1-in', 'chest-1-out']));
    });

    it('keeps its edges between nodes it has, with unique ids and none into the in half or out of the out half', () => {
        for (const { name, nodes, edges } of graphs()) {
            const nodeIds = nodes.map(it => it.id);
            expect(new Set(nodeIds).size, name).toBe(nodeIds.length);
            expect(new Set(edges.map(it => it.id)).size, name).toBe(edges.length);
            for (const edge of edges) expect(nodeIds, `${name}: ${edge.id}`).toEqual(expect.arrayContaining([edge.source, edge.target]));
            expect(edges.filter(it => it.target.endsWith('-in') && !it.target.startsWith('inserter')), name).toEqual([]);
            expect(edges.filter(it => it.source.endsWith('-out')), name).toEqual([]);
        }
    });

    it('keeps the vertical placement of a machine loop', () => {
        const { nodes, edges } = graph(FIXTURES['a machine loop']());
        expect(nodes.filter(it => it.id === 'inserter-1' || it.id === 'inserter-2').map(it => it.data.vertical).sort()).toEqual(['down', 'up']);
        const handles = edges.filter(it => it.sourceHandle).flatMap(it => [it.sourceHandle, it.targetHandle]);
        for (const side of ['top-', 'bottom-']) expect(handles.some(it => it?.startsWith(side)), side).toBe(true);
    });

    it('puts the List row\'s chip text on an inserter with a rule, and none on Auto', () => {
        const clocked: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 0, end: 7 }], period_duration_ticks: 192 };
        const { nodes } = graph(form({ machines: 1, belts: 1 }, [
            inserter(1, belt(1), machine(1), { enable_control: clocked }),
            inserter(2, belt(1), machine(1), { enable_control: { mode: 'AUTO' } }),
            inserter(3, machine(1), belt(1)),
        ]));
        const data = (id: string) => nodes.find(it => it.id === id)!.data as InserterNodeData;
        expect(data('inserter-1')).toMatchObject({ enableChip: describeEnableRule(clocked).chip, enableSummary: describeEnableRule(clocked).summary });
        expect(data('inserter-2').enableChip).toBeUndefined();
        expect([data('inserter-3').enableChip, data('inserter-3').enableSummary]).toEqual([undefined, undefined]);
    });

    it('lists the nodes left to right, then top to bottom, which is the order Tab takes', () => {
        for (const { name, nodes } of graphs()) {
            for (let i = 1; i < nodes.length; i++) {
                const [a, b] = [nodes[i - 1].position, nodes[i].position];
                expect(Math.round(a.x) < Math.round(b.x) || (Math.round(a.x) === Math.round(b.x) && a.y <= b.y), `${name}: node ${i}`).toBe(true);
            }
        }
    });

    it('says which side each half of a belt drawn twice is, in its name and its label\'s title', () => {
        const { nodes } = graph(FIXTURES['belt in and out']());
        const half = (id: string) => nodes.find(it => it.id === id)!;
        expect(half('belt-1-in').ariaLabel).toBe('Belt 1 (in), the side inserters take from, carries iron-plate and copper-plate');
        expect(half('belt-1-out').ariaLabel).toBe('Belt 1 (out), the side inserters put items onto, carries iron-plate and copper-plate');
        expect(half('belt-1-in').data.halfTitle).toBe('Belt 1 is drawn twice: inserters take from this side');
        expect(half('belt-1-out').data.halfTitle).toBe('Belt 1 is drawn twice: inserters put items onto this side');
    });

    it('names every node for assistive technology, starting with its label', () => {
        for (const { name, nodes } of graphs()) {
            for (const node of nodes) {
                const label = 'label' in node.data ? String(node.data.label)
                    : node.id.replace(/^(\w)(\w*)-(\d+)$/, (_, a: string, b: string, n: string) => `${a.toUpperCase()}${b} ${n}`);
                expect(node.ariaLabel, `${name}: ${node.id}`).toBeTruthy();
                expect(node.ariaLabel!.startsWith(label), `${name}: ${node.ariaLabel} starts with ${label}`).toBe(true);
            }
        }
    });

    it('reserves stable replay node geometry for chains and machine loops', () => {
        for (const { name, nodes, edges } of graphs({ detail: false, nodeHeight: 210 })) {
            expect(nodes.length, name).toBeGreaterThan(0);
            for (const node of nodes) expect([node.position.x, node.position.y].every(Number.isFinite), `${name}: ${node.id}`).toBe(true);
            for (const edge of edges) expect(nodes.map(node => node.id), `${name}: ${edge.id}`).toEqual(expect.arrayContaining([edge.source, edge.target]));
            // Nodes in the same column must have room for their fixed replay readout.
            for (const [a, b] of pairs(nodes)) {
                if (Math.abs(a.position.x - b.position.x) < 1) expect(Math.abs(a.position.y - b.position.y), `${name}: ${a.id} and ${b.id}`).toBeGreaterThanOrEqual(210);
            }
        }
    });

    it.each([0, 168, 210])('keeps all nodes and routes clear with node height %s', nodeHeight => {
        for (const { name, nodes, edges } of graphs({ nodeHeight })) {
            const rectangles = nodes.map(node => ({ ...flowNodeRect(node), id: node.id }));
            for (const [a, b] of pairs(rectangles)) {
                expect(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height, `${name}: ${a.id} overlaps ${b.id}`).toBe(true);
            }
            const routes = routeFlowEdges(nodes, edges);
            expect(routes.size, name).toBe(edges.length);
            for (const edge of edges) {
                const route = routes.get(edge.id)!;
                for (let i = 1; i < route.points.length; i++) {
                    const a = route.points[i - 1], b = route.points[i];
                    expect(a.x === b.x || a.y === b.y, `${name}: diagonal ${edge.id}`).toBe(true);
                    for (const rect of rectangles) {
                        const crosses = a.x === b.x
                            ? a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
                            : a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
                        expect(crosses, `${name}: ${edge.id} crosses ${rect.id}`).toBe(false);
                    }
                }
            }
        }
    });
});
