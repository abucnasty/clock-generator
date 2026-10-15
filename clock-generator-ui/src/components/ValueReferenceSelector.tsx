import {
    Box,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import { ValueReferenceType, EntityReference, TargetType } from 'clock-generator/light';
import type { ValueReference } from '../hooks/useConfigForm';
import { GROUP_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { useFullscreen } from './FullscreenContext';
import { ItemSelector } from './ItemSelector';

const VALUE_TYPES = [
    { value: ValueReferenceType.CONSTANT, label: 'Constant' },
    { value: ValueReferenceType.INVENTORY_ITEM, label: 'Inventory item' },
    { value: ValueReferenceType.AUTOMATED_INSERTION_LIMIT, label: 'Insertion limit' },
    { value: ValueReferenceType.OUTPUT_BLOCK, label: 'Output block' },
    { value: ValueReferenceType.CRAFTING_PROGRESS, label: 'Crafting progress %' },
    { value: ValueReferenceType.BONUS_PROGRESS, label: 'Bonus progress %' },
    { value: ValueReferenceType.HAND_QUANTITY, label: 'Items in hand' },
    { value: ValueReferenceType.INSERTER_STACK_SIZE, label: 'Stack size' },
] as const;

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface ValueReferenceSelectorProps {
    value: ValueReference;
    onChange: (value: ValueReference) => void;
    availableItems: string[];
    sourceType: SourceSinkType;
    sinkType: SourceSinkType;
    compact?: boolean;
    /** The element id of the item picker, which a problem with it points at */
    itemFieldId?: string;
    /** The item picker's accessible name, which says which condition it belongs to: "Item, condition 2" */
    itemAriaLabel?: string;
    /** The problem with the item picker, shown under it */
    itemError?: string;
}

function getDefaultValueReference(type: ValueReference['type']): ValueReference {
    switch (type) {
        case ValueReferenceType.CONSTANT:
            return { type: ValueReferenceType.CONSTANT, value: 0 };
        case ValueReferenceType.INVENTORY_ITEM:
            return { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SINK, item_name: '' };
        case ValueReferenceType.AUTOMATED_INSERTION_LIMIT:
            return { type: ValueReferenceType.AUTOMATED_INSERTION_LIMIT, entity: EntityReference.SINK, item_name: '' };
        case ValueReferenceType.OUTPUT_BLOCK:
            return { type: ValueReferenceType.OUTPUT_BLOCK, entity: EntityReference.SOURCE };
        case ValueReferenceType.CRAFTING_PROGRESS:
            return { type: ValueReferenceType.CRAFTING_PROGRESS, entity: EntityReference.SINK };
        case ValueReferenceType.BONUS_PROGRESS:
            return { type: ValueReferenceType.BONUS_PROGRESS, entity: EntityReference.SINK };
        case ValueReferenceType.HAND_QUANTITY:
            return { type: ValueReferenceType.HAND_QUANTITY };
        case ValueReferenceType.INSERTER_STACK_SIZE:
            return { type: ValueReferenceType.INSERTER_STACK_SIZE };
        default:
            // MACHINE_STATUS is handled by StatusConditionRow
            return { type: ValueReferenceType.CONSTANT, value: 0 };
    }
}

function needsEntity(type: ValueReference['type']): boolean {
    const typesNeedingEntity: readonly ValueReference['type'][] = [
        ValueReferenceType.INVENTORY_ITEM,
        ValueReferenceType.AUTOMATED_INSERTION_LIMIT,
        ValueReferenceType.OUTPUT_BLOCK,
        ValueReferenceType.CRAFTING_PROGRESS,
        ValueReferenceType.BONUS_PROGRESS
    ];
    return typesNeedingEntity.includes(type);
}

function needsItemName(type: ValueReference['type']): boolean {
    const typesNeedingItem: readonly ValueReference['type'][] = [
        ValueReferenceType.INVENTORY_ITEM,
        ValueReferenceType.AUTOMATED_INSERTION_LIMIT
    ];
    return typesNeedingItem.includes(type);
}

function isValidForEntityType(type: ValueReference['type'], entityType: SourceSinkType): boolean {
    if (entityType === TargetType.MACHINE) return true;
    const machineOnlyTypes: ValueReference['type'][] = [
        ValueReferenceType.CRAFTING_PROGRESS,
        ValueReferenceType.BONUS_PROGRESS,
        ValueReferenceType.AUTOMATED_INSERTION_LIMIT,
        ValueReferenceType.OUTPUT_BLOCK
    ];
    return !machineOnlyTypes.includes(type);
}

export function ValueReferenceSelector({
    value,
    onChange,
    availableItems,
    sourceType,
    sinkType,
    compact = false,
    itemFieldId,
    itemError,
    itemAriaLabel,
}: ValueReferenceSelectorProps) {
    const isFullscreen = useFullscreen();
    
    // Responsive sizing based on fullscreen mode
    const typeSelectWidth = isFullscreen ? 200 : (compact ? 120 : 160);
    const itemSelectorWidth = isFullscreen ? 300 : 180;
    const constantFieldWidth = isFullscreen ? 150 : 100;

    const handleTypeChange = (newType: ValueReference['type']) => {
        onChange(getDefaultValueReference(newType));
    };

    const handleEntityChange = (_: React.MouseEvent<HTMLElement>, newEntity: EntityReference | null) => {
        if (newEntity && 'entity' in value) {
            onChange({ ...value, entity: newEntity } as ValueReference);
        }
    };

    const filteredTypes = VALUE_TYPES.filter(vt => {
        if (!needsEntity(vt.value)) return true;
        return isValidForEntityType(vt.value, sourceType) || isValidForEntityType(vt.value, sinkType);
    });

    const entityDisabled = (entity: EntityReference) => {
        const entityType = entity === EntityReference.SOURCE ? sourceType : sinkType;
        return !isValidForEntityType(value.type, entityType);
    };

    return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: typeSelectWidth }}>
                <InputLabel>Type</InputLabel>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.valueType }}
                    value={value.type}
                    label="Type"
                    onChange={(e) => handleTypeChange(e.target.value as ValueReference['type'])}
                >
                    {filteredTypes.map((vt) => (
                        <MenuItem key={vt.value} value={vt.value}>
                            {vt.label}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {needsEntity(value.type) && 'entity' in value && (
                <ToggleButtonGroup
                    value={value.entity}
                    exclusive
                    onChange={handleEntityChange}
                    size="small"
                    aria-label={GROUP_NAMES.whichEnd}
                >
                    <ToggleButton value={EntityReference.SOURCE} disabled={entityDisabled(EntityReference.SOURCE)}>
                        Source
                    </ToggleButton>
                    <ToggleButton value={EntityReference.SINK} disabled={entityDisabled(EntityReference.SINK)}>
                        Destination
                    </ToggleButton>
                </ToggleButtonGroup>
            )}

            {value.type === ValueReferenceType.CONSTANT && (
                <TextField
                    type="number"
                    value={value.value}
                    onChange={(e) => onChange({ ...value, value: parseFloat(e.target.value) || 0 })}
                    size="small"
                    sx={{ width: constantFieldWidth }}
                    label="Value"
                    slotProps={{ htmlInput: { 'aria-label': SELECT_NAMES.constantValue } }}
                />
            )}

            {needsItemName(value.type) && 'item_name' in value && (
                <ItemSelector
                    value={value.item_name || null}
                    options={availableItems}
                    onChange={(newValue) => 
                        onChange({ ...value, item_name: newValue || '' } as ValueReference)
                    }
                    label="Item"
                    minWidth={itemSelectorWidth}
                    iconOnly
                    inputId={itemFieldId}
                    errorText={itemError}
                    inputAriaLabel={itemAriaLabel}
                />
            )}

            {value.type === ValueReferenceType.HAND_QUANTITY && (
                <ItemSelector
                    value={value.item_name || null}
                    options={availableItems}
                    onChange={(newValue) => 
                        onChange({ ...value, item_name: newValue || undefined })
                    }
                    label="Item (optional)"
                    minWidth={itemSelectorWidth}
                    iconOnly
                />
            )}
        </Box>
    );
}
