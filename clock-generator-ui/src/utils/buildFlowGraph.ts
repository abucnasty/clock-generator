import { effectiveInserterStackSize } from './inserterMetadata';
import dagre from '@dagrejs/dagre';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import type { MachineFormData, BeltFormData, ChestFormData, InserterFormData, DrillFormData } from '../hooks/useConfigForm';
import { containerItems, isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { describeEnableRule } from './enableRuleLabel';
import { entityLabel } from './entityLabel';
import { inferInserterItems } from './inferInserterItems';
import { assignFlowPorts } from './flowRouting';

// The sizes the nodes are drawn at (the components use the widths) and the layout places them by: the layout's must be
// at least what is drawn, or nodes overlap. Heights measured in the browser with 12px text (item 2.11): a belt, chest or
// machine 50, a machine with its facts 112 to 128 (two inputs; each more adds about 17), an inserter 64, 90 with a
// one-line chip.
export const ENTITY_NODE_WIDTH = 200;
const ENTITY_NODE_HEIGHT = 56;
/** Room for the facts of a recipe with up to five inputs */
const ENTITY_NODE_DETAIL_HEIGHT = 196;
/** An inserter without an enable chip; one with a chip is wider, so that a 32-character chip takes at most two lines */
export const INSERTER_NODE_WIDTH = 140;
export const INSERTER_NODE_CHIP_WIDTH = 180;
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
    prototype?: string;
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
    /** For a half, the title of its label: why the entity is drawn twice */
    halfTitle?: string;
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
/** What each half is, for its screen-reader name and its label's title */
const HALF_ROLE: Record<'in' | 'out', string> = { in: 'the side inserters take from', out: 'the side inserters put items onto' };
const HALF_TITLE = (label: string, half: 'in' | 'out') =>
    `${label} is drawn twice: inserters ${half === 'in' ? 'take from this side' : 'put items onto this side'}`;

/**
 * "Belt 1 (in), the side inserters take from, carries iron-plate": what a screen reader says for a node. The "Press Enter
 * to edit it" that follows is the diagram's node description, said once for every node.
 */
function nodeAriaLabel(...parts: (string | undefined)[]): string {
    return parts.filter(Boolean).join(', ');
}

function listText(items: string[] | undefined, label: (id: string) => string): string | undefined {
    return items && items.length > 0 ? items.map(label).join(' and ') : undefined;
}

/** The game names the screen-reader labels say; the ids when no names are known */
interface FlowLabels {
    itemLabel: (id: string) => string;
    recipeLabel: (id: string) => string;
}

const ID_LABELS: FlowLabels = { itemLabel: (id) => id, recipeLabel: (id) => id };

export function buildFlowGraph(
    machines: MachineFormData[],
    inserters: InserterFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    drills?: DrillFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
    detailMode?: boolean,
    { itemLabel, recipeLabel }: FlowLabels = ID_LABELS,
    nodeHeight = 0,
): { nodes: Node[], edges: Edge[] } {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    // Leave a corridor between columns for separate routes and replay quantities.
    const layoutOptions = { rankdir: 'LR', nodesep: 40, ranksep: 112, ranker: 'longest-path' };

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
        const base_label = data.label;
        const id = flowNodeId(data.entityType, data.entityId);
        const halves: ('in' | 'out' | undefined)[] = split_ids.has(id) ? ['in', 'out'] : [undefined];
        for (const half of halves) {
            const node_id = flowNodeId(data.entityType, data.entityId, half);
            const label = half ? `${data.label}${HALF_SUFFIX[half]}` : data.label;
            g.setNode(node_id, { width: ENTITY_NODE_WIDTH, height: Math.max(nodeHeight, data.sublabel ? 76 : ENTITY_NODE_HEIGHT) });
            drawn.set(node_id, { w: ENTITY_NODE_WIDTH, h: Math.max(nodeHeight, data.sublabel ? 76 : ENTITY_NODE_HEIGHT) });
            nodes.push({
                id: node_id,
                type: 'entityNode',
                position: { x: 0, y: 0 },
                ariaLabel: nodeAriaLabel(label, half && HALF_ROLE[half], contents),
                data: { ...data, label, ...(half && { half, halfTitle: HALF_TITLE(base_label, half) }) } satisfies EntityNodeData,
            });
        }
    };

    // --- Entity nodes ---
    machines.forEach(machine => {
        const id = flowNodeId('machine', machine.id);
        const machineHeight = Math.max(nodeHeight, detailMode ? ENTITY_NODE_DETAIL_HEIGHT : ENTITY_NODE_HEIGHT);
        const in_loop = loop_machine_ids.has(machine.id);
        g.setNode(id, { width: ENTITY_NODE_WIDTH, height: machineHeight });
        drawn.set(id, { w: ENTITY_NODE_WIDTH, h: machineHeight });
        const label = entityLabel('machine', machine.id);
        nodes.push({
            id,
            type: 'entityNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(label, machine.recipe ? `makes ${recipeLabel(machine.recipe)}` : 'no recipe'),
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
                    prototype: machine.prototype,
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
        }, filterIcons.length > 0 ? `carries ${listText(filterIcons, itemLabel)}` : undefined);
    });

    chests.forEach(chest => {
        let iconName: string;
        let filterIcons: string[] | undefined;
        if (isBufferChest(chest)) {
            iconName = 'steel-chest';
            filterIcons = chest.item_filter ? [chest.item_filter] : undefined;
        } else if (isInfinityChest(chest)) {
            iconName = 'infinity-chest';
            const items = chest.item_filter.map(f => f.item_name).filter(Boolean);
            filterIcons = items.length > 0 ? items : undefined;
        } else {
            iconName = chest.type;
            const items = containerItems(chest);
            filterIcons = items.length > 0 ? items : undefined;
        }
        pushEntityNode({
            entityType: 'chest',
            entityId: chest.id,
            label: entityLabel('chest', chest.id),
            iconName,
            filterIcons,
            ...(isInfinityChest(chest) && chest.remove_unfiltered_items && { sublabel: filterIcons?.length ? 'Removes unfiltered items' : 'Removes all incoming items' }),
        }, isInfinityChest(chest) && chest.remove_unfiltered_items ? 'removes unfiltered incoming items' : filterIcons ? `holds ${listText(filterIcons, itemLabel)}` : undefined);
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
            : inferInserterItems(inserter, machines, belts, chests, getRecipeInfo, inserters);
        const filterIcons = inferred.length > 0 ? inferred.slice(0, 3) : undefined;
        const rule = describeEnableRule(inserter.overrides?.enable_control, { forcedAlways: inserter._forced_always });
        const height = Math.max(nodeHeight, INSERTER_NODE_HEIGHT + (rule.quiet ? 0 : INSERTER_CHIP_HEIGHT));
        const width = rule.quiet ? INSERTER_NODE_WIDTH : INSERTER_NODE_CHIP_WIDTH;
        if (!in_loop) {
            g.setNode(inserterNodeId, { width, height });
        }
        drawn.set(inserterNodeId, { w: width, h: height });
        const label = entityLabel('inserter', inserter.id);
        const items = listText(filterIcons, itemLabel);
        const route = `from ${entityLabel(inserter.source.type, inserter.source.id)} to ${entityLabel(inserter.sink.type, inserter.sink.id)}`;
        nodes.push({
            id: inserterNodeId,
            type: 'inserterNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(label, `${items ? `takes ${items} ` : ''}${route}`, rule.quiet ? undefined : `Enable: ${rule.summary}`),
            data: {
                inserterId: inserter.id,
                stackSize: effectiveInserterStackSize(inserter),
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
        // into a machine, or into a chest (the half it is given to, when the chest is on a loop)
        const targetNodeId = endNodeId(drill.target, 'out');
        g.setNode(drillNodeId, { width: DRILL_NODE_WIDTH, height: Math.max(nodeHeight, DRILL_NODE_HEIGHT) });
        drawn.set(drillNodeId, { w: DRILL_NODE_WIDTH, h: Math.max(nodeHeight, DRILL_NODE_HEIGHT) });
        nodes.push({
            id: drillNodeId,
            type: 'drillNode',
            position: { x: 0, y: 0 },
            ariaLabel: nodeAriaLabel(entityLabel('drill', drill.id), drill.mined_item_name ? `mines ${itemLabel(drill.mined_item_name)}` : 'no resource'),
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

    // Reserve each machine loop as a single block before the outer layout. Placing its inserters
    // afterwards used to put them on unrelated belts, machines, or other loop rows.
    const groups: Set<number>[] = [];
    for (const inserter of loop_inserters) {
        if (!g.hasNode(flowNodeId('machine', inserter.source.id)) || !g.hasNode(flowNodeId('machine', inserter.sink.id))) continue;
        const touching = groups.filter(group => group.has(inserter.source.id) || group.has(inserter.sink.id));
        const merged = new Set([inserter.source.id, inserter.sink.id, ...touching.flatMap(group => [...group])]);
        touching.forEach(group => groups.splice(groups.indexOf(group), 1));
        groups.push(merged);
    }
    const layout = new dagre.graphlib.Graph();
    layout.setDefaultEdgeLabel(() => ({}));
    layout.setGraph(layoutOptions);
    const blockOf = new Map<string, string>();
    const local = new Map<string, { x: number; y: number }>();
    const vertical = new Map<string, 'up' | 'down'>();
    for (const group of groups) {
        const ids = [...group].sort((a, b) => a - b);
        const block = `loop-${ids.join('-')}`;
        const rows = ids.map((_, index) => loop_inserters.filter(inserter =>
            group.has(inserter.source.id) && group.has(inserter.sink.id) &&
            Math.min(ids.indexOf(inserter.source.id), ids.indexOf(inserter.sink.id)) === index)
            .sort((a, b) => Number(ids.indexOf(a.source.id) > ids.indexOf(a.sink.id)) - Number(ids.indexOf(b.source.id) > ids.indexOf(b.sink.id)) || a.id - b.id));
        const rowWidth = (row: InserterFormData[]) => row.reduce((sum, it) => sum + drawn.get(flowNodeId('inserter', it.id))!.w, 0) + Math.max(0, row.length - 1) * 24;
        const width = Math.max(ENTITY_NODE_WIDTH, ...rows.map(rowWidth)) + 48;
        let y = 24;
        ids.forEach((id, index) => {
            const machineId = flowNodeId('machine', id);
            blockOf.set(machineId, block);
            const size = drawn.get(machineId)!;
            local.set(machineId, { x: (width - size.w) / 2, y });
            y += size.h;
            const row = rows[index];
            if (row.length) {
                y += LOOP_GAP / 2;
                let x = (width - rowWidth(row)) / 2;
                for (const inserter of row) {
                    const nodeId = flowNodeId('inserter', inserter.id);
                    const size = drawn.get(nodeId)!;
                    blockOf.set(nodeId, block);
                    local.set(nodeId, { x, y });
                    vertical.set(nodeId, ids.indexOf(inserter.source.id) <= ids.indexOf(inserter.sink.id) ? 'down' : 'up');
                    x += size.w + 24;
                }
                y += Math.max(...row.map(it => drawn.get(flowNodeId('inserter', it.id))!.h)) + LOOP_GAP / 2;
            } else if (index < ids.length - 1) y += LOOP_GAP;
        });
        layout.setNode(block, { width, height: y + 24 });
    }
    for (const id of g.nodes()) if (!blockOf.has(id)) layout.setNode(id, g.node(id));
    for (const edge of g.edges()) {
        const source = blockOf.get(edge.v) ?? edge.v, target = blockOf.get(edge.w) ?? edge.w;
        if (source !== target) layout.setEdge(source, target);
    }
    dagre.layout(layout);
    const positionedNodes = nodes.flatMap(node => {
        const block = blockOf.get(node.id);
        const position = layout.node(block ?? node.id);
        if (!position) return [];
        const size = drawn.get(node.id)!;
        const offset = block ? local.get(node.id)! : { x: 0, y: 0 };
        return [{ ...node, initialWidth: size.w, initialHeight: size.h,
            ...(vertical.has(node.id) && { data: { ...node.data, vertical: vertical.get(node.id) } }),
            position: { x: position.x - (block ? position.width : size.w) / 2 + offset.x,
                y: position.y - (block ? position.height : size.h) / 2 + offset.y } }];
    });
    for (const inserter of loop_inserters) {
        const nodeId = flowNodeId('inserter', inserter.id);
        if (!vertical.has(nodeId)) continue;
        const down = vertical.get(nodeId) === 'down';
        edges.push(arrowEdge(flowNodeId('machine', inserter.source.id), nodeId, { sourceHandle: down ? 'bottom-out' : 'top-out', targetHandle: 'in' }));
        edges.push(arrowEdge(nodeId, flowNodeId('machine', inserter.sink.id), { sourceHandle: 'out', targetHandle: down ? 'top-in' : 'bottom-in' }));
    }

    // Tab goes through the nodes in the order they are drawn: the flow, left to right, then top to bottom
    positionedNodes.sort((a, b) => Math.round(a.position.x) - Math.round(b.position.x) || a.position.y - b.position.y);

    return assignFlowPorts(positionedNodes, edges);
}
