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
    type?: 'machine' | 'furnace' | 'biochamber';
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
    /** The machine is in a loop with the machine above or below it: the inserters between them connect to its top and bottom */
    verticalHandles?: boolean;
};

export type InserterNodeData = {
    inserterId: number;
    stackSize: number;
    filterIcons?: string[];
    overrideMode?: 'ALWAYS' | 'NEVER' | 'CLOCKED' | 'CONDITIONAL';
    /** An inserter between two machines of a loop, drawn between them: it carries items down or up */
    vertical?: 'down' | 'up';
};

/** Room left between two machines of a loop for the inserters that go between them */
const LOOP_GAP = 60;

/**
 * Inserters between machines that feed each other in a loop, like two biochambers that give each other the item
 * their recipe starts from. A layered layout cannot place a loop: it puts the two machines in different columns and
 * the inserters far from both. These inserters are left out of it and drawn between their machines.
 */
function loopInserterIds(inserters: InserterFormData[]): Set<number> {
    const between_machines = inserters.filter(it => it.source.type === 'machine' && it.sink.type === 'machine');
    const reaches = (from: number, to: number): boolean => {
        const seen = new Set<number>();
        const queue = [from];
        while (queue.length > 0) {
            const current = queue.pop()!;
            if (current === to) return true;
            if (seen.has(current)) continue;
            seen.add(current);
            between_machines.filter(it => it.source.id === current).forEach(it => queue.push(it.sink.id));
        }
        return false;
    };
    return new Set(between_machines.filter(it => reaches(it.sink.id, it.source.id)).map(it => it.id));
}

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
    const loop_ids = loopInserterIds(inserters);
    const loop_inserters = inserters.filter(it => loop_ids.has(it.id));
    const loop_machine_ids = new Set(loop_inserters.flatMap(it => [it.source.id, it.sink.id]));

    // --- Entity nodes ---
    machines.forEach(machine => {
        const id = `machine-${machine.id}`;
        const nodeHeight = detailMode ? ENTITY_NODE_DETAIL_HEIGHT : ENTITY_NODE_HEIGHT;
        const in_loop = loop_machine_ids.has(machine.id);
        // taller in the layout than it is drawn, which leaves room above and below for the inserters of its loop
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: nodeHeight + (in_loop ? INSERTER_NODE_HEIGHT + LOOP_GAP : 0) });
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
                verticalHandles: in_loop,
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
        const in_loop = loop_ids.has(inserter.id);
        if (!in_loop) {
            g.setNode(inserterNodeId, { width: INSERTER_NODE_WIDTH, height: INSERTER_NODE_HEIGHT });
        }
        // Derive displayed items: explicit filters first, then auto-infer from source/sink
        const inferred = inserter.filters && inserter.filters.length > 0
            ? inserter.filters
            : inferInserterItems(inserter, machines, belts, chests, getRecipeInfo);
        const filterIcons = inferred.length > 0 ? inferred.slice(0, 3) : undefined;
        const ecMode = inserter.overrides?.enable_control?.mode;
        const overrideMode = ecMode && ecMode !== 'AUTO' ? ecMode as 'ALWAYS' | 'NEVER' | 'CLOCKED' | 'CONDITIONAL' : undefined;
        nodes.push({
            id: inserterNodeId,
            type: 'inserterNode',
            position: { x: 0, y: 0 },
            data: {
                inserterId: inserter.id,
                stackSize: inserter.stack_size,
                filterIcons,
                overrideMode,
            } satisfies InserterNodeData,
        });

        if (in_loop) {
            // connected once its machines have a place
            return;
        }

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
    const machine_height = detailMode ? ENTITY_NODE_DETAIL_HEIGHT : ENTITY_NODE_HEIGHT;
    const positionedNodes = nodes.filter(node => g.hasNode(node.id)).map(node => {
        const dagreNode = g.node(node.id);
        let w = ENTITY_NODE_WIDTH, h = ENTITY_NODE_HEIGHT;
        if (node.type === 'inserterNode') { w = INSERTER_NODE_WIDTH; h = INSERTER_NODE_HEIGHT; }
        else if (node.type === 'drillNode') { w = DRILL_NODE_WIDTH; h = DRILL_NODE_HEIGHT; }
        else if ((node.data as EntityNodeData).entityType === 'machine') { h = machine_height; }
        return {
            ...node,
            position: {
                x: dagreNode.x - w / 2,
                y: dagreNode.y - h / 2,
            },
        };
    });

    // The inserters of a loop go between their two machines: side by side when several connect the same pair
    const pairKey = (inserter: InserterFormData) => [inserter.source.id, inserter.sink.id].sort((a, b) => a - b).join('-');
    for (const inserter of loop_inserters) {
        const node = nodes.find(it => it.id === `inserter-${inserter.id}`)!;
        const source = g.node(`machine-${inserter.source.id}`);
        const sink = g.node(`machine-${inserter.sink.id}`);
        if (!source || !sink) {
            continue;
        }
        const down = source.y <= sink.y;
        // the ones that carry down on the left, under the handle they take from, the ones that carry up on the right
        const goesDown = (it: InserterFormData) => g.node(`machine-${it.source.id}`).y <= g.node(`machine-${it.sink.id}`).y;
        const in_pair = loop_inserters.filter(it => pairKey(it) === pairKey(inserter));
        const index = in_pair.filter(it => goesDown(it) === down).indexOf(inserter) + (down ? 0 : in_pair.filter(goesDown).length);
        const row_width = in_pair.length * INSERTER_NODE_WIDTH + (in_pair.length - 1) * 20;
        const center_x = (source.x + sink.x) / 2 - row_width / 2 + index * (INSERTER_NODE_WIDTH + 20) + INSERTER_NODE_WIDTH / 2;
        const center_y = (source.y + sink.y) / 2;
        positionedNodes.push({
            ...node,
            data: { ...node.data, vertical: down ? 'down' : 'up' },
            position: { x: center_x - INSERTER_NODE_WIDTH / 2, y: center_y - INSERTER_NODE_HEIGHT / 2 },
        });
        edges.push({
            id: `edge-machine-${inserter.source.id}-to-inserter-${inserter.id}`,
            source: `machine-${inserter.source.id}`,
            sourceHandle: down ? 'bottom-out' : 'top-out',
            target: `inserter-${inserter.id}`,
            targetHandle: 'in',
            type: 'smoothstep',
        });
        edges.push({
            id: `edge-inserter-${inserter.id}-to-machine-${inserter.sink.id}`,
            source: `inserter-${inserter.id}`,
            sourceHandle: 'out',
            target: `machine-${inserter.sink.id}`,
            targetHandle: down ? 'top-in' : 'bottom-in',
            type: 'smoothstep',
        });
    }

    return { nodes: positionedNodes, edges };
}
