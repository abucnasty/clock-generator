import { describe, expect, it } from 'vitest';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { ChestType } from 'clock-generator/light';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData, type EnableControlOverride, type InserterFormData } from './configForm/formData';
import { buildFlowGraph, flowNodeEntity, type InserterNodeData } from './buildFlowGraph';
import { describeEnableRule } from './enableRuleLabel';

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
};

describe('buildFlowGraph', () => {
    it('gives every edge an arrowhead, loop and drill edges included', () => {
        for (const [name, fixture] of Object.entries(FIXTURES)) {
            const { edges } = graph(fixture());
            expect(edges.length, name).toBeGreaterThan(0);
            for (const edge of edges) {
                expect((edge.markerEnd as { type: MarkerType }).type, `${name}: ${edge.id}`).toBe(MarkerType.ArrowClosed);
            }
        }
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
            for (const edge of edges.filter(it => !it.sourceHandle)) {
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
