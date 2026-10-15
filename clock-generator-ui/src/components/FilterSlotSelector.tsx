import { Add } from '@mui/icons-material';
import { Box, Typography, Popover } from '@mui/material';
import { useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { AUTO_BADGE_SX, insetSlotSx } from './insetSlot';
import { SlotRemoveButton } from './SlotRemoveButton';

interface FilterSlotSelectorProps {
    /** Explicit filters set by the user */
    filters?: string[];
    /** Inferred/auto-populated filters from source/sink analysis */
    inferredFilters?: string[];
    /** Available item names for selection */
    itemNames: string[];
    /** Callback when a filter is updated */
    onFilterChange: (slotIndex: number, item: string) => void;
    /** Callback when a filter is removed */
    onRemoveFilter: (slotIndex: number) => void;
    /** The most filters an inserter takes */
    maxSlots?: number;
}

export function FilterSlotSelector({
    filters = [],
    inferredFilters = [],
    itemNames,
    onFilterChange,
    onRemoveFilter,
    maxSlots = 5,
}: FilterSlotSelectorProps) {
    const hasExplicitFilters = filters.length > 0;
    const shouldShowInferred = !hasExplicitFilters && inferredFilters.length > 0;
    const { itemLabel } = useGameNames();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
    const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

    // the set slots (the player's, else the auto ones), then one "+" while there is room for another
    const setCount = Math.min(maxSlots, hasExplicitFilters ? filters.length : shouldShowInferred ? inferredFilters.length : 0);
    const slotCount = Math.min(maxSlots, setCount + 1);

    const handleSlotClick = (slotIndex: number, element: HTMLElement) => {
        setAnchorEl(element);
        setActiveSlotIndex(slotIndex);
    };

    const handleClose = () => {
        setAnchorEl(null);
        setActiveSlotIndex(null);
    };

    const handleItemSelect = (item: string | null) => {
        if (activeSlotIndex !== null && item) {
            onFilterChange(activeSlotIndex, item);
        }
        handleClose();
    };

    const getCurrentValue = () => {
        if (activeSlotIndex === null) return null;
        return filters[activeSlotIndex] || inferredFilters[activeSlotIndex] || null;
    };

    const removeFilter = (slotIndex: number) => {
        onRemoveFilter(slotIndex);
        // the remove button goes with the filter, and the slots after it move up: the focus goes to the slot in its
        // place, which is the "+" when it was the last
        slotRefs.current[slotIndex]?.focus();
    };

    return (
        // the gap leaves room for a remove button between two slots, clear of the next one
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 1.5, alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
                Filters:
            </Typography>

            {Array.from({ length: slotCount }).map((_, slotIndex) => {
                // Determine what to display in this slot
                const explicitFilter = filters[slotIndex];
                const inferredFilter = shouldShowInferred ? inferredFilters[slotIndex] : undefined;
                const displayFilter = explicitFilter || inferredFilter;
                const isAutoAssigned = !explicitFilter && !!inferredFilter;

                return (
                    // the slot and its remove button are siblings: a button inside a button cannot be reached or named
                    <Box key={slotIndex} sx={{ position: 'relative' }}>
                        <Box
                            ref={(element: HTMLDivElement | null) => { slotRefs.current[slotIndex] = element; }}
                            tabIndex={0}
                            role="button"
                            aria-label={
                                displayFilter
                                    ? `Filter ${slotIndex + 1}: ${itemLabel(displayFilter)}${isAutoAssigned ? ' (auto)' : ''}`
                                    : `Add filter ${slotIndex + 1}`
                            }
                            onClick={(e) => handleSlotClick(slotIndex, e.currentTarget)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSlotClick(slotIndex, e.currentTarget);
                                } else if ((e.key === 'Delete' || e.key === 'Backspace') && displayFilter) {
                                    e.preventDefault();
                                    removeFilter(slotIndex);
                                }
                            }}
                            sx={insetSlotSx({ auto: isAutoAssigned, open: activeSlotIndex === slotIndex })}
                        >
                            {displayFilter ? (
                                <>
                                    <FactorioIcon name={displayFilter} size={24} alt="" titled />
                                    {/* the word too, so an auto filter is told apart by more than its dashed border */}
                                    {isAutoAssigned && <Box aria-hidden sx={AUTO_BADGE_SX}>AUTO</Box>}
                                </>
                            ) : (
                                <Add sx={{ fontSize: 16, color: 'text.secondary' }} />
                            )}
                        </Box>
                        {displayFilter && (
                            <SlotRemoveButton slotNumber={slotIndex + 1} itemName={itemLabel(displayFilter)} onClick={() => removeFilter(slotIndex)} />
                        )}
                    </Box>
                );
            })}

            {/* Show count if there are more inferred items than slots */}
            {shouldShowInferred && inferredFilters.length > maxSlots && (
                <Typography variant="caption" color="text.secondary">
                    +{inferredFilters.length - maxSlots} more
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
                        value={getCurrentValue()}
                        options={itemNames}
                        onChange={handleItemSelect}
                        label="Select Item"
                        minWidth={268}
                    />
                </Box>
            </Popover>
        </Box>
    );
}
