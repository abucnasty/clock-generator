import { useState, useMemo, useCallback, useEffect, useRef, memo, type FocusEvent, type KeyboardEvent } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    BackgroundVariant,
    Panel,
    useReactFlow,
    useStore,
    type EdgeMarker,
    type NodeTypes,
    type NodeMouseHandler,
    type Connection,
    type Edge,
    type EdgeChange,
} from '@xyflow/react';
import { Box, Button, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import { Add, Fullscreen, InfoOutlined } from '@mui/icons-material';
import { useGameNames } from '../hooks/useGameNames';
import type { MachineFormData, BeltFormData, ChestFormData, InserterFormData, DrillFormData } from '../hooks/useConfigForm';
import { buildFlowGraph, flowNodeEntity } from '../utils/buildFlowGraph';
import { EntityFlowNode } from './EntityFlowNode';
import { InserterFlowNode } from './InserterFlowNode';
import { DrillFlowNode } from './DrillFlowNode';
import type { FlowNodeEntity } from '../utils/buildFlowGraph';
import { EntityEditDialog } from './EntityEditDialog';
import type { EntityEditDialogProps } from './EntityEditDialog';
import { FLOW_NODE_BOX_CLASS } from './flowNodeStyle';

const nodeTypes: NodeTypes = {
    entityNode: EntityFlowNode,
    inserterNode: InserterFlowNode,
    drillNode: DrillFlowNode,
};

/** The edges of a hovered node, and their arrowheads */
const HIGHLIGHT_COLOR = '#fca300';
const DIMMED_COLOR = '#555';

/** The canvas's size as one value, so the diagram re-renders only when it changes */
const canvasSizeSelector = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

/** The drawn size of all the nodes as one value: it changes when the machine facts are shown, hidden or loaded */
const nodeSizesSelector = (s: { nodeLookup: Map<string, { measured: { width?: number; height?: number } }> }) => {
    let total = 0;
    for (const node of s.nodeLookup.values()) total += (node.measured.width ?? 0) + (node.measured.height ?? 0);
    return total;
};

/** A small margin, so the fitted graph is drawn as large as it can be */
const FIT_VIEW_OPTIONS = { padding: 0.1 };
/**
 * Low enough that the whole of any build fits the canvas, the half-width one included (React Flow's default, 0.5, left
 * half of a large build outside it). The text of a big build is then small on screen; zoom in to read it.
 */
const MIN_ZOOM = 0.1;
/** How long after the diagram opens or the facts are toggled a change in the nodes' sizes still refits the view */
const REFIT_WINDOW_MS = 2000;

/** Twice in the diagram, once on each side: the other half of a belt or chest drawn as two nodes */
function twinNodeId(id: string | null): string | null {
    const half = id ? /^(.*)-(in|out)$/.exec(id) : null;
    return half && !half[1].startsWith('inserter') ? `${half[1]}-${half[2] === 'in' ? 'out' : 'in'}` : null;
}

/** What screen readers say after a node's or an edge's name (React Flow's own words mention delete and dragging, both off) */
const ARIA_LABEL_CONFIG = {
    'node.a11yDescription.default': 'Press Enter to edit it.',
    'node.a11yDescription.keyboardDisabled': 'Press Enter to edit it.',
    'edge.a11yDescription.default': 'A link from an entity to an inserter or from an inserter to an entity. Press Enter or Space to select it.',
};

/** The class React Flow gets for the twin of the hovered or focused half */
const TWIN_CLASS = 'flow-node-twin';

const ENTITY_TYPES = new Set<FlowNodeEntity['type']>(['machine', 'belt', 'chest']);

function isInserterEntityConnection(src: FlowNodeEntity | null, tgt: FlowNodeEntity | null): boolean {
    if (!src || !tgt) return false;
    return (
        (src.type === 'inserter' && ENTITY_TYPES.has(tgt.type)) ||
        (ENTITY_TYPES.has(src.type) && tgt.type === 'inserter')
    );
}

function isValidFlowConnection(src: FlowNodeEntity | null, tgt: FlowNodeEntity | null): boolean {
    if (!src || !tgt) return false;
    if (isInserterEntityConnection(src, tgt)) return true;
    // entity → entity: will auto-create an inserter, but not from an entity to itself (one half of a belt to the other)
    return ENTITY_TYPES.has(src.type) && ENTITY_TYPES.has(tgt.type) && !(src.type === tgt.type && src.id === tgt.id);
}

export type EntityClickType = 'machine' | 'belt' | 'chest' | 'inserter' | 'drill';

// Editing props derived from the dialog — diagram manages open/close/entityType/entityId internally
type ConfigFlowDiagramProps = Omit<EntityEditDialogProps, 'open' | 'onClose' | 'entityType' | 'entityId'> & {
    onAddMachine?: () => void;
    onAddInserter?: () => void;
    onAddBelt?: () => void;
    onAddChest?: () => void;
    onAddDrill?: () => void;
    onRequestFullscreen?: () => void;
    height?: number | string;
};

interface FlowContentProps {
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    drills: DrillFormData[];
    getRecipeInfo?: (name: string) => import('../hooks/useSimulationWorker').RecipeInfo | null;
    onNodeSelect: (type: EntityClickType, id: number) => void;
    onUpdateInserter?: (index: number, updates: Partial<InserterFormData>) => void;
    onAddMachine?: () => void;
    onAddInserter?: () => void;
    onAddBelt?: () => void;
    onAddChest?: () => void;
    onAddDrill?: () => void;
    onRequestFullscreen?: () => void;
}

function FlowContent({
    machines,
    inserters,
    belts,
    chests,
    drills,
    getRecipeInfo,
    onNodeSelect,
    onUpdateInserter,
    onAddMachine,
    onAddInserter,
    onAddBelt,
    onAddChest,
    onAddDrill,
    onRequestFullscreen,
}: FlowContentProps) {
    const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
    const [detailedMode, setDetailedMode] = useState(true);
    const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const { fitView } = useReactFlow();
    const fitViewOptions = FIT_VIEW_OPTIONS;

    // Fit the graph again when the canvas changes size (the fullscreen dialog opening, a window resize), since the first
    // fit can run before the canvas has its final size. Never on an edit, which would move the map while you work on it.
    const canvasSize = useStore(canvasSizeSelector);
    const fittedSize = useRef<string | null>(null);
    useEffect(() => {
        const previous = fittedSize.current;
        fittedSize.current = canvasSize;
        if (previous !== null && previous !== canvasSize && !canvasSize.startsWith('0x') && !canvasSize.endsWith('x0')) {
            void fitView(fitViewOptions);
        }
    }, [canvasSize, fitView, fitViewOptions]);

    // Fit again when the nodes change size soon after the diagram opens (the machine facts load after the first fit) or
    // after the facts are shown or hidden; an edit later on leaves the view where it is.
    const nodeSizes = useStore(nodeSizesSelector);
    const refitUntil = useRef(0);
    const toggleDetailedMode = () => {
        refitUntil.current = Date.now() + REFIT_WINDOW_MS;
        setDetailedMode(d => !d);
    };
    // declared before the effect below, so it has run when that one first does
    useEffect(() => {
        refitUntil.current = Date.now() + REFIT_WINDOW_MS;
    }, []);
    useEffect(() => {
        if (nodeSizes > 0 && Date.now() < refitUntil.current) {
            void fitView(fitViewOptions);
        }
    }, [nodeSizes, fitView, fitViewOptions]);

    const { itemLabel, recipeLabel } = useGameNames();
    const { nodes: graphNodes, edges } = useMemo(
        () => buildFlowGraph(machines, inserters, belts, chests, drills, getRecipeInfo, detailedMode, { itemLabel, recipeLabel }),
        [machines, inserters, belts, chests, drills, getRecipeInfo, detailedMode, itemLabel, recipeLabel],
    );
    // hovering or focusing one half of a belt drawn twice outlines the other half
    const twinId = twinNodeId(hoveredNodeId) ?? twinNodeId(focusedNodeId);
    const nodes = useMemo(
        () => (twinId ? graphNodes.map(node => (node.id === twinId ? { ...node, className: TWIN_CLASS } : node)) : graphNodes),
        [graphNodes, twinId],
    );
    // the entity behind each node, by node id, for the ends of a connection or an edge
    const nodeEntities = useMemo(() => new Map(nodes.map(node => [node.id, flowNodeEntity(node)])), [nodes]);
    const entityOf = useCallback((id: string | null | undefined) => (id ? nodeEntities.get(id) : undefined) ?? null, [nodeEntities]);

    const edgesWithSelection = useMemo(() => {
        const anyHovered = hoveredNodeId !== null;
        if (!anyHovered && selectedEdgeIds.size === 0) return edges;

        // Compute highlighted set: direct edges + one hop through connected inserters
        let highlightedEdgeIds: Set<string> | null = null;
        if (anyHovered) {
            const connectedInserterIds = new Set<string>();
            highlightedEdgeIds = new Set<string>();
            for (const edge of edges) {
                if (edge.source === hoveredNodeId || edge.target === hoveredNodeId) {
                    highlightedEdgeIds.add(edge.id);
                    if (entityOf(edge.source)?.type === 'inserter') connectedInserterIds.add(edge.source);
                    if (entityOf(edge.target)?.type === 'inserter') connectedInserterIds.add(edge.target);
                }
            }
            for (const edge of edges) {
                if (connectedInserterIds.has(edge.source) || connectedInserterIds.has(edge.target)) {
                    highlightedEdgeIds.add(edge.id);
                }
            }
        }

        // the arrowhead takes its edge's colour, or it stays the default grey on an orange edge
        const marker = (e: Edge, color: string) => ({ ...(e.markerEnd as EdgeMarker), color });
        return edges.map(e => {
            const isConnected = highlightedEdgeIds?.has(e.id) ?? false;
            const isSelected = selectedEdgeIds.has(e.id);
            if (anyHovered) {
                return isConnected
                    ? { ...e, selected: isSelected, markerEnd: marker(e, HIGHLIGHT_COLOR), style: { stroke: HIGHLIGHT_COLOR, strokeWidth: 2.5 } }
                    : { ...e, selected: isSelected, markerEnd: marker(e, DIMMED_COLOR), style: { stroke: DIMMED_COLOR, strokeWidth: 1, opacity: 0.2 } };
            }
            return isSelected ? { ...e, selected: true } : e;
        });
    }, [edges, selectedEdgeIds, hoveredNodeId, entityOf]);

    const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
        setSelectedEdgeIds(prev => {
            const next = new Set(prev);
            let changed = false;
            for (const change of changes) {
                if (change.type === 'select') {
                    if (change.selected) { next.add(change.id); changed = true; }
                    else if (next.delete(change.id)) { changed = true; }
                }
            }
            return changed ? next : prev;
        });
    }, []);

    const applyInserterConnection = useCallback((source: string | null, target: string | null) => {
        const src = entityOf(source);
        const tgt = entityOf(target);
        if (!src || !tgt) return;
        if (tgt.type === 'inserter' && ENTITY_TYPES.has(src.type)) {
            if (!onUpdateInserter) return;
            const idx = inserters.findIndex(i => i.id === tgt.id);
            if (idx !== -1) onUpdateInserter(idx, { source: { type: src.type as 'machine' | 'belt' | 'chest', id: src.id } });
        } else if (src.type === 'inserter' && ENTITY_TYPES.has(tgt.type)) {
            if (!onUpdateInserter) return;
            const idx = inserters.findIndex(i => i.id === src.id);
            if (idx !== -1) onUpdateInserter(idx, { sink: { type: tgt.type as 'machine' | 'belt' | 'chest', id: tgt.id } });
        } else if (ENTITY_TYPES.has(src.type) && ENTITY_TYPES.has(tgt.type)) {
            if (!onAddInserter || !onUpdateInserter) return;
            const newIndex = inserters.length;
            onAddInserter();
            onUpdateInserter(newIndex, {
                source: { type: src.type as 'machine' | 'belt' | 'chest', id: src.id },
                sink: { type: tgt.type as 'machine' | 'belt' | 'chest', id: tgt.id },
            });
        }
    }, [inserters, onUpdateInserter, onAddInserter, entityOf]);

    const handleConnect = useCallback(
        (connection: Connection) => applyInserterConnection(connection.source, connection.target),
        [applyInserterConnection],
    );

    const handleReconnect = useCallback(
        (_oldEdge: Edge, newConnection: Connection) => applyInserterConnection(newConnection.source, newConnection.target),
        [applyInserterConnection],
    );

    const isValidConnection = useCallback(
        (connection: Connection | Edge) => isValidFlowConnection(entityOf(connection.source), entityOf(connection.target)),
        [entityOf],
    );

    const hasEntities = machines.length > 0 || belts.length > 0 || chests.length > 0 || drills.length > 0;

    const handleNodeClick: NodeMouseHandler = (_event, node) => {
        const entity = flowNodeEntity(node);
        onNodeSelect(entity.type, entity.id);
    };

    // Enter on a focused node opens it, as a click does (React Flow only selects it). Only on the node itself, so Enter
    // on a handle, a Controls button or the Add button keeps its own meaning. The dialog gives focus back to the node.
    const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
        const target = event.target;
        setFocusedNodeId(target instanceof HTMLElement && target.classList.contains('react-flow__node') ? target.dataset.id ?? null : null);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target;
        if (event.key !== 'Enter' || !(target instanceof HTMLElement) || !target.classList.contains('react-flow__node')) return;
        const node = nodes.find(it => it.id === target.dataset.id);
        if (!node) return;
        event.preventDefault();
        const entity = flowNodeEntity(node);
        onNodeSelect(entity.type, entity.id);
    };

    const hasAddCallbacks = onAddMachine || onAddInserter || onAddBelt || onAddChest || onAddDrill;

    if (!hasEntities) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'text.secondary',
                    position: 'relative',
                }}
            >
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    Configure machines, belts, or chests to see the flow diagram.
                </Typography>
                {hasAddCallbacks && (
                    <Box sx={{ position: 'absolute', bottom: 12, right: 12 }}>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Add />}
                            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
                            sx={{ borderRadius: 0 }}
                        >
                            Add Entity
                        </Button>
                    </Box>
                )}
            </Box>
        );
    }

    return (
        <ReactFlow
            nodes={nodes}
            edges={edgesWithSelection}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={() => setFocusedNodeId(null)}
            ariaLabelConfig={ARIA_LABEL_CONFIG}
            minZoom={MIN_ZOOM}
            onNodeMouseEnter={(_e, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onEdgesChange={handleEdgesChange}
            nodesDraggable={false}
            nodesConnectable={true}
            elementsSelectable={true}
            edgesReconnectable={true}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            // no key deletes anything: an edge stands for an inserter, which Backspace used to remove without a word
            deleteKeyCode={null}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={fitViewOptions}
            proOptions={{ hideAttribution: true }}
        >
            <Background color="#333" variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
            <Panel position="top-left">
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton
                        size="small"
                        onClick={toggleDetailedMode}
                        title={detailedMode ? 'Hide machine facts' : 'Show machine facts'}
                        sx={{
                            bgcolor: detailedMode ? '#fca30033' : '#232323',
                            border: `1px solid ${detailedMode ? '#fca300' : '#555'}`,
                            borderRadius: 0,
                            color: detailedMode ? '#fca300' : '#ccc',
                            '&:hover': { bgcolor: detailedMode ? '#fca30055' : '#2d2d2d', borderColor: '#888' },
                        }}
                    >
                        <InfoOutlined fontSize="small" />
                    </IconButton>
                    {onRequestFullscreen && (
                        <IconButton
                            size="small"
                            onClick={onRequestFullscreen}
                            aria-label="Fullscreen"
                            sx={{
                                bgcolor: '#232323',
                                border: '1px solid #555',
                                borderRadius: 0,
                                color: '#ccc',
                                '&:hover': { bgcolor: '#2d2d2d', borderColor: '#888' },
                            }}
                        >
                            <Fullscreen fontSize="small" />
                        </IconButton>
                    )}
                </Box>
            </Panel>
            {hasAddCallbacks && (
                <Panel position="top-right">
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Add />}
                        onClick={(e) => setAddMenuAnchor(e.currentTarget)}
                        sx={{
                            borderRadius: 0,
                            bgcolor: '#232323',
                            borderColor: '#555',
                            color: '#ccc',
                            '&:hover': { bgcolor: '#2d2d2d', borderColor: '#888' },
                        }}
                    >
                        Add Entity
                    </Button>
                </Panel>
            )}
            <Menu
                anchorEl={addMenuAnchor}
                open={Boolean(addMenuAnchor)}
                onClose={() => setAddMenuAnchor(null)}
            >
                {onAddMachine && (
                    <MenuItem onClick={() => { onAddMachine(); setAddMenuAnchor(null); }}>
                        Machine
                    </MenuItem>
                )}
                {onAddInserter && (
                    <MenuItem onClick={() => { onAddInserter(); setAddMenuAnchor(null); }}>
                        Inserter
                    </MenuItem>
                )}
                {onAddBelt && (
                    <MenuItem onClick={() => { onAddBelt(); setAddMenuAnchor(null); }}>
                        Belt
                    </MenuItem>
                )}
                {onAddChest && (
                    <MenuItem onClick={() => { onAddChest(); setAddMenuAnchor(null); }}>
                        Chest
                    </MenuItem>
                )}
                {onAddDrill && (
                    <MenuItem onClick={() => { onAddDrill(); setAddMenuAnchor(null); }}>
                        Mining Drill
                    </MenuItem>
                )}
            </Menu>
        </ReactFlow>
    );
}

function ConfigFlowDiagramComponent({
    onAddMachine,
    onAddInserter,
    onAddBelt,
    onAddChest,
    onAddDrill,
    onRequestFullscreen,
    height = 520,
    ...dialogProps
}: ConfigFlowDiagramProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedType, setSelectedType] = useState<EntityClickType | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const handleNodeSelect = (type: EntityClickType, id: number) => {
        setSelectedType(type);
        setSelectedId(id);
        setDialogOpen(true);
    };

    // a delete renumbers the kind, so while the dialog fades out its id would name the next entity
    const deselectOnDelete = (onDelete?: (index: number) => void) =>
        onDelete && ((index: number) => {
            setSelectedId(null);
            onDelete(index);
        });

    return (
        <>
            <Box
                sx={{
                    height,
                    bgcolor: '#1a1a1a',
                    borderRadius: 1,
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    '& .react-flow__controls': {
                        background: '#232323',
                        border: '1px solid #555',
                        borderRadius: 1,
                        overflow: 'hidden',
                    },
                    '& .react-flow__controls-button': {
                        background: '#232323',
                        borderBottom: '1px solid #555',
                        color: '#ccc',
                        '&:hover': { background: '#333' },
                        '& svg': { fill: '#ccc' },
                    },
                    '& .react-flow__controls-button:last-child': {
                        borderBottom: 'none',
                    },
                    // React Flow's CSS removes the focused node's outline; white is far above 3:1 on the canvas, and
                    // is not the orange that hover and selection use
                    [`& .react-flow__node:focus-visible > .${FLOW_NODE_BOX_CLASS}`]: {
                        outline: '2px solid #fff',
                        outlineOffset: 2,
                    },
                    // the other half of a belt or chest drawn twice, while one half is hovered or focused: dashed grey,
                    // unlike the focus ring and the orange of hover and selection (#b1b1b7 is 8.2:1 on the canvas)
                    [`& .react-flow__node.${TWIN_CLASS}:not(:focus-visible) > .${FLOW_NODE_BOX_CLASS}`]: {
                        outline: '2px dashed #b1b1b7',
                        outlineOffset: 2,
                    },
                }}
            >
                <ReactFlowProvider>
                    <FlowContent
                        machines={dialogProps.machines}
                        inserters={dialogProps.inserters}
                        belts={dialogProps.belts}
                        chests={dialogProps.chests}
                        drills={dialogProps.drills ?? []}
                        getRecipeInfo={dialogProps.getRecipeInfo}
                        onNodeSelect={handleNodeSelect}
                        onUpdateInserter={dialogProps.onUpdateInserter}
                        onAddMachine={onAddMachine}
                        onAddInserter={onAddInserter}
                        onAddBelt={onAddBelt}
                        onAddChest={onAddChest}
                        onAddDrill={onAddDrill}
                        onRequestFullscreen={onRequestFullscreen}
                    />
                </ReactFlowProvider>
            </Box>

            <EntityEditDialog
                {...dialogProps}
                onDeleteMachine={deselectOnDelete(dialogProps.onDeleteMachine)}
                onDeleteInserter={deselectOnDelete(dialogProps.onDeleteInserter)}
                onDeleteBelt={deselectOnDelete(dialogProps.onDeleteBelt)}
                onDeleteChest={deselectOnDelete(dialogProps.onDeleteChest)}
                onDeleteDrill={deselectOnDelete(dialogProps.onDeleteDrill)}
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                entityType={selectedType}
                entityId={selectedId}
            />
        </>
    );
}

export const ConfigFlowDiagram = memo(ConfigFlowDiagramComponent);
