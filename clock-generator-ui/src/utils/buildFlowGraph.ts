import dagre from '@dagrejs/dagre';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import type { MachineFormData, BeltFormData, ChestFormData, InserterFormData, DrillFormData } from '../hooks/useConfigForm';
import { isBufferChest } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { describeEnableRule } from './enableRuleLabel';
import { entityLabel } from './entityLabel';
import { inferInserterItems } from './inferInserterItems';

// The sizes the nodes are drawn at (the components use the widths) and the layout places them by: the layout's must be
// at least what is drawn, or nodes overlap. Heights measured in the browser with 12px text (item 2.11): a belt, chest or
// machine 50, a machine with its facts 112 to 128 (two inputs; each more adds about 17), an inserter 64, 90 with a
// one-line chip.
export const ENTITY_NODE_WIDTH = 200;
const ENTITY_NODE_HEIGHT = 56;
/** Room for the facts of a recipe with up to five inputs */
const ENTITY_NODE_DETAIL_HEIGHT = 196;
export const INSERTER_NODE_WIDTH = 180;
const INSERTER_NODE_HEIGHT = 70;
/** Added to an inserter's height by its enable chip, which may wrap onto two lines */
const INSERTER_CHIP_HEIGHT = 44;
export const DRILL_NODE_WIDTH = 160;
const DRILL_NODE_HEIGHT = 56;

// The arrow fills only part of its marker box: 24 draws it about 6 by 10 px. In px, not stroke widths, so a highlighted
// (thicker) edge keeps the same arrow.
const ARROW = { type: MarkerType.ArrowClosed, width: 24, height: 24, markerUnits: 'userSpaceOnUse' } as const;

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
    /**
     * A belt or chest that feeds the machines and also takes their output is drawn twice: `in` on the left, the side
     * that feeds, and `out` on the right, the side that receives. Both stand for the same entity.
     */
    half?: 'in' | 'out';
};

export type InserterNodeData = {
    inserterId: number;
    stackSize: number;
    filterIcons?: string[];
    /** The List row's chip text for a rule other than Auto ("Enable: Clocked 0–7 of 192") */
    enableChip?: string;
    /** The whole rule, for the chip's title */
    enableSummary?: string;
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

/** The entity of the config a node of the flow graph stands for */
export type FlowNodeEntity = { type: 'machine' | 'belt' | 'chest' | 'inserter' | 'drill'; id: number };

type EntityEnd = InserterFormData['source'];

/** The id of the node of an entity; read the entity back from the node with `flowNodeEntity`, not from this */
function flowNodeId(type: FlowNodeEntity['type'], id: number, half?: 'in' | 'out'): string {
    return half ? `${type}-${id}-${half}` : `${type}-${id}`;
}

export function flowNodeEntity(node: Node): FlowNodeEntity {
    const data = node.data as EntityNodeData | InserterNodeData | DrillNodeData;
    if ('entityType' in data) return { type: data.entityType, id: data.entityId };
    if ('drillId' in data) return { type: 'drill', id: data.drillId };
    return { type: 'inserter', id: data.inserterId };
}

/**
 * The belts and chests on a loop through the inserters (not counting the inserters of a machine loop), by node id: a
 * belt that feeds a machine and takes its output. A layered layout breaks such a loop by turning an inserter around, so
 * these are drawn as two nodes, one on each side.
 */
function splitEntityIds(inserters: InserterFormData[], loop_ids: Set<number>): Set<string> {
    const next = new Map<string, string[]>();
    for (const it of inserters) {
        if (loop_ids.has(it.id)) continue;
        const from = flowNodeId(it.source.type, it.source.id);
        next.set(from, [...(next.get(from) ?? []), flowNodeId(it.sink.type, it.sink.id)]);
    }
    const reachesItself = (start: string): boolean => {
        const seen = new Set<string>();
        const queue = [...(next.get(start) ?? [])];
        while (queue.length > 0) {
            const current = queue.pop()!;
            if (current === start) return true;
            if (seen.has(current)) continue;
            seen.add(current);
            queue.push(...(next.get(current) ?? []));
        }
        return false;
    };
    const ends = inserters.flatMap(it => [it.source, it.sink]).filter(end => end.type === 'belt' || end.type === 'chest');
    return new Set(ends.map(end => flowNodeId(end.type, end.id)).filter(reachesItself));
}

/** Every edge has an arrowhead, so the flow reads source, inserter, destination */
function arrowEdge(source: string, target: string, handles?: { sourceHandle: string; targetHandle: string }): Edge {
    return {
        id: `edge-${source}-to-${target}`,
        source,
        target,
        type: 'smoothstep',
        markerEnd: { ...ARROW },
        ...handles,
    };
}

const HALF_SUFFIX: Record<'in' | 'out', string> = { in: ' (in)', out: ' (out)' };

/** "Belt 1 (in), transport-belt and inserter. Press Enter to edit": what a screen reader says for a node */
function nodeAriaLabel(label: string, contents?: string): string {
    return `${label}${contents ? `, ${contents}` : ''}. Press Enter to edit`;
}

function listText(items: string[] | undefined): string | undefined {
    return items && items.length > 0 ? items.join(' and ') : undefined;
}

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
    /** The size each node is drawn at, which places it at the centre dagre gives it */
    const drawn = new Map<string, { w: number; h: number }>();
    const loop_ids = loopInserterIds(inserters);
    const loop_inserters = inserters.filter(it => loop_ids.has(it.id));
    const loop_machine_ids = new Set(loop_inserters.flatMap(it => [it.source.id, it.sink.id]));
    const split_ids = splitEntityIds(inserters, loop_ids);

    /** The node an inserter takes from (the `in` half of a split entity) or gives to (the `out` half) */
    const endNodeId = (end: EntityEnd, half: 'in' | 'out') => {
        const id = flowNodeId(end.type, end.id);
        return split_ids.has(id) ? flowNodeId(end.type, end.id, half) : id;
    };

    /** A belt or a chest: one node, or two when it is on a loop */
    const pushEntityNode = (data: EntityNodeData, contents: string | undefined) => {
        const id = flowNodeId(data.entityType, data.entityId);
        const halves: ('in' | 'out' | undefined)[] = split_ids.has(id) ? ['in', 'out'] : [undefined];
        for (const half of halves) {
            const node_id = flowNodeId(data.entityType, data.entityId, half);
            const label = half ? `${data.label}${HALF_SUFFIX[half]}` : data.label;
            g.setNode(node_id, { width: ENTITY_NODE_WIDTH, height: ENTITY_NODE_HEIGHT });
            drawn.set(node_id, { w: ENTITY_NODE_WIDTH, h: ENTITY_NODE_HEIGHT });
            nodes.push({
                id: node_id,
                type: 'entityNode',
                position: { x: 0, y: 0 },
                ariaLabel: nodeAriaLabel(label, contents),
                data: { ...data, label, ...(half && { half }) } satisfies EntityNodeData,
            });
        }
    };

    // --- Entity nodes ---
    machines.forEach(machine => {
        const id = flowNodeId('machine', machine.id);
        const nodeHeight = detailMode ? ENTITY_NODE_DETAIL_HEIGHT : ENTITY_NODE_HEIGHT;
        const in_loop = loop_machine_ids.has(machine.id);
        // taller in the layout than it is drawn, which leaves room above and below for the inserters of its loop
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: nodeHeight + (in_loop ? INSERTER_NODE_HEIGHT + LOOP_GAP : 0) });
        drawn.set(id, { w: ENTITY_NODE_WIDTH, h: nodeHeight });
        const label = entityLabel('machine', machine.id);
        nodes.push({
            id,
            type: 'entityNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(label, machine.recipe || 'no recipe'),
            data: {
                entityType: 'machine',
                entityId: machine.id,
                label,
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
        const filterIcons = belt.lanes.map(l => l.ingredient).filter(Boolean);
        pushEntityNode({
            entityType: 'belt',
            entityId: belt.id,
            label: entityLabel('belt', belt.id),
            iconName: belt.type,
            filterIcons: filterIcons.length > 0 ? filterIcons : undefined,
        }, listText(filterIcons));
    });

    chests.forEach(chest => {
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
        pushEntityNode({
            entityType: 'chest',
            entityId: chest.id,
            label: entityLabel('chest', chest.id),
            iconName,
            filterIcons,
        }, listText(filterIcons));
    });

    // --- Inserter nodes + edges ---
    inserters.forEach(inserter => {
        const inserterNodeId = flowNodeId('inserter', inserter.id);
        const sourceNodeId = endNodeId(inserter.source, 'in');
        const sinkNodeId = endNodeId(inserter.sink, 'out');
        const in_loop = loop_ids.has(inserter.id);
        // Derive displayed items: explicit filters first, then auto-infer from source/sink
        const inferred = inserter.filters && inserter.filters.length > 0
            ? inserter.filters
            : inferInserterItems(inserter, machines, belts, chests, getRecipeInfo);
        const filterIcons = inferred.length > 0 ? inferred.slice(0, 3) : undefined;
        const rule = describeEnableRule(inserter.overrides?.enable_control, { forcedAlways: inserter._forced_always });
        const height = INSERTER_NODE_HEIGHT + (rule.quiet ? 0 : INSERTER_CHIP_HEIGHT);
        if (!in_loop) {
            g.setNode(inserterNodeId, { width: INSERTER_NODE_WIDTH, height });
        }
        drawn.set(inserterNodeId, { w: INSERTER_NODE_WIDTH, h: height });
        const label = entityLabel('inserter', inserter.id);
        const items = listText(filterIcons);
        const route = `from ${entityLabel(inserter.source.type, inserter.source.id)} to ${entityLabel(inserter.sink.type, inserter.sink.id)}`;
        nodes.push({
            id: inserterNodeId,
            type: 'inserterNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(label, `${items ? `takes ${items} ` : ''}${route}${rule.quiet ? '' : `, Enable: ${rule.summary}`}`),
            data: {
                inserterId: inserter.id,
                stackSize: inserter.stack_size,
                filterIcons,
                ...(!rule.quiet && { enableChip: rule.chip, enableSummary: rule.summary }),
            } satisfies InserterNodeData,
        });

        if (in_loop) {
            // connected once its machines have a place
            return;
        }

        if (g.hasNode(sourceNodeId)) {
            g.setEdge(sourceNodeId, inserterNodeId);
            edges.push(arrowEdge(sourceNodeId, inserterNodeId));
        }

        if (g.hasNode(sinkNodeId)) {
            g.setEdge(inserterNodeId, sinkNodeId);
            edges.push(arrowEdge(inserterNodeId, sinkNodeId));
        }
    });

    // --- Drill nodes + edges ---
    (drills ?? []).forEach(drill => {
        const drillNodeId = flowNodeId('drill', drill.id);
        const targetNodeId = flowNodeId('machine', drill.target.id);
        g.setNode(drillNodeId, { width: DRILL_NODE_WIDTH, height: DRILL_NODE_HEIGHT });
        drawn.set(drillNodeId, { w: DRILL_NODE_WIDTH, h: DRILL_NODE_HEIGHT });
        nodes.push({
            id: drillNodeId,
            type: 'drillNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(entityLabel('drill', drill.id), drill.mined_item_name ? `mines ${drill.mined_item_name}` : 'no resource'),
            data: {
                drillId: drill.id,
                drillType: drill.type,
                minedItem: drill.mined_item_name,
            } satisfies DrillNodeData,
        });

        if (g.hasNode(targetNodeId)) {
            g.setEdge(drillNodeId, targetNodeId);
            edges.push(arrowEdge(drillNodeId, targetNodeId));
        }
    });

    // Run dagre layout
    dagre.layout(g);

    // Apply dagre-computed positions (dagre centers nodes, so offset by half size)
    const positionedNodes = nodes.filter(node => g.hasNode(node.id)).map(node => {
        const dagreNode = g.node(node.id);
        const { w, h } = drawn.get(node.id)!;
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
        const inserterNodeId = flowNodeId('inserter', inserter.id);
        const sourceNodeId = flowNodeId('machine', inserter.source.id);
        const sinkNodeId = flowNodeId('machine', inserter.sink.id);
        const node = nodes.find(it => it.id === inserterNodeId)!;
        const source = g.node(sourceNodeId);
        const sink = g.node(sinkNodeId);
        if (!source || !sink) {
            continue;
        }
        const down = source.y <= sink.y;
        // the ones that carry down on the left, under the handle they take from, the ones that carry up on the right
        const goesDown = (it: InserterFormData) => g.node(flowNodeId('machine', it.source.id)).y <= g.node(flowNodeId('machine', it.sink.id)).y;
        const in_pair = loop_inserters.filter(it => pairKey(it) === pairKey(inserter));
        const index = in_pair.filter(it => goesDown(it) === down).indexOf(inserter) + (down ? 0 : in_pair.filter(goesDown).length);
        const row_width = in_pair.length * INSERTER_NODE_WIDTH + (in_pair.length - 1) * 20;
        const center_x = (source.x + sink.x) / 2 - row_width / 2 + index * (INSERTER_NODE_WIDTH + 20) + INSERTER_NODE_WIDTH / 2;
        const center_y = (source.y + sink.y) / 2;
        positionedNodes.push({
            ...node,
            data: { ...node.data, vertical: down ? 'down' : 'up' },
            position: { x: center_x - INSERTER_NODE_WIDTH / 2, y: center_y - drawn.get(inserterNodeId)!.h / 2 },
        });
        edges.push(arrowEdge(sourceNodeId, inserterNodeId, { sourceHandle: down ? 'bottom-out' : 'top-out', targetHandle: 'in' }));
        edges.push(arrowEdge(inserterNodeId, sinkNodeId, { sourceHandle: 'out', targetHandle: down ? 'top-in' : 'bottom-in' }));
    }

    return { nodes: positionedNodes, edges };
}
