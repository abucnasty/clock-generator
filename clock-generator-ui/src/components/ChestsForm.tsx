import { Add, Delete, HelpOutline } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import { ChestType } from 'clock-generator/browser';
import type { ChestFormData } from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import { ChestFilterSlotSelector, type ChestFilterSlot } from './ChestFilterSlotSelector';
import { ItemSelector } from './ItemSelector';
import { SortableItem, SortableList } from './SortableList';

interface ChestsFormProps {
    chests: ChestFormData[];
    itemNames: string[];
    onAdd: (chestType?: ChestType) => void;
    onUpdate: (index: number, updates: Partial<ChestFormData>) => void;
    onSwitchType: (index: number, newType: ChestType) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

export function ChestsForm({
    chests,
    itemNames,
    onAdd,
    onUpdate,
    onSwitchType,
    onRemove,
    onReorder,
}: ChestsFormProps) {
    const [storageSizeInfoOpen, setStorageSizeInfoOpen] = useState(false);

    // Convert infinity chest to filter slot format
    const getInfinityChestFilters = (chest: ChestFormData): ChestFilterSlot[] => {
        if (!isInfinityChest(chest)) return [];
        return chest.item_filter.map(f => ({
            item_name: f.item_name,
            quantity: f.request_count,
        }));
    };

    // Handle infinity chest filter change
    const handleInfinityChestFilterChange = (chestIndex: number, slotIndex: number, filter: ChestFilterSlot) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        const newFilters = [...chest.item_filter];
        newFilters[slotIndex] = {
            item_name: filter.item_name,
            request_count: filter.quantity,
        };
        onUpdate(chestIndex, { item_filter: newFilters });
    };

    // Handle infinity chest filter remove
    const handleInfinityChestRemoveFilter = (chestIndex: number, slotIndex: number) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        // Don't allow removing the last filter
        if (chest.item_filter.length <= 1) {
            // Clear the filter instead
            onUpdate(chestIndex, {
                item_filter: [{ item_name: '', request_count: 1 }],
            });
            return;
        }

        onUpdate(chestIndex, {
            item_filter: chest.item_filter.filter((_, i) => i !== slotIndex),
        });
    };

    // Handle adding a new filter to infinity chest
    const handleInfinityChestAddFilter = (chestIndex: number) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        onUpdate(chestIndex, {
            item_filter: [...chest.item_filter, { item_name: '', request_count: 1 }],
        });
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    Chests ({chests.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button startIcon={<Add />} onClick={() => onAdd(ChestType.BUFFER_CHEST)} variant="text" size="small">
                        Buffer Chest
                    </Button>
                    <Button startIcon={<Add />} onClick={() => onAdd(ChestType.INFINITY_CHEST)} variant="text" size="small">
                        Infinity Chest
                    </Button>
                </Box>
            </Box>

            {chests.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No chests configured. Buffer chests provide intermediate storage. Infinity chests provide unlimited item sources.
                </Typography>
            )}

            <SortableList itemKeys={chests.map((c) => c._uuid)} onReorder={onReorder}>
            {chests.map((chest, index) => (
                <SortableItem key={chest._uuid} stableKey={chest._uuid} displayId={index + 1}>
                    {(dragHandle) => (
                <Box
                    id={`entity-chest-${chest.id}`}
                    sx={{
                        mb: 2,
                        p: 2,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                    }}
                >
                    {/* Header row with ID, Type, Filters, and Delete */}
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        {dragHandle}
                        
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                            <InputLabel>Type</InputLabel>
                            <Select
                                value={chest.type}
                                label="Type"
                                onChange={(e) => onSwitchType(index, e.target.value)}
                            >
                                <MenuItem value={ChestType.BUFFER_CHEST}>Buffer Chest</MenuItem>
                                <MenuItem value={ChestType.INFINITY_CHEST}>Infinity Chest</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Buffer Chest fields - item filter and storage size */}
                        {isBufferChest(chest) && (
                            <>
                                <ItemSelector
                                    value={chest.item_filter || null}
                                    options={itemNames}
                                    onChange={(newValue) => onUpdate(index, { item_filter: newValue || '' })}
                                    label="Item Filter"
                                    size="small"
                                    minWidth={200}
                                />
                                <TextField
                                    label="Storage Size"
                                    type="number"
                                    value={chest.storage_size}
                                    onChange={(e) => onUpdate(index, { storage_size: parseInt(e.target.value) || 1 })}
                                    inputProps={{ min: 1 }}
                                    sx={{ width: 140 }}
                                    size="small"
                                    slotProps={{
                                        input: {
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => setStorageSizeInfoOpen(true)}
                                                        edge="end"
                                                        aria-label="Storage size help"
                                                    >
                                                        <HelpOutline fontSize="small" />
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        },
                                    }}
                                />
                            </>
                        )}

                        {/* Infinity Chest filter slots - multiple slots */}
                        {isInfinityChest(chest) && (
                            <ChestFilterSlotSelector
                                filters={getInfinityChestFilters(chest)}
                                itemNames={itemNames}
                                onFilterChange={(slotIndex, filter) =>
                                    handleInfinityChestFilterChange(index, slotIndex, filter)
                                }
                                onRemoveFilter={(slotIndex) =>
                                    handleInfinityChestRemoveFilter(index, slotIndex)
                                }
                                onAddFilter={() => handleInfinityChestAddFilter(index)}
                                maxSlots={10}
                                quantityLabel="Request Count"
                                canAddMore={true}
                            />
                        )}

                        <Box sx={{ flex: 1 }} />

                        <IconButton onClick={() => onRemove(index)} color="error">
                            <Delete />
                        </IconButton>
                    </Box>
                </Box>
                    )}
                </SortableItem>
            ))}
            </SortableList>
            <Dialog
                open={storageSizeInfoOpen}
                onClose={() => setStorageSizeInfoOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Storage Size Explained</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" paragraph>
                        The <strong>Storage Size</strong> represents the number of available slots in the chest 
                        that the simulation will use for buffering items.
                    </Typography>
                    <Typography variant="body1" paragraph>
                        In Factorio, you can limit a chest's storage by clicking on the red X in the chest's 
                        inventory. This limits how many slots are available for items.
                    </Typography>
                    <Box
                        component="img"
                        src="/images/chest_slot_count_example.png"
                        alt="Example of chest slot limit in Factorio showing 8 slots available out of 48"
                        sx={{
                            width: '100%',
                            maxWidth: 400,
                            display: 'block',
                            mx: 'auto',
                            my: 2,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                        }}
                    />
                    <Typography variant="body2" color="text.secondary">
                        <strong>Example:</strong> If your chest has 8 slots available (as shown above), 
                        enter "8" as the storage size. This tells the simulation how much buffer capacity 
                        is available for the inserters to work with.
                    </Typography>
                </DialogContent>
            </Dialog>
        </Paper>
    );
}
