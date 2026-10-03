import { useState, useMemo, useCallback, memo } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    BackgroundVariant,
    Panel,
    type NodeTypes,
    type NodeMouseHandler,
    type Connection,
    type Edge,
    type EdgeChange,
} from '@xyflow/react';
import { Box, Button, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import { Add, Fullscreen, InfoOutlined } from '@mui/icons-material';
import type { MachineFormData, BeltFormData, ChestFormData, InserterFormData, DrillFormData } from '../hooks/useConfigForm';
import { buildFlowGraph } from '../utils/buildFlowGraph';
import { EntityFlowNode } from './EntityFlowNode';
import { InserterFlowNode } from './InserterFlowNode';
import { DrillFlowNode } from './DrillFlowNode';
import type { EntityNodeData, InserterNodeData, DrillNodeData } from '../utils/buildFlowGraph';
import { EntityEditDialog } from './EntityEditDialog';
import type { EntityEditDialogProps } from './EntityEditDialog';

const nodeTypes: NodeTypes = {
    entityNode: EntityFlowNode,
    inserterNode: InserterFlowNode,
    drillNode: DrillFlowNode,
};

function parseFlowNodeId(id: string | null | undefined): { type: string; numId: number } | null {
    if (!id) return null;
    const match = id.match(/^(machine|belt|chest|inserter)-(\d+)$/);
    if (!match) return null;
    return { type: match[1], numId: parseInt(match[2]) };
}

const ENTITY_TYPES = new Set(['machine', 'belt', 'chest']);

function isInserterEntityConnection(source: string | null, target: string | null): boolean {
    const src = parseFlowNodeId(source);
    const tgt = parseFlowNodeId(target);
    if (!src || !tgt) return false;
    return (
        (src.type === 'inserter' && ENTITY_TYPES.has(tgt.type)) ||
        (ENTITY_TYPES.has(src.type) && tgt.type === 'inserter')
    );
}

function isValidFlowConnection(source: string | null, target: string | null): boolean {
    const src = parseFlowNodeId(source);
    const tgt = parseFlowNodeId(target);
    if (!src || !tgt) return false;
    if (isInserterEntityConnection(source, target)) return true;
    // entity → entity: will auto-create an inserter
    return ENTITY_TYPES.has(src.type) && ENTITY_TYPES.has(tgt.type);
}

export type EntityClickType = 'machine' | 'belt' | 'chest' | 'inserter' | 'drill';

// Editing props derived from the dialog — diagram manages open/close/entityType/entityId internally
export type ConfigFlowDiagramProps = Omit<EntityEditDialogProps, 'open' | 'onClose' | 'entityType' | 'entityId'> & {
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
    onDeleteInserter?: (index: number) => void;
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
    onDeleteInserter,
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

    const { nodes, edges } = useMemo(
        () => buildFlowGraph(machines, inserters, belts, chests, drills, getRecipeInfo, detailedMode),
        [machines, inserters, belts, chests, drills, getRecipeInfo, detailedMode],
    );

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
                    if (edge.source.startsWith('inserter-')) connectedInserterIds.add(edge.source);
                    if (edge.target.startsWith('inserter-')) connectedInserterIds.add(edge.target);
                }
            }
            for (const edge of edges) {
                if (connectedInserterIds.has(edge.source) || connectedInserterIds.has(edge.target)) {
                    highlightedEdgeIds.add(edge.id);
                }
            }
        }

        return edges.map(e => {
            const isConnected = highlightedEdgeIds?.has(e.id) ?? false;
            const isSelected = selectedEdgeIds.has(e.id);
            if (anyHovered) {
                return isConnected
                    ? { ...e, selected: isSelected, style: { stroke: '#fca300', strokeWidth: 2.5 } }
                    : { ...e, selected: isSelected, style: { stroke: '#555', strokeWidth: 1, opacity: 0.2 } };
            }
            return isSelected ? { ...e, selected: true } : e;
        });
    }, [edges, selectedEdgeIds, hoveredNodeId]);

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
        const src = parseFlowNodeId(source);
        const tgt = parseFlowNodeId(target);
        if (!src || !tgt) return;
        if (tgt.type === 'inserter' && ENTITY_TYPES.has(src.type)) {
            if (!onUpdateInserter) return;
            const idx = inserters.findIndex(i => i.id === tgt.numId);
            if (idx !== -1) onUpdateInserter(idx, { source: { type: src.type as 'machine' | 'belt' | 'chest', id: src.numId } });
        } else if (src.type === 'inserter' && ENTITY_TYPES.has(tgt.type)) {
            if (!onUpdateInserter) return;
            const idx = inserters.findIndex(i => i.id === src.numId);
            if (idx !== -1) onUpdateInserter(idx, { sink: { type: tgt.type as 'machine' | 'belt' | 'chest', id: tgt.numId } });
        } else if (ENTITY_TYPES.has(src.type) && ENTITY_TYPES.has(tgt.type)) {
            if (!onAddInserter || !onUpdateInserter) return;
            const newIndex = inserters.length;
            onAddInserter();
            onUpdateInserter(newIndex, {
                source: { type: src.type as 'machine' | 'belt' | 'chest', id: src.numId },
                sink: { type: tgt.type as 'machine' | 'belt' | 'chest', id: tgt.numId },
            });
        }
    }, [inserters, onUpdateInserter, onAddInserter]);

    const handleConnect = useCallback(
        (connection: Connection) => applyInserterConnection(connection.source, connection.target),
        [applyInserterConnection],
    );

    const handleReconnect = useCallback(
        (_oldEdge: Edge, newConnection: Connection) => applyInserterConnection(newConnection.source, newConnection.target),
        [applyInserterConnection],
    );

    const isValidConnection = useCallback(
        (connection: Connection | Edge) => isValidFlowConnection(connection.source, connection.target),
        [],
    );

    const handleEdgesDelete = useCallback((deletedEdges: Edge[]) => {
        if (!onDeleteInserter) return;
        const inserterIds = new Set<number>();
        for (const edge of deletedEdges) {
            const src = parseFlowNodeId(edge.source);
            const tgt = parseFlowNodeId(edge.target);
            if (src?.type === 'inserter') inserterIds.add(src.numId);
            if (tgt?.type === 'inserter') inserterIds.add(tgt.numId);
        }
        // Delete highest indices first so earlier indices stay valid
        const indices = [...inserterIds]
            .map(id => inserters.findIndex(i => i.id === id))
            .filter(idx => idx !== -1)
            .sort((a, b) => b - a);
        for (const idx of indices) {
            onDeleteInserter(idx);
        }
    }, [inserters, onDeleteInserter]);

    const hasEntities = machines.length > 0 || belts.length > 0 || chests.length > 0 || drills.length > 0;

    const handleNodeClick: NodeMouseHandler = (_event, node) => {
        const data = node.data as EntityNodeData | InserterNodeData | DrillNodeData;
        if ('entityType' in data) {
            onNodeSelect(data.entityType, data.entityId);
        } else if ('drillId' in data) {
            onNodeSelect('drill', data.drillId);
        } else {
            onNodeSelect('inserter', (data as InserterNodeData).inserterId);
        }
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
            onNodeMouseEnter={(_e, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onEdgesChange={handleEdgesChange}
            nodesDraggable={false}
            nodesConnectable={true}
            elementsSelectable={true}
            edgesReconnectable={true}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            onEdgesDelete={handleEdgesDelete}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
        >
            <Background color="#333" variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <Panel position="top-left">
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton
                        size="small"
                        onClick={() => setDetailedMode(d => !d)}
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
                        onDeleteInserter={dialogProps.onDeleteInserter}
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
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                entityType={selectedType}
                entityId={selectedId}
            />
        </>
    );
}

export const ConfigFlowDiagram = memo(ConfigFlowDiagramComponent);
