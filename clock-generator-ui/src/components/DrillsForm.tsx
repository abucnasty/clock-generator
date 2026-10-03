import { Add, Delete, Info, Settings } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Popover,
    Select,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState, memo } from 'react';
import type { DrillFormData, EnableControlOverride } from '../hooks/useConfigForm';
import { EnableControlModal } from './EnableControlModal';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { SortableItem, SortableList } from './SortableList';

const DRILL_TYPES = [
    { value: 'electric-mining-drill', label: 'Electric Mining Drill' },
    { value: 'burner-mining-drill', label: 'Burner Mining Drill' },
    { value: 'big-mining-drill', label: 'Big Mining Drill' },
];

const SPEED_BONUS_COMMAND = '/c game.print(game.player.selected.speed_bonus)';

interface DrillsFormProps {
    enabled: boolean;
    miningProductivityLevel: number;
    drills: DrillFormData[];
    resourceNames: string[];
    machineIds: number[];
    onEnable: () => void;
    onDisable: () => void;
    onUpdateProductivityLevel: (value: number) => void;
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<DrillFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

function DrillsFormComponent({
    enabled,
    miningProductivityLevel,
    drills,
    resourceNames,
    machineIds,
    onEnable,
    onDisable,
    onUpdateProductivityLevel,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
}: DrillsFormProps) {
    const [enableControlModalDrillIndex, setEnableControlModalDrillIndex] = useState<number | null>(null);
    const [infoAnchorEl, setInfoAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [copied, setCopied] = useState(false);

    const handleInfoClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        setInfoAnchorEl(event.currentTarget);
    };

    const handleInfoClose = () => {
        setInfoAnchorEl(null);
        setCopied(false);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(SPEED_BONUS_COMMAND);
        setCopied(true);
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6">
                        Mining Drills ({drills.length})
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={enabled}
                                onChange={() => {
                                    if (enabled) {
                                        onDisable();
                                    } else {
                                        onEnable();
                                    }
                                }}
                                size="small"
                            />
                        }
                        label={enabled ? 'Enabled' : 'Disabled'}
                        sx={{ ml: 1 }}
                    />
                    <IconButton size="small" onClick={handleInfoClick} color="info">
                        <Info fontSize="small" />
                    </IconButton>
                    <Popover
                        open={Boolean(infoAnchorEl)}
                        anchorEl={infoAnchorEl}
                        onClose={handleInfoClose}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'left',
                        }}
                    >
                        <Box sx={{ p: 2, maxWidth: 350 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                To get the speed bonus of a mining drill in Factorio, hover over the drill and run this command:
                            </Typography>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    bgcolor: 'action.hover',
                                    p: 1,
                                    borderRadius: 1,
                                    fontFamily: 'monospace',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <Typography
                                    component="code"
                                    sx={{ flex: 1, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                >
                                    {SPEED_BONUS_COMMAND}
                                </Typography>
                                <Button size="small" onClick={handleCopy} variant="outlined">
                                    {copied ? 'Copied!' : 'Copy'}
                                </Button>
                            </Box>
                        </Box>
                    </Popover>
                </Box>
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small" disabled={!enabled}>
                    Add Drill
                </Button>
            </Box>

            {enabled ? (
                <>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                        <TextField
                            label="Mining Productivity Level"
                            type="number"
                            value={miningProductivityLevel}
                            onChange={(e) =>
                                onUpdateProductivityLevel(parseInt(e.target.value) || 0)
                            }
                            inputProps={{ min: 0 }}
                            sx={{ width: 200 }}
                            size="small"
                        />
                    </Box>

                    <SortableList itemKeys={drills.map((d) => d._uuid)} onReorder={onReorder}>
                    {drills.map((drill, index) => (
                        <SortableItem key={drill._uuid} stableKey={drill._uuid} displayId={index + 1}>
                            {(dragHandle) => (
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 2,
                                alignItems: 'center',
                                mb: 2,
                                p: 2,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                flexWrap: 'wrap',
                            }}
                        >
                            {dragHandle}
                            <FormControl size="small" sx={{ minWidth: 180 }}>
                                <InputLabel>Drill Type</InputLabel>
                                <Select
                                    value={drill.type}
                                    label="Drill Type"
                                    onChange={(e) =>
                                        onUpdate(index, {
                                            type: e.target.value as DrillFormData['type'],
                                        })
                                    }
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
                                value={drill.mined_item_name || ''}
                                onChange={(newValue) => {
                                    if (newValue) {
                                        onUpdate(index, { mined_item_name: newValue });
                                    }
                                }}
                                options={resourceNames}
                                label="Mined Resource"
                            />
                            <TextField
                                label="Speed Bonus"
                                type="number"
                                value={drill.speed_bonus}
                                onChange={(e) =>
                                    onUpdate(index, {
                                        speed_bonus: parseFloat(e.target.value) || 0,
                                    })
                                }
                                inputProps={{ step: 0.1 }}
                                sx={{ width: 120 }}
                                size="small"
                            />
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <InputLabel>Target Machine</InputLabel>
                                <Select
                                    value={drill.target.id}
                                    label="Target Machine"
                                    onChange={(e) =>
                                        onUpdate(index, {
                                            target: { type: 'machine', id: e.target.value as number },
                                        })
                                    }
                                >
                                    {machineIds.map((id) => (
                                        <MenuItem key={id} value={id}>
                                            Machine {id}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            {/* Enable Control Settings */}
                            <Tooltip title="Configure Enable Control">
                                <IconButton
                                    onClick={() => setEnableControlModalDrillIndex(index)}
                                    color={drill.overrides?.enable_control?.mode && drill.overrides.enable_control.mode !== 'AUTO' ? 'primary' : 'default'}
                                >
                                    <Settings />
                                </IconButton>
                            </Tooltip>
                            <IconButton onClick={() => onRemove(index)} color="error">
                                <Delete />
                            </IconButton>
                        </Box>
                            )}
                        </SortableItem>
                    ))}
                    </SortableList>

                    {drills.length === 0 && (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ textAlign: 'center', py: 2 }}
                        >
                            No drills configured. Add drills if you need mining input.
                        </Typography>
                    )}
                </>
            ) : (
                <Typography variant="body2" color="text.secondary">
                    Mining drills are disabled. Enable them if your setup includes ore mining.
                </Typography>
            )}

            {/* Enable Control Modal */}
            <EnableControlModal
                open={enableControlModalDrillIndex !== null}
                onClose={() => setEnableControlModalDrillIndex(null)}
                entityType="drill"
                entityLabel={enableControlModalDrillIndex !== null ? `Drill ${drills[enableControlModalDrillIndex]?.id}` : ''}
                currentOverride={enableControlModalDrillIndex !== null ? drills[enableControlModalDrillIndex]?.overrides?.enable_control : undefined}
                sinkType="machine"
                availableItems={(() => {
                    if (enableControlModalDrillIndex === null) return [];
                    const drill = drills[enableControlModalDrillIndex];
                    if (drill?.mined_item_name) {
                        return [drill.mined_item_name];
                    }
                    return [];
                })()}
                onSave={(override: EnableControlOverride | undefined) => {
                    if (enableControlModalDrillIndex !== null) {
                        const drill = drills[enableControlModalDrillIndex];
                        onUpdate(enableControlModalDrillIndex, {
                            overrides: {
                                ...drill.overrides,
                                enable_control: override,
                            },
                        });
                    }
                    setEnableControlModalDrillIndex(null);
                }}
            />
        </Paper>
    );
}

export const DrillsForm = memo(DrillsFormComponent);
