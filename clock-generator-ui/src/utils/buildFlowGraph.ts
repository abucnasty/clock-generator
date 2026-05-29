import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { MachineFormData, BeltFormData, ChestFormData, InserterFormData, DrillFormData } from '../hooks/useConfigForm';
import { isBufferChest } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { inferInserterItems } from './inferInserterItems';

export const ENTITY_NODE_WIDTH = 180;
export const ENTITY_NODE_HEIGHT = 80;
export const ENTITY_NODE_DETAIL_HEIGHT = 200;
export const INSERTER_NODE_WIDTH = 140;
export const INSERTER_NODE_HEIGHT = 70;
export const DRILL_NODE_WIDTH = 140;
export const DRILL_NODE_HEIGHT = 70;

export type MachineNodeParams = {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    type?: 'machine' | 'furnace';
};

export type EntityNodeData = {
    entityType: 'machine' | 'belt' | 'chest';
    entityId: number;
    label: string;
    iconName: string;
    sublabel?: string;
    filterIcons?: string[];
    machineParams?: MachineNodeParams;
    detailed?: boolean;
};

export type InserterNodeData = {
    inserterId: number;
    stackSize: number;
    filterIcons?: string[];
};

export type DrillNodeData = {
    drillId: number;
    drillType: string;
    minedItem: string;
};

export function buildFlowGraph(
    machines: MachineFormData[],
    inserters: InserterFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    drills?: DrillFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
    detailMode?: boolean,
): { nodes: Node[], edges: Edge[] } {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100, ranker: 'longest-path' });

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // --- Entity nodes ---
    machines.forEach(machine => {
        const id = `machine-${machine.id}`;
        const nodeHeight = detailMode ? ENTITY_NODE_DETAIL_HEIGHT : ENTITY_NODE_HEIGHT;
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: nodeHeight });
        nodes.push({
            id,
            type: 'entityNode',
            position: { x: 0, y: 0 },
            data: {
                entityType: 'machine',
                entityId: machine.id,
                label: `Machine ${machine.id}`,
                iconName: machine.recipe || 'assembling-machine-3',
                sublabel: machine.recipe || undefined,
                machineParams: {
                    recipe: machine.recipe || '',
                    productivity: machine.productivity,
                    crafting_speed: machine.crafting_speed,
                    type: machine.type,
                },
                detailed: detailMode,
            } satisfies EntityNodeData,
        });
    });

    belts.forEach(belt => {
        const id = `belt-${belt.id}`;
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: ENTITY_NODE_HEIGHT });
        const filterIcons = belt.lanes.map(l => l.ingredient).filter(Boolean);
        nodes.push({
            id,
            type: 'entityNode',
            position: { x: 0, y: 0 },
            data: {
                entityType: 'belt',
                entityId: belt.id,
                label: `Belt ${belt.id}`,
                iconName: belt.type,
                filterIcons: filterIcons.length > 0 ? filterIcons : undefined,
            } satisfies EntityNodeData,
        });
    });

    chests.forEach(chest => {
        const id = `chest-${chest.id}`;
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: ENTITY_NODE_HEIGHT });
        let iconName: string;
        let filterIcons: string[] | undefined;
        if (isBufferChest(chest)) {
            iconName = 'iron-chest';
            filterIcons = chest.item_filter ? [chest.item_filter] : undefined;
        } else {
            iconName = 'infinity-chest';
            const items = chest.item_filter.map(f => f.item_name).filter(Boolean);
            filterIcons = items.length > 0 ? items : undefined;
        }
        nodes.push({
            id,
            type: 'entityNode',
            position: { x: 0, y: 0 },
            data: {
                entityType: 'chest',
                entityId: chest.id,
                label: `Chest ${chest.id}`,
                iconName,
                filterIcons,
            } satisfies EntityNodeData,
        });
    });

    // --- Inserter nodes + edges ---
    inserters.forEach(inserter => {
        const inserterNodeId = `inserter-${inserter.id}`;
        const sourceNodeId = `${inserter.source.type}-${inserter.source.id}`;
        const sinkNodeId = `${inserter.sink.type}-${inserter.sink.id}`;
        g.setNode(inserterNodeId, { width: INSERTER_NODE_WIDTH, height: INSERTER_NODE_HEIGHT });
        // Derive displayed items: explicit filters first, then auto-infer from source/sink
        const inferred = inserter.filters && inserter.filters.length > 0
            ? inserter.filters
            : inferInserterItems(inserter, machines, belts, chests, getRecipeInfo);
        const filterIcons = inferred.length > 0 ? inferred.slice(0, 3) : undefined;
        nodes.push({
            id: inserterNodeId,
            type: 'inserterNode',
            position: { x: 0, y: 0 },
            data: {
                inserterId: inserter.id,
                stackSize: inserter.stack_size,
                filterIcons,
            } satisfies InserterNodeData,
        });

        if (g.hasNode(sourceNodeId)) {
            g.setEdge(sourceNodeId, inserterNodeId);
            edges.push({
                id: `edge-${sourceNodeId}-to-${inserterNodeId}`,
                source: sourceNodeId,
                target: inserterNodeId,
                type: 'smoothstep',
            });
        }

        if (g.hasNode(sinkNodeId)) {
            g.setEdge(inserterNodeId, sinkNodeId);
            edges.push({
                id: `edge-${inserterNodeId}-to-${sinkNodeId}`,
                source: inserterNodeId,
                target: sinkNodeId,
                type: 'smoothstep',
            });
        }
    });

    // --- Drill nodes + edges ---
    (drills ?? []).forEach(drill => {
        const drillNodeId = `drill-${drill.id}`;
        const targetNodeId = `machine-${drill.target.id}`;
        g.setNode(drillNodeId, { width: DRILL_NODE_WIDTH, height: DRILL_NODE_HEIGHT });
        nodes.push({
            id: drillNodeId,
            type: 'drillNode',
            position: { x: 0, y: 0 },
            data: {
                drillId: drill.id,
                drillType: drill.type,
                minedItem: drill.mined_item_name,
            } satisfies DrillNodeData,
        });

        if (g.hasNode(targetNodeId)) {
            g.setEdge(drillNodeId, targetNodeId);
            edges.push({
                id: `edge-${drillNodeId}-to-${targetNodeId}`,
                source: drillNodeId,
                target: targetNodeId,
                type: 'smoothstep',
            });
        }
    });

    // Run dagre layout
    dagre.layout(g);

    // Apply dagre-computed positions (dagre centers nodes, so offset by half size)
    const positionedNodes = nodes.map(node => {
        const dagreNode = g.node(node.id);
        let w = ENTITY_NODE_WIDTH, h = ENTITY_NODE_HEIGHT;
        if (node.type === 'inserterNode') { w = INSERTER_NODE_WIDTH; h = INSERTER_NODE_HEIGHT; }
        else if (node.type === 'drillNode') { w = DRILL_NODE_WIDTH; h = DRILL_NODE_HEIGHT; }
        return {
            ...node,
            position: {
                x: dagreNode.x - w / 2,
                y: dagreNode.y - h / 2,
            },
        };
    });

    return { nodes: positionedNodes, edges };
}
