import { Delete } from '@mui/icons-material';
import {
    Box,
    FormControl,
    IconButton,
    MenuItem,
    Select,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import { 
    MachineStatus, 
    EntityReference, 
    ComparisonOperator, 
    TargetType,
    ValueReferenceType 
} from 'clock-generator/browser';
import type { Condition } from '../hooks/useConfigForm';
import { useFullscreen } from './FullscreenContext';

const MACHINE_STATUSES = [
    { value: MachineStatus.INGREDIENT_SHORTAGE, label: 'Ingredient Shortage' },
    { value: MachineStatus.WORKING, label: 'Working' },
    { value: MachineStatus.OUTPUT_FULL, label: 'Output Full' },
    { value: MachineStatus.NO_FUEL, label: 'No Fuel' },
] as const;

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface StatusConditionRowProps {
    condition: Condition;
    onChange: (condition: Condition) => void;
    onDelete: () => void;
    sourceType: SourceSinkType;
    sinkType: SourceSinkType;
    canDelete: boolean;
}

export function StatusConditionRow({
    condition,
    onChange,
    onDelete,
    sourceType,
    sinkType,
    canDelete,
}: StatusConditionRowProps) {
    const isFullscreen = useFullscreen();
    
    // Responsive sizing
    const isNotSelectWidth = isFullscreen ? 100 : 80;
    const statusSelectWidth = isFullscreen ? 220 : 160;

    // Extract current values from the MACHINE_STATUS condition
    const currentEntity = condition.left.type === ValueReferenceType.MACHINE_STATUS 
        ? condition.left.entity 
        : EntityReference.SOURCE;
    const currentStatus = condition.left.type === ValueReferenceType.MACHINE_STATUS 
        ? condition.left.status 
        : MachineStatus.OUTPUT_FULL;
    const isNegated = condition.operator === ComparisonOperator.NOT_EQUAL;

    const handleEntityChange = (_: React.MouseEvent<HTMLElement>, newEntity: EntityReference | null) => {
        if (newEntity && condition.left.type === ValueReferenceType.MACHINE_STATUS) {
            onChange({
                ...condition,
                left: { ...condition.left, entity: newEntity },
            });
        }
    };

    const handleNegationChange = (negated: boolean) => {
        const operator = negated ? ComparisonOperator.NOT_EQUAL : ComparisonOperator.EQUAL;
        onChange({ ...condition, operator });
    };

    const handleStatusChange = (status: MachineStatus) => {
        if (condition.left.type === ValueReferenceType.MACHINE_STATUS) {
            onChange({
                ...condition,
                left: { ...condition.left, status },
            });
        }
    };

    const entityDisabled = (entity: EntityReference) => {
        const entityType = entity === EntityReference.SOURCE ? sourceType : sinkType;
        return entityType !== TargetType.MACHINE;
    };

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                flexWrap: 'wrap',
                py: 0.5,
            }}
        >
            <ToggleButtonGroup
                value={currentEntity}
                exclusive
                onChange={handleEntityChange}
                size="small"
            >
                <ToggleButton value={EntityReference.SOURCE} disabled={entityDisabled(EntityReference.SOURCE)}>
                    Source
                </ToggleButton>
                <ToggleButton value={EntityReference.SINK} disabled={entityDisabled(EntityReference.SINK)}>
                    Sink
                </ToggleButton>
            </ToggleButtonGroup>

            <FormControl size="small" sx={{ minWidth: isNotSelectWidth }}>
                <Select
                    value={isNegated ? 'is-not' : 'is'}
                    onChange={(e) => handleNegationChange(e.target.value === 'is-not')}
                >
                    <MenuItem value="is">is</MenuItem>
                    <MenuItem value="is-not">is not</MenuItem>
                </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: statusSelectWidth }}>
                <Select
                    value={currentStatus}
                    onChange={(e) => handleStatusChange(e.target.value as MachineStatus)}
                >
                    {MACHINE_STATUSES.map((s) => (
                        <MenuItem key={s.value} value={s.value}>
                            {s.label}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <IconButton
                onClick={onDelete}
                disabled={!canDelete}
                size="small"
                color="error"
            >
                <Delete fontSize="small" />
            </IconButton>
        </Box>
    );
}