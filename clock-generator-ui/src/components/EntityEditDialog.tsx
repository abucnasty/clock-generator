import { Close, DeleteOutline } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGameNames } from '../hooks/useGameNames';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { ChestType } from 'clock-generator/light';
import type {
    BeltFormData,
    BeltLaneFormData,
    BeltStrategyFormValue,
    BufferChestFormData,
    ChestFormData,
    DrillFormData,
    InserterFormData,
    MachineFormData,
} from '../hooks/useConfigForm';
import {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_STRATEGIES,
    LANE_CONSUMPTION_TOOLTIP,
    beltStrategyUpdate,
    isBufferChest,
    isInfinityChest,
} from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { entityLabel } from '../utils/entityLabel';
import { SELECT_NAMES } from '../utils/a11yLabels';
import type { EntityClickType } from './ConfigFlowDiagram';
import { ChestFilterSlotSelector, type ChestFilterSlot } from './ChestFilterSlotSelector';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { DraftFooter } from './DraftFooter';
import { switchedChest } from '../utils/configForm/edits';
import { changedFields, MACHINE_FIELDS, BELT_FIELDS, CHEST_FIELDS, DRILL_FIELDS } from '../utils/inserterDraft';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { InserterConfigPanel } from './InserterConfigPanel';
import { MachineFactsAccordion } from './MachineFactsAccordion';
import { BELT_TYPES, DRILL_TYPES, MACHINE_TYPE_LABELS, entityTypeLabel } from './entityTypes';

// ---- Props ----

export interface EntityEditDialogProps {
    open: boolean;
    onClose: () => void;
    entityType: EntityClickType | null;
    entityId: number | null;
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    drills?: DrillFormData[];
    recipeNames: string[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    onUpdateMachine: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onUpdateInserter: (index: number, updates: Partial<InserterFormData>) => void;
    onUpdateBelt: (index: number, updates: Partial<BeltFormData>) => void;
    onUpdateChest: (index: number, updates: Partial<ChestFormData>) => void;
    onSwitchChestType: (index: number, newType: typeof ChestType[keyof typeof ChestType]) => void;
    onUpdateDrill?: (index: number, updates: Partial<DrillFormData>) => void;
    onDeleteMachine?: (index: number) => void;
    onDeleteInserter?: (index: number) => void;
    onDeleteBelt?: (index: number) => void;
    onDeleteChest?: (index: number) => void;
    onDeleteDrill?: (index: number) => void;
}

// ---- Machine section ----

function MachineEditSection({
    machine,
    entityIndex,
    recipeNames,
    onUpdate,
}: {
    machine: MachineFormData;
    entityIndex: number;
    recipeNames: string[];
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
}) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ItemSelector
                kind="recipe"
                options={recipeNames}
                value={machine.recipe || null}
                onChange={(newValue) => onUpdate(entityIndex, 'recipe', newValue || '')}
                label="Recipe"
                placeholder="Search recipes..."
                freeSolo
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <NumberField
                    label="Productivity (%)"
                    value={machine.productivity}
                    onValueChange={(val) => onUpdate(entityIndex, 'productivity', val ?? 0)}
                    min={0}
                    step={1}
                    defaultValue={0}
                    sx={{ flex: 1 }}
                    size="small"
                />
                <NumberField
                    label="Crafting Speed"
                    value={machine.crafting_speed}
                    onValueChange={(val) => onUpdate(entityIndex, 'crafting_speed', val ?? 1)}
                    min={0.01}
                    step={0.1}
                    defaultValue={1}
                    sx={{ flex: 1 }}
                    size="small"
                />
                <FormControl size="small" sx={{ flex: 1, minWidth: { xs: '100%', sm: 200 } }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                        inputProps={{ 'aria-label': SELECT_NAMES.machineType }}
                        value={machine.type || 'machine'}
                        label="Type"
                        onChange={(e) => onUpdate(entityIndex, 'type', e.target.value as 'machine' | 'furnace' | 'biochamber')}
                    >
                        <MenuItem value="machine">{MACHINE_TYPE_LABELS.machine}</MenuItem>
                        <MenuItem value="furnace">{MACHINE_TYPE_LABELS.furnace}</MenuItem>
                        <MenuItem value="biochamber">{MACHINE_TYPE_LABELS.biochamber}</MenuItem>
                    </Select>
                </FormControl>
            </Box>
        </Box>
    );
}

// ---- Belt section ----

function BeltEditSection({
    belt,
    entityIndex,
    itemNames,
    onUpdate,
}: {
    belt: BeltFormData;
    entityIndex: number;
    itemNames: string[];
    onUpdate: (index: number, updates: Partial<BeltFormData>) => void;
}) {
    const { itemLabel } = useGameNames();
    const updateLane = (laneIndex: number, field: keyof BeltLaneFormData, value: string | number | undefined) => {
        const newLanes = [...belt.lanes] as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData];
        newLanes[laneIndex] = { ...newLanes[laneIndex], [field]: value };
        onUpdate(entityIndex, { lanes: newLanes });
    };

    const addLane = () => {
        if (belt.lanes.length < 2) {
            const newLanes: [BeltLaneFormData, BeltLaneFormData] = [
                belt.lanes[0],
                { ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE },
            ];
            onUpdate(entityIndex, { lanes: newLanes });
        }
    };

    const removeLane = () => {
        const newLanes: [BeltLaneFormData] = [belt.lanes[0]];
        onUpdate(entityIndex, { lanes: newLanes });
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel>Belt Type</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.beltType }}
                    value={belt.type}
                    label="Belt Type"
                    onChange={(e) => onUpdate(entityIndex, { type: e.target.value as BeltFormData['type'] })}
                    renderValue={(selected) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name={selected} size={20} alt="" />
                            {entityTypeLabel(selected, itemLabel)}
                        </Box>
                    )}
                >
                    {BELT_TYPES.map((bt) => (
                        <MenuItem key={bt.value} value={bt.value}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={bt.value} size={20} alt="" />
                                {entityTypeLabel(bt.value, itemLabel)}
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
                <InputLabel>Strategy</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.beltStrategy }}
                    value={belt.strategy ?? 'normal'}
                    label="Strategy"
                    onChange={(e) => onUpdate(entityIndex, beltStrategyUpdate(belt, e.target.value as BeltStrategyFormValue))}
                >
                    {BELT_STRATEGIES.map((strategy) => (
                        <MenuItem key={strategy.value} value={strategy.value}>
                            <Box>
                                <Typography variant="body2">{strategy.label}</Typography>
                                <Typography variant="caption" color="text.secondary">{strategy.description}</Typography>
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {belt.lanes.map((lane, laneIndex) => (
                <Box key={laneIndex} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ width: 56, flexShrink: 0 }}>
                        Lane {laneIndex + 1}:
                    </Typography>
                    <ItemSelector
                        value={lane.ingredient || null}
                        options={itemNames}
                        onChange={(newValue) => updateLane(laneIndex, 'ingredient', newValue || '')}
                        label="Ingredient"
                        freeSolo
                        sx={{ flex: 1 }}
                    />
                    <NumberField
                        label="Stack size"
                        value={lane.stack_size}
                        onValueChange={(val) => updateLane(laneIndex, 'stack_size', parseInt(val?.toString() || '') || BELT_FORM_DEFAULT_STACK_SIZE)}
                        min={1}
                        sx={{ width: 110 }}
                        size="small"
                    />
                    {belt.strategy === 'export' && (
                    <Tooltip title={LANE_CONSUMPTION_TOOLTIP} describeChild>
                        <Box>
                            <NumberField
                                label="Consumed /s"
                                value={lane.consumption_per_second ?? null}
                                onValueChange={(val) => updateLane(laneIndex, 'consumption_per_second', val && val > 0 ? val : undefined)}
                                min={0}
                                sx={{ width: 120 }}
                                size="small"
                            />
                        </Box>
                    </Tooltip>
                    )}
                    {belt.lanes.length > 1 && laneIndex === 1 ? (
                        <IconButton size="small" onClick={removeLane} color="error" aria-label="Remove lane">
                            <Close fontSize="small" />
                        </IconButton>
                    ) : (
                        <Box sx={{ width: 28 }} />
                    )}
                </Box>
            ))}

            {belt.lanes.length < 2 && (
                <Button size="small" onClick={addLane} sx={{ alignSelf: 'flex-start' }}>
                    Add Second Lane
                </Button>
            )}
        </Box>
    );
}

// ---- Chest section ----

function ChestEditSection({
    chest,
    entityIndex,
    itemNames,
    onUpdate,
    onSwitchType,
}: {
    chest: ChestFormData;
    entityIndex: number;
    itemNames: string[];
    onUpdate: (index: number, updates: Partial<ChestFormData>) => void;
    onSwitchType: (index: number, newType: typeof ChestType[keyof typeof ChestType]) => void;
}) {
    const getInfinityFilters = (): ChestFilterSlot[] => {
        if (!isInfinityChest(chest)) return [];
        return chest.item_filter.map(f => ({ item_name: f.item_name, quantity: f.request_count }));
    };

    const handleInfinityFilterChange = (slotIndex: number, filter: ChestFilterSlot) => {
        if (!isInfinityChest(chest)) return;
        const newFilters = [...chest.item_filter];
        newFilters[slotIndex] = { item_name: filter.item_name, request_count: filter.quantity };
        onUpdate(entityIndex, { item_filter: newFilters } as Partial<ChestFormData>);
    };

    const handleInfinityFilterRemove = (slotIndex: number) => {
        if (!isInfinityChest(chest)) return;
        if (chest.item_filter.length <= 1) {
            onUpdate(entityIndex, { item_filter: [{ item_name: '', request_count: 1 }] } as Partial<ChestFormData>);
            return;
        }
        onUpdate(entityIndex, { item_filter: chest.item_filter.filter((_, i) => i !== slotIndex) } as Partial<ChestFormData>);
    };

    const handleInfinityFilterAdd = () => {
        if (!isInfinityChest(chest)) return;
        onUpdate(entityIndex, {
            item_filter: [...chest.item_filter, { item_name: '', request_count: 1 }],
        } as Partial<ChestFormData>);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel>Chest Type</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.chestType }}
                    value={chest.type}
                    label="Chest Type"
                    onChange={(e) => onSwitchType(entityIndex, e.target.value as typeof ChestType[keyof typeof ChestType])}
                >
                    <MenuItem value={ChestType.BUFFER_CHEST}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name="iron-chest" size={20} alt="" />
                            Buffer chest
                        </Box>
                    </MenuItem>
                    <MenuItem value={ChestType.INFINITY_CHEST}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name="infinity-chest" size={20} alt="" />
                            Infinity chest
                        </Box>
                    </MenuItem>
                </Select>
            </FormControl>

            {isBufferChest(chest) && (
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <ItemSelector
                        value={(chest as BufferChestFormData).item_filter || null}
                        options={itemNames}
                        onChange={(newValue) => onUpdate(entityIndex, { item_filter: newValue || '' } as Partial<ChestFormData>)}
                        label="Item Filter"
                        size="small"
                        sx={{ flex: 1 }}
                    />
                    <TextField
                        label="Storage Size"
                        type="number"
                        value={(chest as BufferChestFormData).storage_size}
                        onChange={(e) => onUpdate(entityIndex, { storage_size: parseInt(e.target.value) || 1 } as Partial<ChestFormData>)}
                        inputProps={{ min: 1 }}
                        sx={{ width: 130 }}
                        size="small"
                    />
                </Box>
            )}

            {isInfinityChest(chest) && (
                <ChestFilterSlotSelector
                    filters={getInfinityFilters()}
                    itemNames={itemNames}
                    onFilterChange={handleInfinityFilterChange}
                    onRemoveFilter={handleInfinityFilterRemove}
                    onAddFilter={handleInfinityFilterAdd}
                    maxSlots={10}
                    quantityLabel="Request Count"
                    canAddMore={true}
                />
            )}
        </Box>
    );
}

// ---- Drill section ----

function DrillEditSection({
    drill,
    entityIndex,
    machines,
    itemNames,
    onUpdate,
}: {
    drill: DrillFormData;
    entityIndex: number;
    machines: MachineFormData[];
    itemNames: string[];
    onUpdate: (index: number, updates: Partial<DrillFormData>) => void;
}) {
    const { itemLabel, recipeLabel } = useGameNames();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel>Drill Type</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.drillType }}
                    value={drill.type}
                    label="Drill Type"
                    onChange={(e) => onUpdate(entityIndex, { type: e.target.value as DrillFormData['type'] })}
                    renderValue={(selected) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name={selected} size={20} alt="" />
                            {entityTypeLabel(selected, itemLabel)}
                        </Box>
                    )}
                >
                    {DRILL_TYPES.map((dt) => (
                        <MenuItem key={dt.value} value={dt.value}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={dt.value} size={20} alt="" />
                                {entityTypeLabel(dt.value, itemLabel)}
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <ItemSelector
                value={drill.mined_item_name || null}
                options={itemNames}
                onChange={(newValue) => onUpdate(entityIndex, { mined_item_name: newValue || '' })}
                label="Mined Resource"
                freeSolo
            />

            <NumberField
                label="Speed Bonus"
                value={drill.speed_bonus}
                onValueChange={(val) => onUpdate(entityIndex, { speed_bonus: val ?? 0 })}
                min={0}
                step={0.1}
                defaultValue={0}
                size="small"
            />

            <FormControl size="small" fullWidth>
                <InputLabel>Target Machine</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.targetMachine }}
                    value={drill.target.id}
                    label="Target Machine"
                    onChange={(e) => onUpdate(entityIndex, { target: { type: 'machine', id: Number(e.target.value) } })}
                >
                    {machines.map((m) => (
                        <MenuItem key={m.id} value={m.id}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={m.recipe || 'assembling-machine-3'} size={20} alt="" />
                                {entityLabel('machine', m.id)}{m.recipe ? ` (${recipeLabel(m.recipe)})` : ''}
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        </Box>
    );
}

// ---- Main dialog ----

export function EntityEditDialog({
    open,
    onClose,
    entityType,
    entityId,
    machines,
    inserters,
    belts,
    chests,
    drills,
    recipeNames,
    itemNames,
    getRecipeInfo,
    onUpdateMachine,
    onUpdateInserter,
    onUpdateBelt,
    onUpdateChest,
    onSwitchChestType,
    onUpdateDrill,
    onDeleteMachine,
    onDeleteInserter,
    onDeleteBelt,
    onDeleteChest,
    onDeleteDrill,
}: EntityEditDialogProps) {
    const { entity, entityIndex, title, iconName } = useMemo(() => {
        if (!entityType || entityId === null) {
            return { entity: null, entityIndex: -1, title: '', iconName: '' };
        }
        switch (entityType) {
            case 'machine': {
                const idx = machines.findIndex(m => m.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const m = machines[idx];
                return { entity: m, entityIndex: idx, title: entityLabel('machine', m.id), iconName: m.recipe || 'assembling-machine-3' };
            }
            case 'belt': {
                const idx = belts.findIndex(b => b.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const b = belts[idx];
                return { entity: b, entityIndex: idx, title: entityLabel('belt', b.id), iconName: b.type };
            }
            case 'chest': {
                const idx = chests.findIndex(c => c.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const c = chests[idx];
                return { entity: c, entityIndex: idx, title: entityLabel('chest', c.id), iconName: isInfinityChest(c) ? 'infinity-chest' : 'iron-chest' };
            }
            case 'inserter': {
                const idx = inserters.findIndex(i => i.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const ins = inserters[idx];
                return { entity: ins, entityIndex: idx, title: entityLabel('inserter', ins.id), iconName: 'stack-inserter' };
            }
            case 'drill': {
                const idx = (drills ?? []).findIndex(d => d.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const d = (drills ?? [])[idx];
                return { entity: d, entityIndex: idx, title: entityLabel('drill', d.id), iconName: d.type };
            }
        }
    }, [entityType, entityId, machines, inserters, belts, chests, drills]);

    const handleDelete = () => {
        if (entityIndex === -1) return;
        switch (entityType) {
            case 'machine': onDeleteMachine?.(entityIndex); break;
            case 'inserter': onDeleteInserter?.(entityIndex); break;
            case 'belt': onDeleteBelt?.(entityIndex); break;
            case 'chest': onDeleteChest?.(entityIndex); break;
            case 'drill': onDeleteDrill?.(entityIndex); break;
        }
        onClose();
    };

    const canDelete = entityType && entityIndex !== -1 && (
        (entityType === 'machine' && !!onDeleteMachine) ||
        (entityType === 'inserter' && !!onDeleteInserter) ||
        (entityType === 'belt' && !!onDeleteBelt) ||
        (entityType === 'chest' && !!onDeleteChest) ||
        (entityType === 'drill' && !!onDeleteDrill)
    );

    // Each opening starts from the current saved entity.
    const [inserterDirty, setInserterDirty] = useState(false);
    const [draft, setDraft] = useState(entity);
    const [confirmOpen, setConfirmOpen] = useState(false);
    // each opening gets a fresh panel: one reopened while the last closing fades out must not keep that draft
    const [openCount, setOpenCount] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setOpenCount((count) => count + 1);
            setDraft(entity);
            setInserterDirty(false);
            setConfirmOpen(false);
        }
    }
    const requestClose = () => {
        // a closing dialog (its fade-out) has nothing left to ask about
        if (!open) return;
        if (dirty) {
            setConfirmOpen(true);
        } else {
            onClose();
        }
    };

    const edits = useMemo(() => {
        if (!entity || !draft) return {};
        switch (entityType) {
            case 'machine': return changedFields(draft as MachineFormData, entity as MachineFormData, MACHINE_FIELDS);
            case 'belt': return changedFields(draft as BeltFormData, entity as BeltFormData, BELT_FIELDS);
            case 'drill': return changedFields(draft as DrillFormData, entity as DrillFormData, DRILL_FIELDS);
            case 'chest': {
                const chest = (value: ChestFormData) => ({ ...value, storage_size: isBufferChest(value) ? value.storage_size : undefined });
                return changedFields(chest(draft as ChestFormData), chest(entity as ChestFormData), CHEST_FIELDS);
            }
            default: return {};
        }
    }, [draft, entity, entityType]);
    const dirty = entityType === 'inserter' ? inserterDirty : Object.keys(edits).length > 0;
    const updateDraft = (_index: number, updates: object) => setDraft(d => d ? { ...d, ...updates } : d);
    const saveDraft = () => {
        if (!draft || !entity) return;
        switch (entityType) {
            case 'machine':
                for (const field of MACHINE_FIELDS) {
                    if (field in edits) onUpdateMachine(entityIndex, field, (draft as MachineFormData)[field] ?? 'machine');
                }
                break;
            case 'belt': onUpdateBelt(entityIndex, edits as Partial<BeltFormData>); break;
            case 'drill': onUpdateDrill?.(entityIndex, edits as Partial<DrillFormData>); break;
            case 'chest': {
                const chest = draft as ChestFormData;
                if (chest.type !== (entity as ChestFormData).type) onSwitchChestType(entityIndex, chest.type);
                const rest = { ...edits } as Partial<ChestFormData>;
                delete rest.type;
                onUpdateChest(entityIndex, rest);
                break;
            }
        }
        onClose();
    };

    const machineEntity = draft && entityType === 'machine' ? draft as MachineFormData : null;
    const { facts: machineFacts, error: machineFactsError } = useMachineFacts({
        recipe: machineEntity?.recipe ?? '',
        productivity: machineEntity?.productivity ?? 0,
        crafting_speed: machineEntity?.crafting_speed ?? 1,
        type: machineEntity?.type,
    });

    return (
        <>
            <Dialog
                open={open}
                onClose={requestClose}
                // it edits an entity by its place in the list, which an Undo could move: it withdraws the offer
                data-edits-build=""
                maxWidth={entityType === 'inserter' ? 'md' : 'sm'}
                fullWidth
                PaperProps={{ sx: { bgcolor: 'background.paper' } }}
                // named by the title text, not by the title bar with its buttons
                aria-labelledby="entity-edit-title"
            >            <DialogTitle id="entity-edit-bar" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1, pb: 1 }}>
                    {iconName && <FactorioIcon name={iconName} size={28} alt="" />}
                    <Typography id="entity-edit-title" variant="h6" component="span" sx={{ flex: 1 }}>
                        {title}
                    </Typography>
                    {canDelete && (
                        <IconButton onClick={handleDelete} size="small" aria-label="Delete entity" color="error">
                            <DeleteOutline />
                        </IconButton>
                    )}
                    <IconButton onClick={requestClose} size="small" aria-label="Close dialog">
                        <Close />
                    </IconButton>
                </DialogTitle>

                {/* the inserter editor keeps Cancel and Save in a bar stuck to the bottom: a field reached with Tab stops
                    above it instead of under it (WCAG 2.4.11) */}
                <DialogContent sx={{ p: 0, scrollPaddingBottom: 72 }}>
                    {draft && entityType === 'machine' && (
                        <Box sx={{ p: 2 }}>
                            <MachineEditSection
                                machine={draft as MachineFormData}
                                entityIndex={entityIndex}
                                recipeNames={recipeNames}
                                onUpdate={(index, field, value) => updateDraft(index, { [field]: value })}
                            />
                            {machineEntity?.recipe && (
                                <MachineFactsAccordion facts={machineFacts} error={machineFactsError} headingLevel={3} />
                            )}
                        </Box>
                    )}
                    {draft && entityType === 'belt' && (
                        <Box sx={{ p: 2 }}><BeltEditSection
                            belt={draft as BeltFormData}
                            entityIndex={entityIndex}
                            itemNames={itemNames}
                            onUpdate={updateDraft}
                        /></Box>
                    )}
                    {draft && entityType === 'chest' && (
                        <Box sx={{ p: 2 }}><ChestEditSection
                            chest={draft as ChestFormData}
                            entityIndex={entityIndex}
                            itemNames={itemNames}
                            onUpdate={updateDraft}
                            onSwitchType={(_index, type) => setDraft(d => switchedChest(d as ChestFormData, type))}
                        /></Box>
                    )}
                    {entity && entityType === 'inserter' && (
                        <InserterConfigPanel
                            key={`${entityId}-${openCount}`}
                            inserter={entity as InserterFormData}
                            entityIndex={entityIndex}
                            machines={machines}
                            inserters={inserters}
                            belts={belts}
                            chests={chests}
                            itemNames={itemNames}
                            getRecipeInfo={getRecipeInfo}
                            onUpdate={onUpdateInserter}
                            onClose={onClose}
                            onDirtyChange={setInserterDirty}
                            onCancel={requestClose}
                        />
                    )}
                    {draft && entityType === 'drill' && onUpdateDrill && (
                        <Box sx={{ p: 2 }}><DrillEditSection
                            drill={draft as DrillFormData}
                            entityIndex={entityIndex}
                            machines={machines}
                            itemNames={itemNames}
                            onUpdate={updateDraft}
                        /></Box>
                    )}
                    {entity && entityType !== 'inserter' && <DraftFooter dirty={dirty} onCancel={requestClose} onSave={saveDraft} />}
                    {!entity && (
                        <Typography color="text.secondary" variant="body2">Entity not found.</Typography>
                    )}
                </DialogContent>
            </Dialog>
            <DiscardChangesDialog
                open={confirmOpen}
                title={`Discard changes to ${title}?`}
                onKeepEditing={() => setConfirmOpen(false)}
                onDiscard={() => {
                    // Restore the nested prompt into the still-open editor before its own trap returns to the node.
                    flushSync(() => setConfirmOpen(false));
                    onClose();
                }}
            />
        </>
    );
}
