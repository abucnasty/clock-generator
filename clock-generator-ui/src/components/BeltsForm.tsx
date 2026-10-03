import { memo, useState } from 'react';
import { Add, Delete, Info } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Popover,
    Select,
    Tooltip,
    Typography,
} from '@mui/material';
import { BELT_FORM_DEFAULT_STACK_SIZE, BELT_STRATEGIES, LANE_CONSUMPTION_TOOLTIP, beltStrategyUpdate, type BeltFormData, type BeltLaneFormData, type BeltStrategyFormValue } from '../hooks/useConfigForm';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { SortableItem, SortableList } from './SortableList';

const BELT_TYPES = [
    { value: 'transport-belt', label: 'Transport Belt' },
    { value: 'fast-transport-belt', label: 'Fast Transport Belt' },
    { value: 'express-transport-belt', label: 'Express Transport Belt' },
    { value: 'turbo-transport-belt', label: 'Turbo Transport Belt' },
];

interface BeltsFormProps {
    belts: BeltFormData[];
    itemNames: string[];
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<BeltFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

function BeltsFormComponent({
    belts,
    itemNames,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
}: BeltsFormProps) {
    const [infoAnchor, setInfoAnchor] = useState<HTMLButtonElement | null>(null);

    const handleLaneUpdate = (
        beltIndex: number,
        laneIndex: number,
        field: keyof BeltLaneFormData,
        value: string | number | undefined
    ) => {
        const belt = belts[beltIndex];
        const newLanes = [...belt.lanes] as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData];
        newLanes[laneIndex] = { ...newLanes[laneIndex], [field]: value };
        onUpdate(beltIndex, { lanes: newLanes });
    };

    const addLane = (beltIndex: number) => {
        const belt = belts[beltIndex];
        if (belt.lanes.length < 2) {
            const newLanes: [BeltLaneFormData, BeltLaneFormData] = [
                belt.lanes[0],
                { ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE },
            ];
            onUpdate(beltIndex, { lanes: newLanes });
        }
    };

    const removeLane = (beltIndex: number) => {
        const belt = belts[beltIndex];
        if (belt.lanes.length > 1) {
            const newLanes: [BeltLaneFormData] = [belt.lanes[0]];
            onUpdate(beltIndex, { lanes: newLanes });
        }
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6">
                        Belts ({belts.length})
                    </Typography>
                    <IconButton size="small" onClick={(e) => setInfoAnchor(e.currentTarget)} color="info" aria-label="About belt strategies">
                        <Info fontSize="small" />
                    </IconButton>
                    <Popover
                        open={Boolean(infoAnchor)}
                        anchorEl={infoAnchor}
                        onClose={() => setInfoAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    >
                        <Box sx={{ p: 2, maxWidth: 380 }}>
                            {BELT_STRATEGIES.map((strategy) => (
                                <Typography key={strategy.value} variant="body2" sx={{ mb: 1 }}>
                                    <strong>{strategy.label}:</strong> {strategy.description}
                                </Typography>
                            ))}
                            <Typography variant="body2" color="text.secondary">
                                Inserters putting items onto a belt are clocked for what the inserters in this config take off
                                it. Use an export belt when machines outside this config take items off it too.
                            </Typography>
                        </Box>
                    </Popover>
                </Box>
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small">
                    Add Belt
                </Button>
            </Box>

            <SortableList itemKeys={belts.map((b) => b._uuid)} onReorder={onReorder}>
            {belts.map((belt, beltIndex) => (
                <SortableItem key={belt._uuid} stableKey={belt._uuid} displayId={beltIndex + 1}>
                    {(dragHandle) => (
                <Box
                    id={`entity-belt-${belt.id}`}
                    sx={{
                        mb: 2,
                        p: 2,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                    }}
                >
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
                        {dragHandle}
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel>Belt Type</InputLabel>
                            <Select
                                value={belt.type}
                                label="Belt Type"
                                onChange={(e) =>
                                    onUpdate(beltIndex, {
                                        type: e.target.value as BeltFormData['type'],
                                    })
                                }
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
                        <FormControl size="small" sx={{ minWidth: 130 }}>
                            <InputLabel>Strategy</InputLabel>
                            <Select
                                value={belt.strategy ?? 'normal'}
                                label="Strategy"
                                onChange={(e) =>
                                    onUpdate(beltIndex, beltStrategyUpdate(belt, e.target.value as BeltStrategyFormValue))
                                }
                            >
                                {BELT_STRATEGIES.map((strategy) => (
                                    <MenuItem key={strategy.value} value={strategy.value}>
                                        <Tooltip title={strategy.description} placement="right">
                                            <span>{strategy.label}</span>
                                        </Tooltip>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Box sx={{ flex: 1 }} />
                        {belt.lanes.length < 2 && (
                            <Button size="small" onClick={() => addLane(beltIndex)}>
                                Add Lane
                            </Button>
                        )}
                        <IconButton onClick={() => onRemove(beltIndex)} color="error">
                            <Delete />
                        </IconButton>
                    </Box>

                    {/* Lanes */}
                    <Box sx={{ pl: 2 }}>
                        {belt.lanes.map((lane, laneIndex) => (
                            <Box
                                key={`lane-${laneIndex}`}
                                sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}
                            >
                                <Typography variant="body2" sx={{ width: 60 }}>
                                    Lane {laneIndex + 1}:
                                </Typography>
                                <ItemSelector
                                    value={lane.ingredient || null}
                                    options={itemNames}
                                    onChange={(newValue) =>
                                        handleLaneUpdate(beltIndex, laneIndex, 'ingredient', newValue || '')
                                    }
                                    label="Ingredient"
                                    freeSolo
                                    sx={{ flex: 1 }}
                                />
                                <NumberField
                                    label="Stack Size"
                                    value={lane.stack_size}
                                    onValueChange={(val) => {
                                        const integer = parseInt(val?.toString() || '');
                                        handleLaneUpdate(
                                            beltIndex,
                                            laneIndex,
                                            'stack_size',
                                            integer || BELT_FORM_DEFAULT_STACK_SIZE
                                        )
                                    }}
                                    min={1}
                                    sx={{ width: 100 }}
                                    size="small"
                                />
                                {belt.strategy === 'export' && (
                                <Tooltip title={LANE_CONSUMPTION_TOOLTIP}>
                                    <Box>
                                        <NumberField
                                            label="Consumed /s"
                                            value={lane.consumption_per_second ?? null}
                                            onValueChange={(val) =>
                                                handleLaneUpdate(beltIndex, laneIndex, 'consumption_per_second', val && val > 0 ? val : undefined)
                                            }
                                            min={0}
                                            sx={{ width: 120 }}
                                            size="small"
                                        />
                                    </Box>
                                </Tooltip>
                                )}
                                {belt.lanes.length > 1 ? (
                                    laneIndex === 1 ? (
                                        <IconButton
                                            size="small"
                                            onClick={() => removeLane(beltIndex)}
                                            color="error"
                                        >
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    ) : (
                                        <Box sx={{ width: 28 }} />
                                    )
                                ) : null}
                            </Box>
                        ))}
                    </Box>
                </Box>
                    )}
                </SortableItem>
            ))}
            </SortableList>

            {belts.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No belts configured.
                </Typography>
            )}
        </Paper>
    );
}

export const BeltsForm = memo(BeltsFormComponent);
