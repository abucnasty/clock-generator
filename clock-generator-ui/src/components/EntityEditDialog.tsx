import { Close, DeleteOutline } from '@mui/icons-material';
import {
    Alert,
    Box,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Typography,
} from '@mui/material';
import { useId, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGameNames } from '../hooks/useGameNames';
import { useMachineFacts } from '../hooks/useMachineFacts';
import type { ChestType } from 'clock-generator/light';
import type {
    BeltFormData,
    ChestFormData,
    DrillFormData,
    InserterFormData,
    MachineFormData,
} from '../hooks/useConfigForm';
import { isBufferChest, isContainerChest, isInfinityChest } from '../hooks/useConfigForm';
import { chestTypeIcon } from '../utils/configForm/formData';
import type { BufferChestFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { chestLabel, entityLabel } from '../utils/entityLabel';
import { SELECT_NAMES } from '../utils/a11yLabels';
import type { EntityClickType } from './ConfigFlowDiagram';
import { BeltLaneFields, BeltStrategyField, ChestFields, EntityTypeField, MachineSettingsFields } from './EntityFields';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { DraftFooter } from './DraftFooter';
import { switchedChest } from '../utils/configForm/edits';
import { changedFields, MACHINE_FIELDS, BELT_FIELDS, CHEST_FIELDS, DRILL_FIELDS } from '../utils/inserterDraft';
import { FactorioIcon } from './FactorioIcon';
import { DrillTargetField } from './DrillTargetField';
import type { DrillTargetBuild } from '../utils/drillTarget';
import { OutputChestAlert } from './OutputChestAlert';
import { ItemSelector } from './ItemSelector';
import { useCraftingMachines, useMachineRecipeOptions } from '../hooks/useCraftingMachines';
import { recipePatch } from '../utils/machinePrototype';
import { NumberField } from './NumberField';
import { InserterConfigPanel } from './InserterConfigPanel';
import { MachineFactsAccordion } from './MachineFactsAccordion';
import { BELT_TYPES, DRILL_TYPES, entityTypeLabel } from './entityTypes';
import { DROP_BELT_READ_ONLY, beltGeometryEditProblem, hasImportedBeltDrops } from '../utils/inserterMetadata';
import { speedBonusOfPercent, speedBonusPercent } from '../utils/drillsSection';

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
    /** Saves a machine's edited fields as one edit; a field set to undefined is removed */
    onPatchMachine: (index: number, patch: Partial<MachineFormData>) => void;
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

// ---- Drill section ----

function DrillEditSection({
    drill,
    entityIndex,
    build,
    getRecipeInfo,
    itemNames,
    onUpdate,
}: {
    drill: DrillFormData;
    entityIndex: number;
    build: DrillTargetBuild;
    getRecipeInfo: (name: string) => RecipeInfo | null;
    itemNames: string[];
    onUpdate: (index: number, updates: Partial<DrillFormData>) => void;
}) {
    const { itemLabel } = useGameNames();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <EntityTypeField label="Drill Type" value={drill.type} options={DRILL_TYPES}
                inputAriaLabel={SELECT_NAMES.drillType} nameOf={value => entityTypeLabel(value, itemLabel)}
                onChange={type => onUpdate(entityIndex, { type: type as DrillFormData['type'] })} sx={{ width: '100%' }} />

            <ItemSelector
                value={drill.mined_item_name || null}
                options={itemNames}
                onChange={(newValue) => onUpdate(entityIndex, { mined_item_name: newValue || '' })}
                label="Mined Resource"
                freeSolo
            />

            <NumberField
                label="Mining speed bonus (%)"
                value={speedBonusPercent(drill.speed_bonus)}
                onValueChange={(val) => onUpdate(entityIndex, { speed_bonus: speedBonusOfPercent(val ?? 0) })}
                min={0}
                step={10}
                defaultValue={0}
                size="small"
            />

            <DrillTargetField drill={drill} build={build} getRecipeInfo={getRecipeInfo} sx={{ width: '100%' }}
                onChange={target => onUpdate(entityIndex, { target })} />
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
    onPatchMachine,
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
    const { itemLabel } = useGameNames();
    const geometryHelpId = useId();
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
                return { entity: c, entityIndex: idx, title: chestLabel(c), iconName: chestTypeIcon(c.type) };
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
    const drillTargetBuild = useMemo(() => ({ machines, belts, chests, inserters, drills: drills ?? [] }), [machines, belts, chests, inserters, drills]);

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
    const craftingMachines = useCraftingMachines();
    const machineRecipes = useMachineRecipeOptions(entityType === 'machine' ? (draft as MachineFormData | null)?.prototype : undefined, recipeNames);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saveProblem, setSaveProblem] = useState<string | null>(null);
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
            setSaveProblem(null);
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
                const chest = (value: ChestFormData) => ({ ...value, remove_unfiltered_items: isInfinityChest(value) ? value.remove_unfiltered_items : undefined, storage_size: isBufferChest(value) ? value.storage_size : undefined });
                // a car, a tank, a wagon or a silo: every field it has, or the chest it was switched from had
                if (isContainerChest(draft as ChestFormData) || isContainerChest(entity as ChestFormData)) {
                    const keys = [...new Set([...Object.keys(draft), ...Object.keys(entity)])]
                        .filter(key => key !== '_uuid' && key !== '_chest_settings') as (keyof ChestFormData)[];
                    return changedFields(draft as ChestFormData, entity as ChestFormData, keys);
                }
                type Fields = Record<(typeof CHEST_FIELDS)[number], unknown>;
                return changedFields(chest(draft as ChestFormData) as unknown as Fields, chest(entity as ChestFormData) as unknown as Fields, CHEST_FIELDS) as Partial<BufferChestFormData>;
            }
            default: return {};
        }
    }, [draft, entity, entityType]);
    const dirty = entityType === 'inserter' ? inserterDirty : Object.keys(edits).length > 0;
    const updateDraft = (_index: number, updates: object) => {
        setSaveProblem(null);
        setDraft(d => d ? { ...d, ...updates } : d);
    };
    const saveDraft = () => {
        if (!draft || !entity) return;
        if (entityType === 'belt') {
            const problem = beltGeometryEditProblem(inserters, entity as BeltFormData, edits as Partial<BeltFormData>);
            if (problem) {
                setSaveProblem(`${title}: ${problem}`);
                return;
            }
        }
        switch (entityType) {
            case 'machine':
                onPatchMachine(entityIndex, Object.fromEntries(MACHINE_FIELDS.filter(field => field in edits)
                    .map(field => [field, (draft as MachineFormData)[field]])) as Partial<MachineFormData>);
                break;
            case 'belt': onUpdateBelt(entityIndex, edits as Partial<BeltFormData>); break;
            case 'drill': onUpdateDrill?.(entityIndex, edits as Partial<DrillFormData>); break;
            case 'chest': {
                const chest = draft as ChestFormData;
                if (chest.type !== (entity as ChestFormData).type) onSwitchChestType(entityIndex, chest.type);
                // a car, a tank, a wagon or a silo, or a chest switched to or from one, is saved as the draft has it
                const container = isContainerChest(chest) || isContainerChest(entity as ChestFormData);
                const rest = (container ? { ...chest } : { ...edits }) as Partial<ChestFormData>;
                delete rest.type;
                delete rest._uuid;
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
        prototype: machineEntity?.prototype,
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
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <ItemSelector kind="recipe" options={machineRecipes.options} searchOnlyIds={machineRecipes.searchOnly} value={(draft as MachineFormData).recipe || null}
                                    onChange={value => updateDraft(entityIndex, recipePatch(draft as MachineFormData, value || '', craftingMachines))}
                                    label="Recipe" placeholder="Search recipes..." freeSolo />
                                <MachineSettingsFields machine={draft as MachineFormData} dialog
                                    onChange={(field, value) => updateDraft(entityIndex, { [field]: value })}
                                    onPatch={patch => updateDraft(entityIndex, patch)} />
                            </Box>
                            {machineEntity?.recipe && (
                                <MachineFactsAccordion machineId={entityId ?? 0} facts={machineFacts} error={machineFactsError} headingLevel={3} />
                            )}
                        </Box>
                    )}
                    {draft && entityType === 'belt' && (
                        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {hasImportedBeltDrops(inserters, draft.id) && <Typography id={geometryHelpId} variant="body2">{DROP_BELT_READ_ONLY}</Typography>}
                            <EntityTypeField label="Belt Type" value={(draft as BeltFormData).type} options={BELT_TYPES}
                                readOnly={hasImportedBeltDrops(inserters, draft.id)}
                                describedBy={hasImportedBeltDrops(inserters, draft.id) ? geometryHelpId : undefined}
                                inputAriaLabel={SELECT_NAMES.beltType} nameOf={value => entityTypeLabel(value, itemLabel)}
                                onChange={type => updateDraft(entityIndex, { type })} sx={{ width: '100%' }} />
                            <BeltStrategyField belt={draft as BeltFormData} dialog onChange={update => updateDraft(entityIndex, update)} />
                            <BeltLaneFields belt={draft as BeltFormData} itemNames={itemNames} readOnly={hasImportedBeltDrops(inserters, draft.id)} dialog
                                onChange={update => updateDraft(entityIndex, update)} />
                        </Box>
                    )}
                    {draft && entityType === 'chest' && (
                        <Box sx={{ p: 2 }}>
                            <OutputChestAlert chests={[draft as ChestFormData]} inserters={inserters} focusTargets={false}
                                onEnableRemoval={() => updateDraft(entityIndex, { remove_unfiltered_items: true })}
                                onSwitchType={(_index, type) => setDraft(d => switchedChest(d as ChestFormData, type, true))} />
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <ChestFields chest={draft as ChestFormData} itemNames={itemNames} dialog
                                    onChange={update => updateDraft(entityIndex, update)}
                                    onSwitchType={type => setDraft(d => switchedChest(d as ChestFormData, type))} />
                            </Box></Box>
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
                            drills={drills}
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
                            build={drillTargetBuild}
                            getRecipeInfo={getRecipeInfo}
                            itemNames={itemNames}
                            onUpdate={updateDraft}
                        /></Box>
                    )}
                    {saveProblem && <Alert role="alert" severity="warning" sx={{ mx: 2 }} data-geometry-save-problem>{saveProblem}</Alert>}
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
