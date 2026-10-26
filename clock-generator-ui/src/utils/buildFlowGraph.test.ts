import { describe, expect, it } from 'vitest';
import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import { ChestType } from 'clock-generator/light';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData, type EnableControlOverride, type InserterFormData } from './configForm/formData';
import { buildFlowGraph, flowNodeEntity, type InserterNodeData } from './buildFlowGraph';
import { flowNodeRect, routeFlowEdges, type FlowPort } from './flowRouting';
import { describeEnableRule } from './enableRuleLabel';
import type { OutputTransferSummary } from 'clock-generator/browser';

type End = InserterFormData['source'];

const belt = (id: number): End => ({ type: 'belt', id });
const chest = (id: number): End => ({ type: 'chest', id });
const machine = (id: number): End => ({ type: 'machine', id });

const inserter = (id: number, source: End, sink: End, overrides?: InserterFormData['overrides']): InserterFormData =>
    ({ id, _uuid: `inserter-${id}`, source, sink, stack_size: 16, ...(overrides && { overrides }) });

/** A form with this many machines, belts (two lanes) and chests, and these inserters */
function form(counts: { machines: number; belts?: number; chests?: number; drills?: number }, inserters: InserterFormData[]): ConfigFormData {
    let config = createDefaultConfig();
    for (let i = 1; i < counts.machines; i++) config = edits.addMachine(config);
    for (let i = 0; i < (counts.belts ?? 0); i++) config = edits.addBelt(config);
    for (let i = 0; i < (counts.chests ?? 0); i++) config = edits.addChest(config, ChestType.INFINITY_CHEST);
    for (let i = 0; i < (counts.drills ?? 0); i++) config = edits.addDrill(config);
    config = {
        ...config,
        belts: config.belts.map(b => ({ ...b, lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'copper-plate', stack_size: 4 }] })),
    };
    return { ...config, inserters };
}

function graph(config: ConfigFormData) {
    return buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, config.drills?.configs ?? [], undefined, true);
}

const x = (nodes: Node[], id: string) => {
    const node = nodes.find(it => it.id === id);
    if (!node) throw new Error(`no node ${id} in ${nodes.map(it => it.id).join(', ')}`);
    return node.position.x;
};

const FIXTURES: Record<string, () => ConfigFormData> = {
    // as logistic-science.json
    'belt in and out': () => form({ machines: 1, belts: 1 }, [
        inserter(1, belt(1), machine(1)),
        inserter(2, belt(1), machine(1)),
        inserter(3, machine(1), belt(1)),
    ]),
    'chest in and out': () => form({ machines: 1, chests: 1 }, [
        inserter(1, chest(1), machine(1)),
        inserter(2, machine(1), chest(1)),
    ]),
    'a chain machine to belt to machine': () => form({ machines: 2, belts: 2 }, [
        inserter(1, belt(1), machine(1)),
        inserter(2, machine(1), belt(2)),
        inserter(3, belt(2), machine(2)),
    ]),
    'two input belts and a chest output': () => form({ machines: 1, belts: 2, chests: 1 }, [
        inserter(1, belt(1), machine(1)),
        inserter(2, belt(2), machine(1)),
        inserter(3, machine(1), chest(1)),
    ]),
    'a drill feeding a machine with a belt output': () => {
        const config = form({ machines: 1, belts: 1, drills: 1 }, [inserter(1, machine(1), belt(1))]);
        return edits.updateDrill(config, 0, { target: { type: 'machine', id: 1 } });
    },
    'an unused belt': () => form({ machines: 1, belts: 2 }, [
        inserter(1, belt(1), machine(1)),
    ]),
    // two biochambers that feed each other, fed by a belt and giving to a chest, as iron-bacteria-cultivation.json
    'a machine loop': () => form({ machines: 2, belts: 1, chests: 1 }, [
        inserter(1, machine(1), machine(2)),
        inserter(2, machine(2), machine(1)),
        inserter(3, belt(1), machine(1)),
        inserter(4, belt(1), machine(2)),
        inserter(5, machine(1), chest(1)),
        inserter(6, machine(2), chest(1)),
    ]),
    'loop beside an unrelated belt': () => form({ machines: 3, belts: 2, chests: 1 }, [
        inserter(1, machine(1), machine(2)), inserter(2, machine(2), machine(1)),
        inserter(3, belt(1), machine(1)), inserter(4, belt(1), machine(2)),
        inserter(5, belt(2), machine(3)), inserter(6, machine(1), machine(3)),
        inserter(7, machine(2), machine(3)), inserter(8, machine(3), chest(1)),
    ]),
    'many reciprocal inserters': () => form({ machines: 2 }, Array.from({ length: 8 }, (_, i) =>
        inserter(i + 1, machine(i % 2 + 1), machine((i + 1) % 2 + 1)))),
    'three machine cycle': () => form({ machines: 3, belts: 1 }, [
        inserter(1, machine(1), machine(2)), inserter(2, machine(2), machine(3)),
        inserter(3, machine(3), machine(1)), inserter(4, belt(1), machine(2)),
    ]),
    'self loop': () => form({ machines: 1 }, [inserter(1, machine(1), machine(1))]),

};

describe('buildFlowGraph labels', () => {
    it('says the game names in the nodes\' aria-labels while the data keeps the ids', () => {
        const config = form({ machines: 1, belts: 1 }, []);
        const machines = config.machines.map(m => ({ ...m, recipe: 'iron-gear-wheel' }));
        const label = (id: string) => `<${id}>`;
        const { nodes } = buildFlowGraph(machines, [], config.belts, [], [], undefined, false, { itemLabel: label, recipeLabel: label });
        const aria = nodes.map(n => (n as Node & { ariaLabel?: string }).ariaLabel ?? '');
        expect(aria.some(a => a.includes('makes <iron-gear-wheel>'))).toBe(true);
        expect(aria.some(a => a.includes('carries <iron-plate> and <copper-plate>'))).toBe(true);
        expect(JSON.stringify(nodes.map(n => n.data))).toContain('iron-gear-wheel');
    });
});

describe('buildFlowGraph', () => {
    it('gives every edge an arrowhead, loop and drill edges included', () => {
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            const { edges } = graph(fixture());
            expect(edges.length, name).toBeGreaterThan(0);
            for (const edge of edges) {
                if (edge.id.startsWith('output-transfer-unknown-') || edge.id.startsWith('output-transfer-none-') || edge.id.startsWith('output-transfer-drill-unknown-')) {
                    expect(edge.markerEnd, `${name}: ${edge.id}`).toBeUndefined();
                    expect(edge.style?.strokeDasharray, `${name}: ${edge.id}`).toBe('5 4');
                } else {
                    expect((edge.markerEnd as { type: MarkerType }).type, `${name}: ${edge.id}`).toBe(MarkerType.ArrowClosed);
                }
            }
        }
    });

    it('draws a drill into a chest as an edge to the chest', () => {
        const base = form({ machines: 1, belts: 1, chests: 1, drills: 1 }, [inserter(1, chest(1), machine(1)), inserter(2, machine(1), belt(1))]);
        const config = { ...base, drills: { ...base.drills!, configs: base.drills!.configs.map(drill => ({ ...drill, target: { type: 'chest' as const, id: 1 } })) } };
        const { edges } = graph(config);
        expect(edges.some(edge => edge.source === 'drill-1' && edge.target === 'chest-1')).toBe(true);
        expect(edges.some(edge => edge.source === 'drill-1' && edge.target.startsWith('machine'))).toBe(false);
    });

    describe('a machine that places its results itself', () => {
        // a recycler whose car is emptied back into it by an inserter: the car both feeds the machine and takes its results
        const recycler = (target: { type: 'chest'; id: number } | undefined, inserters = [inserter(1, chest(1), machine(1))]) => {
            const base = form({ machines: 1, chests: 2 }, inserters);
            return { ...base, machines: base.machines.map(row => ({ ...row, prototype: 'recycler', ...(target && { result_target: target }) })) };
        };

        it('draws its results into its result target as an edge to the container, as a drill\'s drop is', () => {
            const { edges } = graph(recycler({ type: 'chest', id: 2 }));
            expect(edges.some(edge => edge.source === 'machine-1' && edge.target === 'chest-2')).toBe(true);
            expect(edges.every(edge => edge.id.startsWith('output-transfer-unknown-')
                ? edge.markerEnd === undefined && edge.style?.strokeDasharray === '5 4'
                : (edge.markerEnd as { type: MarkerType }).type === MarkerType.ArrowClosed)).toBe(true);
        });

        it('draws no edge for a machine without a result target, or whose container is deleted', () => {
            expect(graph(recycler(undefined)).edges.some(edge => edge.source === 'machine-1' && edge.target.startsWith('chest'))).toBe(false);
            expect(graph(recycler({ type: 'chest', id: 0 })).edges.some(edge => edge.source === 'machine-1' && edge.target.startsWith('chest'))).toBe(false);
        });

        it('draws the container twice, in and out, when inserters take the results back into the machine', () => {
            const { nodes, edges } = graph(recycler({ type: 'chest', id: 1 }));
            expect(nodes.map(node => node.id)).toEqual(expect.arrayContaining(['chest-1-in', 'chest-1-out']));
            expect(edges.some(edge => edge.source === 'machine-1' && edge.target === 'chest-1-out')).toBe(true);
            expect(edges.some(edge => edge.source === 'chest-1-in' && edge.target === 'inserter-1')).toBe(true);
            expect(x(nodes, 'chest-1-in')).toBeLessThan(x(nodes, 'inserter-1'));
            expect(x(nodes, 'inserter-1')).toBeLessThan(x(nodes, 'machine-1'));
            expect(x(nodes, 'machine-1')).toBeLessThan(x(nodes, 'chest-1-out'));
        });

        it('groups accepted product labels on one physical target edge and reads inserter items from shared output facts', () => {
            const config = recycler({ type: 'chest', id: 2 }, [inserter(9, machine(1), belt(1))]);
            const summary: OutputTransferSummary = {
                source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 2 }, mechanism: 'result-placement', status: 'known', results: [
                    { item_name: 'electronic-circuit', direct: 'accepted', inserters: [], coverage: 'covered' },
                    { item_name: 'advanced-circuit', direct: 'accepted', inserters: [{ inserter_id: 9, target: { type: 'belt', id: 1 } }], coverage: 'covered' },
                ],
            };
            const { nodes, edges } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, [], undefined, false, {
                itemLabel: name => name === 'electronic-circuit' ? 'Electronic circuit' : 'Advanced circuit', recipeLabel: name => name,
            }, 0, [summary]);
            const resultEdges = edges.filter(edge => edge.id.startsWith('output-transfer-machine-1-'));
            expect(resultEdges).toHaveLength(1);
            expect((resultEdges[0].data as { outputItems: { name: string; label: string }[] }).outputItems).toEqual([
                { name: 'advanced-circuit', label: 'Advanced circuit' }, { name: 'electronic-circuit', label: 'Electronic circuit' },
            ]);
            expect((nodes.find(node => node.id === 'inserter-9')?.data as InserterNodeData).filterIcons).toEqual(['advanced-circuit']);
            expect(nodes.filter(node => node.id === 'machine-1')).toHaveLength(1);
        });

        it('shows a selected zero-acceptance target as a dashed physical reference with no direct arrow', () => {
            const config = recycler({ type: 'chest', id: 2 });
            const summary: OutputTransferSummary = {
                source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 2 }, mechanism: 'result-placement', status: 'known', results: [
                    { item_name: 'advanced-circuit', direct: 'rejected', inserters: [], coverage: 'missing' },
                ],
            };
            const { edges } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, [], undefined, false, undefined, 0, [summary]);
            const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-none-1-'))!;
            expect(edge.markerEnd).toBeUndefined();
            expect(edge.style?.strokeDasharray).toBe('5 4');
            expect((edge.data as { labelText: string }).labelText).toBe('No direct transfer');
        });

        it('keeps an unavailable result-less source distinct from a known zero-transfer target', () => {
            const config = recycler({ type: 'chest', id: 2 });
            const summary: OutputTransferSummary = {
                source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 2 }, mechanism: 'result-placement', status: 'unavailable', results: [],
            };
            const { edges } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, [], undefined, false, undefined, 0, [summary]);
            const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-none-1-'))!;
            expect(edge.markerEnd).toBeUndefined();
            expect((edge.data as { labelText: string }).labelText).toBe('Output routes unavailable');
        });

        it('draws the container once when nothing takes the results back', () => {
            const { nodes } = graph(recycler({ type: 'chest', id: 2 }));
            expect(nodes.some(node => node.id === 'chest-2')).toBe(true);
            expect(nodes.some(node => node.id.startsWith('chest-2-'))).toBe(false);
        });

        it('says in the node\'s name where the results go', () => {
            const config = recycler({ type: 'chest', id: 1 });
            const { nodes } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, [], undefined, false);
            expect((nodes.find(node => node.id === 'machine-1') as Node & { ariaLabel?: string }).ariaLabel).toContain('puts its results into Chest 1');
        });
    });

    describe('a drill drop target', () => {
        const graphFor = (direct: 'accepted' | 'rejected' | 'unknown', status: 'known' | 'unavailable') => {
            const config = edits.updateDrill(form({ machines: 1, chests: 1, drills: 1 }, []), 0, {
                mined_item_name: 'iron-ore', target: { type: 'chest', id: 1 },
            });
            const summary: OutputTransferSummary = {
                source: { type: 'drill', id: 1 }, physical_target: { type: 'chest', id: 1 }, mechanism: 'mining-drop', status,
                results: [{ item_name: 'iron-ore', direct, inserters: [], coverage: direct === 'accepted' ? 'covered' : direct === 'rejected' ? 'missing' : 'unknown' }],
            };
            return buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, config.drills?.configs ?? [], undefined, false, undefined, 0, [summary]);
        };

        it('shows a known accepted result as an active drop', () => {
            const { edges } = graphFor('accepted', 'known');
            const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-drill-1-'))!;
            expect((edge.markerEnd as { type: MarkerType }).type).toBe(MarkerType.ArrowClosed);
            expect((edge.data as { outputItems: { name: string; label: string }[] }).outputItems).toEqual([{ name: 'iron-ore', label: 'iron-ore' }]);
        });

        it('shows a known rejected result as a non-transferring reference', () => {
            const { edges } = graphFor('rejected', 'known');
            const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-drill-none-1-'))!;
            expect(edge.markerEnd).toBeUndefined();
            expect(edge.style?.strokeDasharray).toBe('5 4');
            expect((edge.data as { labelText: string }).labelText).toBe('No direct transfer');
        });

        it('keeps an unavailable drill result visibly unknown', () => {
            const { edges } = graphFor('unknown', 'unavailable');
            const edge = edges.find(candidate => candidate.id.startsWith('output-transfer-drill-unknown-1-'))!;
            expect(edge.markerEnd).toBeUndefined();
            expect((edge.data as { labelText: string }).labelText).toBe('Output routes unavailable');
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
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            const { nodes, edges } = graph(fixture());
            for (const edge of edges.filter(it => {
                const ports = nodes.find(node => node.id === it.source)!.data.routePorts as FlowPort[];
                return ports.find(port => port.id === it.sourceHandle)?.position === Position.Right;
            })) {
                expect(x(nodes, edge.source), `${name}: ${edge.id}`).toBeLessThan(x(nodes, edge.target));
            }
        }
    });

    it('draws a belt or chest that feeds a machine and takes its output as two halves, and any other as one node', () => {
        const split = graph(FIXTURES['belt in and out']()).nodes;
        const halves = split.filter(it => it.id.startsWith('belt-1'));
        expect(halves.map(it => it.id).sort()).toEqual(['belt-1-in', 'belt-1-out']);
        for (const half of halves) {
            expect(flowNodeEntity(half)).toEqual({ type: 'belt', id: 1 });
        }
        expect(halves.find(it => it.id === 'belt-1-in')!.data.label).toMatch(/\(in\)$/);
        expect(halves.find(it => it.id === 'belt-1-out')!.data.label).toMatch(/\(out\)$/);

        const chain = graph(FIXTURES['a chain machine to belt to machine']()).nodes.map(it => it.id);
        expect(chain).toContain('belt-2');
        const ends = graph(FIXTURES['two input belts and a chest output']()).nodes.map(it => it.id);
        expect(ends).toEqual(expect.arrayContaining(['belt-1', 'belt-2', 'chest-1']));
        expect(graph(FIXTURES['chest in and out']()).nodes.map(it => it.id)).toEqual(expect.arrayContaining(['chest-1-in', 'chest-1-out']));
    });

    it('keeps its edges between nodes it has, with unique ids and none into the in half or out of the out half', () => {
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            const { nodes, edges } = graph(fixture());
            const ids = nodes.map(it => it.id);
            expect(new Set(ids).size, name).toBe(ids.length);
            expect(new Set(edges.map(it => it.id)).size, name).toBe(edges.length);
            for (const edge of edges) {
                expect(ids, `${name}: ${edge.id}`).toContain(edge.source);
                expect(ids, `${name}: ${edge.id}`).toContain(edge.target);
            }
            expect(edges.filter((it: Edge) => it.target.endsWith('-in') && !it.target.startsWith('inserter')), name).toEqual([]);
            expect(edges.filter((it: Edge) => it.source.endsWith('-out')), name).toEqual([]);
        }
    });

    it('keeps the vertical placement of a machine loop', () => {
        const { nodes, edges } = graph(FIXTURES['a machine loop']());
        const loop = nodes.filter(it => it.id === 'inserter-1' || it.id === 'inserter-2');
        expect(loop.map(it => (it.data as InserterNodeData).vertical).sort()).toEqual(['down', 'up']);
        const handles = edges.filter(it => it.sourceHandle).flatMap(it => [it.sourceHandle, it.targetHandle]);
        expect(handles.some(it => it?.startsWith('top-'))).toBe(true);
        expect(handles.some(it => it?.startsWith('bottom-'))).toBe(true);
    });

    it('puts the List row\'s chip text on an inserter with a rule, and none on Auto', () => {
        const clocked: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 0, end: 7 }], period_duration_ticks: 192 };
        const config = form({ machines: 1, belts: 1 }, [
            inserter(1, belt(1), machine(1), { enable_control: clocked }),
            inserter(2, belt(1), machine(1), { enable_control: { mode: 'AUTO' } }),
            inserter(3, machine(1), belt(1)),
        ]);
        const data = (id: string) => graph(config).nodes.find(it => it.id === id)!.data as InserterNodeData;
        expect(data('inserter-1').enableChip).toBe(describeEnableRule(clocked).chip);
        expect(data('inserter-1').enableSummary).toBe(describeEnableRule(clocked).summary);
        expect(data('inserter-2').enableChip).toBeUndefined();
        expect(data('inserter-3').enableChip).toBeUndefined();
        expect(data('inserter-3').enableSummary).toBeUndefined();
    });

    it('lists the nodes left to right, then top to bottom, which is the order Tab takes', () => {
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            const positions = graph(fixture()).nodes.map(it => it.position);
            for (let i = 1; i < positions.length; i++) {
                const [a, b] = [positions[i - 1], positions[i]];
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
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            for (const node of graph(fixture()).nodes) {
                const label = 'label' in node.data ? String(node.data.label) : node.id.replace(/^(\w)(\w*)-(\d+)$/, (_, a: string, b: string, n: string) => `${a.toUpperCase()}${b} ${n}`);
                expect(node.ariaLabel, `${name}: ${node.id}`).toBeTruthy();
                expect(node.ariaLabel!.startsWith(label), `${name}: ${node.ariaLabel} starts with ${label}`).toBe(true);
            }
        }
    });
});

it('reserves stable replay node geometry for chains and machine loops', () => {
    for (const fixture of Object.values(FIXTURES)) {
        const config = fixture();
        const replay = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests, config.drills?.configs ?? [], undefined, false, undefined, 210);
        expect(replay.nodes.length).toBeGreaterThan(0);
        for (const node of replay.nodes) {
            expect(Number.isFinite(node.position.x)).toBe(true);
            expect(Number.isFinite(node.position.y)).toBe(true);
        }
        for (const edge of replay.edges) {
            expect(replay.nodes.some(node => node.id === edge.source)).toBe(true);
            expect(replay.nodes.some(node => node.id === edge.target)).toBe(true);
        }
        // Nodes in the same column must have room for their fixed replay readout.
        for (let i = 0; i < replay.nodes.length; i++) for (let j = i + 1; j < replay.nodes.length; j++) {
            const a = replay.nodes[i], b = replay.nodes[j];
            if (Math.abs(a.position.x - b.position.x) < 1) expect(Math.abs(a.position.y - b.position.y)).toBeGreaterThanOrEqual(210);
        }
    }
});


it.each([0, 168, 210])('keeps all nodes and routes clear with node height %s', nodeHeight => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        const config = fixture();
        const { nodes, edges } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests,
            config.drills?.configs ?? [], undefined, true, undefined, nodeHeight);
        const rectangles = nodes.map(node => ({ ...flowNodeRect(node), id: node.id }));
        for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
            const a = rectangles[i], b = rectangles[j];
            expect(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height,
                `${name}: ${a.id} overlaps ${b.id}`).toBe(true);
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
