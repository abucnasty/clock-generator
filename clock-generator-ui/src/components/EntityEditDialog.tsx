import { Close, DeleteOutline } from '@mui/icons-material';
import {
    Autocomplete,
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
import { useMemo } from 'react';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { ChestType } from 'clock-generator/browser';
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
import type { EntityClickType } from './ConfigFlowDiagram';
import { ChestFilterSlotSelector, type ChestFilterSlot } from './ChestFilterSlotSelector';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { InserterConfigPanel } from './InserterConfigPanel';
import { MachineFactsAccordion } from './MachineFactsAccordion';

// ---- Constants ----

const BELT_TYPES = [
    { value: 'transport-belt', label: 'Transport Belt' },
    { value: 'fast-transport-belt', label: 'Fast Transport Belt' },
    { value: 'express-transport-belt', label: 'Express Transport Belt' },
    { value: 'turbo-transport-belt', label: 'Turbo Transport Belt' },
];

const DRILL_TYPES = [
    { value: 'electric-mining-drill', label: 'Electric Mining Drill' },
    { value: 'burner-mining-drill', label: 'Burner Mining Drill' },
    { value: 'big-mining-drill', label: 'Big Mining Drill' },
];

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
            <Autocomplete
                options={recipeNames}
                value={machine.recipe || null}
                onChange={(_, newValue) => onUpdate(entityIndex, 'recipe', newValue || '')}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="Recipe"
                        placeholder="Search recipes..."
                        size="small"
                        slotProps={{
                            input: {
                                ...params.InputProps,
                                startAdornment: machine.recipe ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                                        <FactorioIcon name={machine.recipe} size={20} />
                                    </Box>
                                ) : null,
                            },
                        }}
                    />
                )}
                renderOption={(props, option) => {
                    const { key, ...rest } = props;
                    return (
                        <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name={option} size={20} />
                            {option}
                        </Box>
                    );
                }}
                freeSolo
                autoHighlight
            />
            <Box sx={{ display: 'flex', gap: 2 }}>
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
                <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                        value={machine.type || 'machine'}
                        label="Type"
                        onChange={(e) => onUpdate(entityIndex, 'type', e.target.value as 'machine' | 'furnace' | 'biochamber')}
                    >
                        <MenuItem value="machine">Assembler</MenuItem>
                        <MenuItem value="furnace">Furnace</MenuItem>
                        <MenuItem value="biochamber">Biochamber</MenuItem>
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
                    value={belt.type}
                    label="Belt Type"
                    onChange={(e) => onUpdate(entityIndex, { type: e.target.value as BeltFormData['type'] })}
                    renderValue={(selected) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name={selected} size={20} />
                            {BELT_TYPES.find((bt) => bt.value === selected)?.label}
                        </Box>
                    )}
                >
                    {BELT_TYPES.map((bt) => (
                        <MenuItem key={bt.value} value={bt.value}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={bt.value} size={20} />
                                {bt.label}
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
                <InputLabel>Strategy</InputLabel>
                <Select
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
                        label="Stack Size"
                        value={lane.stack_size}
                        onValueChange={(val) => updateLane(laneIndex, 'stack_size', parseInt(val?.toString() || '') || BELT_FORM_DEFAULT_STACK_SIZE)}
                        min={1}
                        sx={{ width: 110 }}
                        size="small"
                    />
                    {belt.strategy === 'export' && (
                    <Tooltip title={LANE_CONSUMPTION_TOOLTIP}>
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
                    value={chest.type}
                    label="Chest Type"
                    onChange={(e) => onSwitchType(entityIndex, e.target.value as typeof ChestType[keyof typeof ChestType])}
                >
                    <MenuItem value={ChestType.BUFFER_CHEST}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name="iron-chest" size={20} />
                            Buffer Chest
                        </Box>
                    </MenuItem>
                    <MenuItem value={ChestType.INFINITY_CHEST}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name="infinity-chest" size={20} />
                            Infinity Chest
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
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel>Drill Type</InputLabel>
                <Select
                    value={drill.type}
                    label="Drill Type"
                    onChange={(e) => onUpdate(entityIndex, { type: e.target.value as DrillFormData['type'] })}
                    renderValue={(selected) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FactorioIcon name={selected} size={20} />
                            {DRILL_TYPES.find((dt) => dt.value === selected)?.label}
                        </Box>
                    )}
                >
                    {DRILL_TYPES.map((dt) => (
                        <MenuItem key={dt.value} value={dt.value}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={dt.value} size={20} />
                                {dt.label}
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
                    value={drill.target.id}
                    label="Target Machine"
                    onChange={(e) => onUpdate(entityIndex, { target: { type: 'machine', id: Number(e.target.value) } })}
                >
                    {machines.map((m) => (
                        <MenuItem key={m.id} value={m.id}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={m.recipe || 'assembling-machine-3'} size={20} />
                                Machine {m.id}{m.recipe ? ` (${m.recipe})` : ''}
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
                return { entity: m, entityIndex: idx, title: `Machine ${m.id}`, iconName: m.recipe || 'assembling-machine-3' };
            }
            case 'belt': {
                const idx = belts.findIndex(b => b.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const b = belts[idx];
                return { entity: b, entityIndex: idx, title: `Belt ${b.id}`, iconName: b.type };
            }
            case 'chest': {
                const idx = chests.findIndex(c => c.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const c = chests[idx];
                return { entity: c, entityIndex: idx, title: `Chest ${c.id}`, iconName: isInfinityChest(c) ? 'infinity-chest' : 'iron-chest' };
            }
            case 'inserter': {
                const idx = inserters.findIndex(i => i.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const ins = inserters[idx];
                return { entity: ins, entityIndex: idx, title: `Inserter ${ins.id}`, iconName: 'stack-inserter' };
            }
            case 'drill': {
                const idx = (drills ?? []).findIndex(d => d.id === entityId);
                if (idx === -1) return { entity: null, entityIndex: -1, title: '', iconName: '' };
                const d = (drills ?? [])[idx];
                return { entity: d, entityIndex: idx, title: `Drill ${d.id}`, iconName: d.type };
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

    const machineEntity = entity && entityType === 'machine' ? entity as MachineFormData : null;
    const { facts: machineFacts, error: machineFactsError } = useMachineFacts({
        recipe: machineEntity?.recipe ?? '',
        productivity: machineEntity?.productivity ?? 0,
        crafting_speed: machineEntity?.crafting_speed ?? 1,
        type: machineEntity?.type,
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={entityType === 'inserter' ? 'md' : 'sm'}
            fullWidth
            PaperProps={{ sx: { bgcolor: 'background.paper' } }}
        >            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1, pb: 1 }}>
                {iconName && <FactorioIcon name={iconName} size={28} />}
                <Typography variant="h6" component="span" sx={{ flex: 1 }}>
                    {title}
                </Typography>
                {canDelete && (
                    <IconButton onClick={handleDelete} size="small" aria-label="Delete entity" color="error">
                        <DeleteOutline />
                    </IconButton>
                )}
                <IconButton onClick={onClose} size="small" aria-label="Close dialog">
                    <Close />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={entityType === 'inserter' ? { p: 0 } : { pt: '16px !important' }}>
                {entity && entityType === 'machine' && (
                    <>
                        <MachineEditSection
                            machine={entity as MachineFormData}
                            entityIndex={entityIndex}
                            recipeNames={recipeNames}
                            onUpdate={onUpdateMachine}
                        />
                        {machineEntity?.recipe && (
                            <MachineFactsAccordion facts={machineFacts} error={machineFactsError} />
                        )}
                    </>
                )}
                {entity && entityType === 'belt' && (
                    <BeltEditSection
                        belt={entity as BeltFormData}
                        entityIndex={entityIndex}
                        itemNames={itemNames}
                        onUpdate={onUpdateBelt}
                    />
                )}
                {entity && entityType === 'chest' && (
                    <ChestEditSection
                        chest={entity as ChestFormData}
                        entityIndex={entityIndex}
                        itemNames={itemNames}
                        onUpdate={onUpdateChest}
                        onSwitchType={onSwitchChestType}
                    />
                )}
                {entity && entityType === 'inserter' && (
                    <InserterConfigPanel
                        key={entityId ?? undefined}
                        inserter={entity as InserterFormData}
                        entityIndex={entityIndex}
                        machines={machines}
                        inserters={inserters}
                        belts={belts}
                        chests={chests}
                        itemNames={itemNames}
                        getRecipeInfo={getRecipeInfo}
                        onUpdate={onUpdateInserter}
                    />
                )}
                {entity && entityType === 'drill' && onUpdateDrill && (
                    <DrillEditSection
                        drill={entity as DrillFormData}
                        entityIndex={entityIndex}
                        machines={machines}
                        itemNames={itemNames}
                        onUpdate={onUpdateDrill}
                    />
                )}
                {!entity && (
                    <Typography color="text.secondary" variant="body2">Entity not found.</Typography>
                )}
            </DialogContent>
        </Dialog>
    );
}
