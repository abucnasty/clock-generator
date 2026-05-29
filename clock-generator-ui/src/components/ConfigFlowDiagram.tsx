import { useState, useMemo } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    BackgroundVariant,
    Panel,
    type NodeTypes,
    type NodeMouseHandler,
} from '@xyflow/react';
import { Box, Button, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import { Add, Fullscreen } from '@mui/icons-material';
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
    onAddMachine,
    onAddInserter,
    onAddBelt,
    onAddChest,
    onAddDrill,
    onRequestFullscreen,
}: FlowContentProps) {
    const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

    const { nodes, edges } = useMemo(
        () => buildFlowGraph(machines, inserters, belts, chests, drills, getRecipeInfo),
        [machines, inserters, belts, chests, drills, getRecipeInfo],
    );

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
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
        >
            <Background color="#333" variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            {onRequestFullscreen && (
                <Panel position="top-left">
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
                </Panel>
            )}
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

export function ConfigFlowDiagram({
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
