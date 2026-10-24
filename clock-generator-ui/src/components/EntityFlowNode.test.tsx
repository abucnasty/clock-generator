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
beforeEach(() => { keys.repeated = []; });

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
