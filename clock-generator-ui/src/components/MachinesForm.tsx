import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Typography,
} from '@mui/material';
import { memo } from 'react';
import type { MachineFormData } from '../hooks/useConfigForm';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { SURFACE } from '../theme/tokens';
import { MACHINE_TYPE_LABELS } from './entityTypes';
import { FactorioIcon } from './FactorioIcon';
import { HelpCommand } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { MachineFactsAccordion } from './MachineFactsAccordion';
import { SidecarModLink } from './IntroCard';
import { NumberField } from './NumberField';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { useGameNames } from '../hooks/useGameNames';
import { nameWithId } from '../utils/gameNames';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { ELEMENT_IDS, machineRecipeElementId } from '../utils/firstProblem';
import { BUTTON_NAMES, SELECT_NAMES, recipeName } from '../utils/a11yLabels';

interface MachinesFormProps {
    machines: MachineFormData[];
    recipeNames: string[];
    onAdd: () => void;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
}

const CRAFTING_SPEED_COMMAND = '/c game.print(game.player.selected.crafting_speed)';

function MachinesFormComponent({
    machines,
    recipeNames,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
    onDuplicate,
}: MachinesFormProps) {
    const { density } = useDisplayPreferences();
    const compact = density === 'compact';
    const common = machines.length === 0 ? [] : [
        machines.every(row => row.productivity === machines[0].productivity) ? `productivity ${machines[0].productivity}%` : null,
        machines.every(row => row.crafting_speed === machines[0].crafting_speed) ? `speed ${machines[0].crafting_speed}×` : null,
        machines.every(row => (row.type ?? 'machine') === (machines[0].type ?? 'machine')) ? MACHINE_TYPE_LABELS[machines[0].type ?? 'machine'] : null,
        machines.every(row => row.type === 'biochamber' && (row.energy_consumption_bonus ?? 0) === (machines[0].energy_consumption_bonus ?? 0)) ? `energy consumption ${machines[0].energy_consumption_bonus ?? 0}%` : null,
    ].filter(Boolean);
    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(machines.length, onRemove);
    const announce = useAnnounce();
    const addedLabel = () => entityLabel('machine', Math.max(0, ...machines.map(row => row.id)) + 1);
    const duplicate = (index: number) => {
        afterAdd(() => onDuplicate(index));
        announce(`Added ${addedLabel()}, a copy of ${entityLabel('machine', machines[index].id)}.`);
    };

    const add = () => {
        afterAdd(onAdd);
        announce(`Added ${addedLabel()}.`);
    };

    return (
        <PanelSection
            ref={cardRef}
            level={3}
            title={`Machines (${machines.length})`}
            help={{
                label: BUTTON_NAMES.aboutMachines,
                content: (
                    <>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            The <SidecarModLink /> copies the crafting speeds of your build: then click Paste from
                            Factorio.
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Without it, hover over a machine in Factorio and run this command. A /c command turns off
                            achievements for that save.
                        </Typography>
                        <HelpCommand command={CRAFTING_SPEED_COMMAND} />
                    </>
                ),
            }}
            actions={(
                <Button id={ELEMENT_IDS.addMachine} startIcon={<Add />} onClick={add} variant="text" size="small" data-row-add="">
                    Add Machine
                </Button>
            )}
        >
            {compact && common.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                All {machines.length} machines: {common.join(' · ')}. Values remain editable below.
            </Typography>}
            <SortableList itemKeys={machines.map((m) => m._uuid)} onReorder={onReorder}>
                {machines.map((machine, index) => (
                    <SortableItem key={machine._uuid} stableKey={machine._uuid} label={entityLabel('machine', machine.id)}>
                        {(dragHandle) => (
                            <MachineRow
                                compact={compact}
                                machine={machine}
                                index={index}
                                recipeNames={recipeNames}
                                canDelete={machines.length > 1}
                                dragHandle={dragHandle}
                                onUpdate={onUpdate}
                                onRemove={remove}
                                onDuplicate={() => duplicate(index)}
                                onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                                onMoveDown={index < machines.length - 1 ? () => onReorder(index, index + 1) : undefined}
                            />
                        )}
                    </SortableItem>
                ))}
            </SortableList>
        </PanelSection>
    );
}

interface MachineRowProps {
    compact: boolean;
    machine: MachineFormData;
    index: number;
    recipeNames: string[];
    canDelete: boolean;
    onDuplicate: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    dragHandle: React.ReactNode;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onRemove: (index: number) => void;
}

function MachineRow({ compact, machine, index, recipeNames, canDelete, dragHandle, onUpdate, onRemove, onDuplicate, onMoveUp, onMoveDown }: MachineRowProps) {
    const { itemLabel } = useGameNames();
    const { facts, error } = useMachineFacts({
        recipe: machine.recipe,
        productivity: machine.productivity,
        crafting_speed: machine.crafting_speed,
        type: machine.type,
        energy_consumption_bonus: machine.energy_consumption_bonus,
    });

    return (
        <Box
            id={`entity-machine-${machine.id}`}
            role="group"
            aria-label={entityLabel('machine', machine.id)}
            sx={{
                mb: compact ? 1 : 2,
                p: compact ? 1.5 : 2,
                minWidth: 0,
                bgcolor: SURFACE.row,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    gap: compact ? 1 : 2,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                }}
            >
                {dragHandle}
                <Box data-row-first="" sx={{ display: 'contents' }}>
                <ItemSelector
                    kind="recipe"
                    inputId={machineRecipeElementId(machine.id)}
                    sx={{ flex: compact ? '2 1 210px' : '1 1 250px', minWidth: 0, maxWidth: '100%' }}
                    minWidth={0}
                    options={recipeNames}
                    value={machine.recipe || null}
                    onChange={(newValue) => onUpdate(index, 'recipe', newValue || '')}
                    label="Recipe"
                    placeholder="Search recipes..."
                    // the label says "Recipe" in every row: say whose it is
                    inputAriaLabel={recipeName(entityLabel('machine', machine.id))}
                    freeSolo
                />
                </Box>
                <NumberField
                    label="Productivity (%)"
                    value={machine.productivity}
                    onValueChange={(val) => onUpdate(index, 'productivity', val ?? 0)}
                    min={0}
                    step={1}
                    defaultValue={0}
                    sx={{ width: compact ? 140 : 150, maxWidth: '100%' }}
                    size="small"
                />
                <NumberField
                    label="Crafting Speed"
                    value={machine.crafting_speed}
                    onValueChange={(val) => onUpdate(index, 'crafting_speed', val ?? 1)}
                    min={0.01}
                    step={0.1}
                    defaultValue={1}
                    sx={{ width: compact ? 150 : 180, maxWidth: '100%' }}
                    size="small"
                />
                {machine.type === 'biochamber' && (
                    <NumberField
                        label="Energy Consumption (%)"
                        value={machine.energy_consumption_bonus ?? 0}
                        onValueChange={(val) => onUpdate(index, 'energy_consumption_bonus', val ?? 0)}
                        min={-80}
                        step={1}
                        defaultValue={0}
                        sx={{ width: 190, maxWidth: '100%' }}
                        size="small"
                    />
                )}
                <FormControl size="small" sx={{ flex: compact ? '1 1 190px' : undefined, minWidth: 0, width: compact ? 190 : 220, maxWidth: '100%' }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                        inputProps={{ 'aria-label': `${SELECT_NAMES.machineType}, ${entityLabel('machine', machine.id)}` }}
                        value={machine.type || 'machine'}
                        label="Type"
                        onChange={(e) => onUpdate(index, 'type', e.target.value as 'machine' | 'furnace' | 'biochamber')}
                        renderValue={(selected) => (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={selected === 'furnace' ? 'electric-furnace' : selected === 'biochamber' ? 'biochamber' : 'assembling-machine-3'} size={20} alt="" />
                                {MACHINE_TYPE_LABELS[selected]}
                            </Box>
                        )}
                    >
                        <MenuItem value="machine">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name="assembling-machine-3" size={20} alt="" />
                                {MACHINE_TYPE_LABELS.machine}
                            </Box>
                        </MenuItem>
                        <MenuItem value="furnace">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name="electric-furnace" size={20} alt="" />
                                {MACHINE_TYPE_LABELS.furnace}
                            </Box>
                        </MenuItem>
                        <MenuItem value="biochamber">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name="biochamber" size={20} alt="" />
                                {MACHINE_TYPE_LABELS.biochamber}
                            </Box>
                        </MenuItem>
                    </Select>
                </FormControl>
                <RowActionsMenu label={entityLabel('machine', machine.id)} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
                <IconButton
                    onClick={() => onRemove(index)}
                    color="error"
                    disabled={!canDelete}
                    aria-label={deleteButtonLabel('machine', machine.id)}
                    data-row-delete=""
                >
                    <Delete />
                </IconButton>
            </Box>
            {machine.recipe && (
                <MachineFactsAccordion machineId={machine.id} facts={facts} error={error} />
            )}
            {machine.fuel !== undefined && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }} title={nameWithId(itemLabel(machine.fuel), machine.fuel)}>Imported fuel (read-only): {itemLabel(machine.fuel)}.</Typography>}
        </Box>
    );
}

export const MachinesForm = memo(MachinesFormComponent);
