import { Add } from '@mui/icons-material';
import { Box, Typography, Popover, TextField, Button } from '@mui/material';
import { useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { SLOT_COUNT_SX, insetSlotSx } from './insetSlot';
import { SlotRemoveButton } from './SlotRemoveButton';

export interface ChestFilterSlot {
    item_name: string;
    quantity: number;
}

interface ChestFilterSlotSelectorProps {
    filters: ChestFilterSlot[];
    itemNames: string[];
    onFilterChange: (slotIndex: number, filter: ChestFilterSlot) => void;
    onRemoveFilter: (slotIndex: number) => void;
    onAddFilter: () => void;
    maxSlots?: number;
    quantityLabel?: string;
    canAddMore?: boolean;
}

export function ChestFilterSlotSelector({
    filters,
    itemNames,
    onFilterChange,
    onRemoveFilter,
    onAddFilter,
    maxSlots = 10,
    quantityLabel = 'Count',
    canAddMore = true,
}: ChestFilterSlotSelectorProps) {
    const { itemLabel } = useGameNames();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
    const [pendingItem, setPendingItem] = useState<string | null>(null);
    const [pendingQuantity, setPendingQuantity] = useState<number>(1);
    const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
    const addButtonRef = useRef<HTMLDivElement>(null);

    const handleSlotClick = (slotIndex: number, element: HTMLElement) => {
        const filter = filters[slotIndex];
        setPendingItem(filter?.item_name || null);
        setPendingQuantity(filter?.quantity || 1);
        setAnchorEl(element);
        setActiveSlotIndex(slotIndex);
    };

    const handleAddClick = (element: HTMLElement) => {
        setPendingItem(null);
        setPendingQuantity(1);
        setAnchorEl(element);
        setActiveSlotIndex(filters.length); // New slot index
    };

    const handleClose = () => {
        setAnchorEl(null);
        setActiveSlotIndex(null);
        setPendingItem(null);
        setPendingQuantity(1);
    };

    const handleItemSelect = (item: string | null) => {
        setPendingItem(item);
    };

    const handleQuantityChange = (value: number) => {
        setPendingQuantity(Math.max(1, value));
    };

    const handleConfirm = () => {
        if (activeSlotIndex !== null && pendingItem) {
            const isNewSlot = activeSlotIndex >= filters.length;
            if (isNewSlot) {
                onAddFilter();
                // Wait for the filter to be added, then update it
                setTimeout(() => {
                    onFilterChange(activeSlotIndex, {
                        item_name: pendingItem,
                        quantity: pendingQuantity,
                    });
                }, 0);
            } else {
                onFilterChange(activeSlotIndex, {
                    item_name: pendingItem,
                    quantity: pendingQuantity,
                });
            }
        }
        handleClose();
    };

    const removeFilter = (slotIndex: number) => {
        onRemoveFilter(slotIndex);
        // the slot goes with its filter: once it is gone, the keyboard focus moves to the slot that took its place,
        // else the one before it, else the add button
        setTimeout(() => (slotRefs.current[slotIndex] ?? slotRefs.current[slotIndex - 1] ?? addButtonRef.current)?.focus(), 0);
    };

    const displayedFilters = filters.slice(0, maxSlots);
    // one "+" at the end, unless an empty slot already offers it
    const showAddButton = canAddMore && filters.length < maxSlots && filters.every((filter) => filter.item_name);

    return (
        // the gap keeps a remove button, which sticks out past its slot's corner, a few pixels off the next slot
        <Box sx={{ display: 'flex', columnGap: 2, rowGap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Render existing filter slots */}
            {displayedFilters.map((filter, slotIndex) => (
                // the slot and its remove button are siblings: a button inside a button cannot be reached or named
                <Box key={slotIndex} sx={{ position: 'relative' }}>
                    <Box
                        ref={(element: HTMLDivElement | null) => { slotRefs.current[slotIndex] = element; }}
                        tabIndex={0}
                        role="button"
                        aria-label={
                            filter.item_name
                                ? `Filter ${slotIndex + 1}: ${itemLabel(filter.item_name)} (${filter.quantity})`
                                : `Configure filter ${slotIndex + 1}`
                        }
                        onClick={(e) => handleSlotClick(slotIndex, e.currentTarget)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSlotClick(slotIndex, e.currentTarget);
                            } else if ((e.key === 'Delete' || e.key === 'Backspace') && filter.item_name) {
                                e.preventDefault();
                                removeFilter(slotIndex);
                            }
                        }}
                        sx={insetSlotSx({ open: activeSlotIndex === slotIndex })}
                    >
                        {filter.item_name ? (
                            <>
                                <FactorioIcon name={filter.item_name} size={24} alt="" titled />
                                {/* the count is in the slot's name too */}
                                <Box aria-hidden sx={SLOT_COUNT_SX}>{filter.quantity}</Box>
                            </>
                        ) : (
                            <Add sx={{ fontSize: 16, color: 'text.secondary' }} />
                        )}
                    </Box>
                    {/* Remove button */}
                    {filter.item_name && (
                        <SlotRemoveButton slotNumber={slotIndex + 1} itemName={itemLabel(filter.item_name)} onClick={() => removeFilter(slotIndex)} />
                    )}
                </Box>
            ))}

            {/* Add new filter button */}
            {showAddButton && (
                <Box
                    ref={addButtonRef}
                    tabIndex={0}
                    role="button"
                    aria-label="Add new filter"
                    onClick={(e) => handleAddClick(e.currentTarget)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleAddClick(e.currentTarget);
                        }
                    }}
                    sx={insetSlotSx({ open: activeSlotIndex === filters.length })}
                >
                    <Add sx={{ fontSize: 16, color: 'text.secondary' }} />
                </Box>
            )}

            {/* Show count if there are more filters than slots */}
            {filters.length > maxSlots && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    +{filters.length - maxSlots} more
                </Typography>
            )}

            {/* Item selector popover */}
            <Popover
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
            >
                <Box sx={{ p: 2, width: 300 }}>
                    <ItemSelector
                        value={pendingItem}
                        options={itemNames}
                        onChange={handleItemSelect}
                        label="Select Item"
                        minWidth={268}
                    />
                    <TextField
                        label={quantityLabel}
                        type="number"
                        value={pendingQuantity}
                        onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                        inputProps={{ min: 1 }}
                        size="small"
                        fullWidth
                        sx={{ mt: 2 }}
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 1 }}>
                        <Button onClick={handleClose} color='inherit'>
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleConfirm}
                            disabled={!pendingItem}
                            color='secondary'
                        >
                            Confirm
                        </Button>
                    </Box>
                </Box>
            </Popover>
        </Box>
    );
}
