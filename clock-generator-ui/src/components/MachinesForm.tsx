import { Add, Delete, Info } from '@mui/icons-material';
import {
    Autocomplete,
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Popover,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import type { MachineFormData } from '../hooks/useConfigForm';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { FactorioIcon } from './FactorioIcon';
import { MachineFactsAccordion } from './MachineFactsAccordion';
import { NumberField } from './NumberField';
import { SortableItem, SortableList } from './SortableList';

interface MachinesFormProps {
    machines: MachineFormData[];
    recipeNames: string[];
    onAdd: () => void;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

const CRAFTING_SPEED_COMMAND = '/c game.print(game.player.selected.crafting_speed)';

export function MachinesForm({
    machines,
    recipeNames,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
}: MachinesFormProps) {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [copied, setCopied] = useState(false);

    const handleInfoClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
        setCopied(false);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(CRAFTING_SPEED_COMMAND);
        setCopied(true);
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6">
                        Machines ({machines.length})
                    </Typography>
                    <IconButton size="small" onClick={handleInfoClick} color="info">
                        <Info fontSize="small" />
                    </IconButton>
                    <Popover
                        open={Boolean(anchorEl)}
                        anchorEl={anchorEl}
                        onClose={handleClose}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'left',
                        }}
                    >
                        <Box sx={{ p: 2, maxWidth: 350 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                To get the crafting speed of a machine in Factorio, hover over the machine and run this command:
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
                                    {CRAFTING_SPEED_COMMAND}
                                </Typography>
                                <Button size="small" onClick={handleCopy} variant="outlined">
                                    {copied ? 'Copied!' : 'Copy'}
                                </Button>
                            </Box>
                        </Box>
                    </Popover>
                </Box>
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small">
                    Add Machine
                </Button>
            </Box>

            <SortableList itemIds={machines.map((m) => m.id)} onReorder={onReorder}>
                {machines.map((machine, index) => (
                    <SortableItem key={machine.id} id={machine.id}>
                        {(dragHandle) => (
                            <MachineRow
                                machine={machine}
                                index={index}
                                recipeNames={recipeNames}
                                canDelete={machines.length > 1}
                                dragHandle={dragHandle}
                                onUpdate={onUpdate}
                                onRemove={onRemove}
                            />
                        )}
                    </SortableItem>
                ))}
            </SortableList>
        </Paper>
    );
}

interface MachineRowProps {
    machine: MachineFormData;
    index: number;
    recipeNames: string[];
    canDelete: boolean;
    dragHandle: React.ReactNode;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onRemove: (index: number) => void;
}

function MachineRow({ machine, index, recipeNames, canDelete, dragHandle, onUpdate, onRemove }: MachineRowProps) {
    const { facts, error } = useMachineFacts({
        recipe: machine.recipe,
        productivity: machine.productivity,
        crafting_speed: machine.crafting_speed,
        type: machine.type,
    });

    return (
        <Box
            sx={{
                mb: 2,
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 1,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                }}
            >
                {dragHandle}
                <Autocomplete
                    sx={{ minWidth: 250, flex: 1 }}
                    options={recipeNames}
                    value={machine.recipe || null}
                    onChange={(_, newValue) => onUpdate(index, 'recipe', newValue || '')}
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
                <NumberField
                    label="Productivity (%)"
                    value={machine.productivity}
                    onValueChange={(val) => onUpdate(index, 'productivity', val ?? 0)}
                    min={0}
                    step={1}
                    defaultValue={0}
                    sx={{ width: 150 }}
                    size="small"
                />
                <NumberField
                    label="Crafting Speed"
                    value={machine.crafting_speed}
                    onValueChange={(val) => onUpdate(index, 'crafting_speed', val ?? 1)}
                    min={0.01}
                    step={0.1}
                    defaultValue={1}
                    sx={{ width: 180 }}
                    size="small"
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                        value={machine.type || 'machine'}
                        label="Type"
                        onChange={(e) => onUpdate(index, 'type', e.target.value as 'machine' | 'furnace')}
                        renderValue={(selected) => (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={selected === 'furnace' ? 'electric-furnace' : 'assembling-machine-3'} size={20} />
                                {selected === 'furnace' ? 'Furnace' : 'Machine'}
                            </Box>
                        )}
                    >
                        <MenuItem value="machine">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name="assembling-machine-3" size={20} />
                                Machine
                            </Box>
                        </MenuItem>
                        <MenuItem value="furnace">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name="electric-furnace" size={20} />
                                Furnace
                            </Box>
                        </MenuItem>
                    </Select>
                </FormControl>
                <IconButton
                    onClick={() => onRemove(index)}
                    color="error"
                    disabled={!canDelete}
                >
                    <Delete />
                </IconButton>
            </Box>
            {machine.recipe && (
                <MachineFactsAccordion facts={facts} error={error} />
            )}
        </Box>
    );
}
