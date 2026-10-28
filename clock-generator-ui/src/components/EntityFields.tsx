import { Close, Delete } from '@mui/icons-material';
import { Box, Button, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { ChestType } from 'clock-generator/light';
import { useGameNames } from '../hooks/useGameNames';
import { BELT_FORM_DEFAULT_STACK_SIZE, BELT_STRATEGIES, LANE_CONSUMPTION_TOOLTIP, beltStrategyUpdate, isBufferChest, isContainerChest, isInfinityChest,
    type BeltFormData, type BeltLaneFormData, type BeltStrategyFormValue, type ChestFormData, type MachineFormData } from '../hooks/useConfigForm';
import { SELECT_NAMES, deleteLaneName } from '../utils/a11yLabels';
import { entityLabel } from '../utils/entityLabel';
import { FactorioIcon } from './FactorioIcon';
import { ChestFilterSlotSelector } from './ChestFilterSlotSelector';
import { ContainerChestFields } from './ContainerChestFields';
import { HelpButton } from './HelpButton';
import { InfinityChestSettings } from './InfinityChestSettings';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { OptionWithNote, SelectField } from './SelectField';
import { CraftingSpeedHint, MachinePrototypeField, MachineQualityField } from './MachineFields';
import { CHEST_TYPES, CHEST_TYPE_LABELS, chestTypeIcon } from '../utils/configForm/formData';

/** Controlled type fields shared by the list and diagram editors. Draft ownership stays with the caller. */
export function EntityTypeField<T extends string>({ label, value, options, nameOf, iconOf = value => value, icons = true,
    onChange, inputAriaLabel = label, readOnly = false, describedBy, first = false, sx,
}: {
    label: string; value: T; options: readonly { value: T }[]; nameOf: (value: T) => string;
    iconOf?: (value: T) => string; icons?: boolean; onChange: (value: T) => void;
    inputAriaLabel?: string; readOnly?: boolean; describedBy?: string; first?: boolean; sx?: SxProps<Theme>;
}) {
    const display = (value: T) => icons ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FactorioIcon name={iconOf(value)} size={20} alt="" />{nameOf(value)}
    </Box> : nameOf(value);
    return <SelectField label={label} value={value} options={options.map(option => option.value)} render={display} onChange={onChange}
        inputAriaLabel={inputAriaLabel} describedBy={describedBy} readOnly={readOnly} first={first} sx={sx} />;
}

export function MachineSettingsFields({ machine, onChange, onPatch, dialog = false, nutrients = false }: {
    machine: MachineFormData; onChange: (field: keyof MachineFormData, value: string | number) => void;
    /** Sets several fields at once (the machine and its source); undefined removes a field */
    onPatch: (patch: Partial<MachineFormData>) => void; dialog?: boolean;
    /** The machine burns nutrients (a biochamber), so its energy consumption counts */
    nutrients?: boolean;
}) {
    const fieldSx = dialog ? { flex: 1 } : { minWidth: 0, width: '100%' };
    const ownerName = (name: string) => dialog ? name : `${name}, ${entityLabel('machine', machine.id)}`;
    return <Box sx={dialog ? { display: 'flex', flexWrap: 'wrap', gap: 2 } : {
        display: 'grid', gap: 1, gridTemplateColumns: `repeat(${nutrients ? 3 : 2}, minmax(0, 1fr))`,
        '@container machine-row (max-width: 520px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        '@container machine-row (max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    }}>
        <Box sx={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: dialog ? 2 : 1, minWidth: 0, width: dialog ? '100%' : undefined }}>
            <MachinePrototypeField machine={machine} onPatch={onPatch} inputAriaLabel={ownerName(SELECT_NAMES.machinePrototype)}
                sx={{ flex: '2 1 220px', minWidth: 0 }} />
            <MachineQualityField machine={machine} onPatch={onPatch} inputAriaLabel={ownerName(SELECT_NAMES.machineQuality)}
                sx={{ flex: '1 1 150px', minWidth: 0 }} />
        </Box>
        <NumberField label="Productivity (%)" value={machine.productivity} onValueChange={value => onChange('productivity', value ?? 0)}
            min={0} step={1} defaultValue={0} sx={fieldSx} size="small" />
        <NumberField label="Crafting Speed" value={machine.crafting_speed} onValueChange={value => onChange('crafting_speed', value ?? 1)}
            min={0.01} step={0.1} defaultValue={1} sx={fieldSx} size="small" />
        {!dialog && nutrients && <NumberField label="Energy Consumption (%)" value={machine.energy_consumption_bonus ?? 0}
            onValueChange={value => onChange('energy_consumption_bonus', value ?? 0)} min={-80} step={1} defaultValue={0} sx={fieldSx} size="small" />}
        <CraftingSpeedHint machine={machine} sx={{ gridColumn: '1 / -1', width: dialog ? '100%' : undefined, minWidth: 0 }} />
    </Box>;
}

export function BeltStrategyField({ belt, onChange, dialog = false }: {
    belt: BeltFormData; onChange: (update: Partial<BeltFormData>) => void; dialog?: boolean;
}) {
    // the field shows the chosen strategy as the list does: with what it does under it in the dialog, on hover in a row
    const shown = (value: BeltStrategyFormValue) => {
        const strategy = BELT_STRATEGIES.find(strategy => strategy.value === value) ?? { label: value, description: '' };
        return dialog ? <OptionWithNote label={strategy.label} note={strategy.description} />
            : <Tooltip title={strategy.description} placement="right" describeChild><span>{strategy.label}</span></Tooltip>;
    };
    return <SelectField label="Strategy" fullWidth value={belt.strategy ?? 'normal'} options={BELT_STRATEGIES.map(strategy => strategy.value)}
        render={shown} onChange={value => onChange(beltStrategyUpdate(belt, value))}
        inputAriaLabel={dialog ? SELECT_NAMES.beltStrategy : `${SELECT_NAMES.beltStrategy}, ${entityLabel('belt', belt.id)}`}
        sx={dialog ? { '& .MuiSelect-select': { whiteSpace: 'normal', overflowWrap: 'anywhere' } } : undefined} />;
}

export function BeltLaneFields({ belt, itemNames, readOnly, onChange, dialog = false }: {
    belt: BeltFormData; itemNames: string[]; readOnly: boolean; onChange: (update: Partial<BeltFormData>) => void; dialog?: boolean;
}) {
    const { itemLabel } = useGameNames();
    const updateLane = (index: number, field: keyof BeltLaneFormData, value: string | number | undefined) => {
        const lanes = [...belt.lanes] as BeltFormData['lanes'];
        lanes[index] = { ...lanes[index], [field]: value };
        onChange({ lanes });
    };
    const add = () => onChange({ lanes: [belt.lanes[0], { ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE }] });
    const remove = () => onChange({ lanes: [belt.lanes[0]] });
    const addButton = !readOnly && belt.lanes.length < 2 && <Button size="small" color="inherit" onClick={add}>
        {dialog ? 'Add Second Lane' : 'Add Lane'}
    </Button>;
    return <Box sx={{ minWidth: 0 }}>
        {!dialog && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>{addButton}</Box>}
        {belt.lanes.map((lane, index) => <Box key={index} sx={dialog
            ? { display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }
            : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px', gap: 1, alignItems: 'start', mb: 1, minWidth: 0 }}>
            <Box sx={dialog ? { display: 'contents' } : { display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', minWidth: 0 }}>
            <Typography variant="body2" sx={{ width: dialog ? 56 : 60, flexShrink: 0 }}>Lane {index + 1}:</Typography>
            {readOnly ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Ingredient: {itemLabel(lane.ingredient)}. Stack size: {lane.stack_size} (read-only).</Typography> : <>
                {dialog && <ItemSelector value={lane.ingredient || null} options={itemNames} label="Ingredient" freeSolo
                    onChange={value => updateLane(index, 'ingredient', value || '')} sx={{ flex: '1 1 200px', minWidth: 'min(200px, 100%)' }} />}
                <NumberField label="Stack size" value={lane.stack_size} min={1} size="small"
                    onValueChange={value => updateLane(index, 'stack_size', parseInt(value?.toString() || '') || BELT_FORM_DEFAULT_STACK_SIZE)}
                    sx={{ width: dialog ? 110 : 100, maxWidth: '100%', flexShrink: 0 }} />
            </>}
            {belt.strategy === 'export' && <Tooltip title={LANE_CONSUMPTION_TOOLTIP} describeChild><Box sx={{ flexShrink: 0 }}>
                <NumberField label="Consumed /s" value={lane.consumption_per_second ?? null} min={0} size="small"
                    onValueChange={value => updateLane(index, 'consumption_per_second', value && value > 0 ? value : undefined)} sx={{ width: 120 }} />
            </Box></Tooltip>}
            </Box>
            {!readOnly && belt.lanes.length > 1 && index === 1 ? <IconButton size="small" onClick={remove} color="error"
                aria-label={dialog ? 'Remove lane' : deleteLaneName(entityLabel('belt', belt.id), index + 1)}>{dialog ? <Close fontSize="small" /> : <Delete fontSize="small" />}</IconButton>
                : (dialog || !readOnly && belt.lanes.length > 1) && <Box sx={{ width: 28, flexShrink: 0 }} />}
        </Box>)}
        {dialog && addButton}
    </Box>;
}

export function ChestFields({ chest, itemNames, onChange, onSwitchType, dialog = false, storageHelp, containerDetails = true }: {
    chest: ChestFormData; itemNames: string[]; onChange: (update: Partial<ChestFormData>) => void;
    onSwitchType: (type: ChestType) => void; dialog?: boolean; storageHelp?: ReactNode; containerDetails?: boolean;
}) {
    return <>
        <EntityTypeField label={dialog ? 'Chest Type' : 'Type'} value={chest.type}
            options={CHEST_TYPE_OPTIONS} first={!dialog}
            nameOf={type => CHEST_TYPE_LABELS[type]} iconOf={chestTypeIcon} icons={dialog}
            inputAriaLabel={SELECT_NAMES.chestType} onChange={onSwitchType} sx={dialog ? { width: '100%' } : { minWidth: 0, flex: '1 1 160px' }} />
        {isBufferChest(chest) && <Box sx={dialog ? { display: 'flex', flexWrap: 'wrap', gap: 2 } : { display: 'contents' }}>
            <ChestFilterSlotSelector filters={[{ item_name: chest.item_filter, quantity: 1 }]} itemNames={itemNames}
                onFilterChange={(_, filter) => onChange({ item_filter: filter.item_name })} onRemoveFilter={() => onChange({ item_filter: '' })}
                maxSlots={1} canAddMore={false} showQuantity={false} />
            <TextField label="Storage Size" type="number" value={chest.storage_size} size="small" inputProps={{ min: 1 }}
                onChange={event => onChange({ storage_size: parseInt(event.target.value) || 1 })}
                sx={dialog ? { width: 130, maxWidth: '100%', flexShrink: 0 } : { minWidth: 0, flex: '1 1 140px' }}
                slotProps={storageHelp ? { input: { endAdornment: <InputAdornment position="end" sx={{ mr: -1 }}>
                    <HelpButton label="About storage size">{storageHelp}</HelpButton>
                </InputAdornment> } } : undefined} />
        </Box>}
        {isInfinityChest(chest) && <Box sx={dialog ? { display: 'contents' } : { minWidth: 0, flex: '2 1 160px' }}><InfinityChestSettings chest={chest} onChange={enabled => onChange({ remove_unfiltered_items: enabled })}>
            <ChestFilterSlotSelector filters={chest.item_filter.map(filter => ({ item_name: filter.item_name, quantity: filter.request_count }))}
                itemNames={itemNames} maxSlots={10} quantityLabel="Stock to maintain" canAddMore
                onFilterChange={(index, filter) => {
                    const filters = [...chest.item_filter];
                    filters[index] = { item_name: filter.item_name, request_count: filter.quantity };
                    onChange({ item_filter: filters });
                }}
                onRemoveFilter={index => onChange({ item_filter: chest.item_filter.filter((_, i) => i !== index) })} />
        </InfinityChestSettings></Box>}
        {containerDetails && isContainerChest(chest) && <ContainerChestFields chest={chest} itemNames={itemNames} onChange={onChange} dialog={dialog} />}
    </>;
}

const CHEST_TYPE_OPTIONS = CHEST_TYPES.map(value => ({ value }));
