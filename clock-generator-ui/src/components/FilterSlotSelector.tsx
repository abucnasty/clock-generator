import { Add, Close } from '@mui/icons-material';
import { Box, IconButton, Typography, Popover } from '@mui/material';
import { useRef, useState } from 'react';
import { removeFilterName } from '../utils/a11yLabels';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';

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
    /** Number of filter slots to display */
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
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
    const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

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
        // the remove button goes with the filter; the slot stays, so the keyboard focus goes back to it
        slotRefs.current[slotIndex]?.focus();
    };

    return (
        // the gap leaves room for a remove button between two slots, clear of the next one
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                Filters:
            </Typography>

            {/* Render filter slots */}
            {Array.from({ length: maxSlots }).map((_, slotIndex) => {
                // Determine what to display in this slot
                const explicitFilter = filters[slotIndex];
                const inferredFilter = shouldShowInferred ? inferredFilters[slotIndex] : undefined;
                const displayFilter = explicitFilter || inferredFilter;
                const isAutoAssigned = !explicitFilter && !!inferredFilter;

                return (
                    // the slot and its remove button are siblings: a button inside a button cannot be reached or named
                    <Box key={slotIndex} sx={{ position: 'relative', m: 0.3 }}>
                        <Box
                            ref={(element: HTMLDivElement | null) => { slotRefs.current[slotIndex] = element; }}
                            tabIndex={0}
                            role="button"
                            aria-label={
                                displayFilter
                                    ? `Filter ${slotIndex + 1}: ${displayFilter}${isAutoAssigned ? ' (auto)' : ''}`
                                    : `Add filter ${slotIndex + 1}`
                            }
                            onClick={(e) => handleSlotClick(slotIndex, e.currentTarget)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSlotClick(slotIndex, e.currentTarget);
                                } else if (e.key === 'Delete' && displayFilter) {
                                    e.preventDefault();
                                    onRemoveFilter(slotIndex);
                                }
                            }}
                            sx={{
                                width: 30,
                                height: 30,
                                border: '2px solid',
                                // dashed, so an auto filter is told apart by more than its colour
                                borderStyle: isAutoAssigned ? 'dashed' : 'solid',
                                borderColor: displayFilter
                                    ? isAutoAssigned
                                        ? 'secondary.main'
                                        : 'primary.main'
                                    : 'divider',
                                borderRadius: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                bgcolor: 'background.paper',
                                position: 'relative',
                                opacity: isAutoAssigned ? 0.85 : 1,
                                // not the outline: the focus ring appears at once, in its place
                                transition: 'border-color 0.2s, background-color 0.2s, opacity 0.2s, transform 0.2s',
                                // the pointer tints the slot; focus is the theme's ring alone, so an empty slot does
                                // not take a filled slot's orange border when focused
                                '&:hover': {
                                    borderColor: displayFilter
                                        ? isAutoAssigned
                                            ? 'secondary.dark'
                                            : 'primary.light'
                                        : 'primary.light',
                                    bgcolor: 'action.hover',
                                    opacity: 1,
                                    transform: 'scale(1.05)',
                                },
                            }}
                        >
                            {displayFilter ? (
                                <>
                                    <FactorioIcon name={displayFilter} size={22} />
                                    {/* Show auto badge for inferred filters */}
                                    {isAutoAssigned && (
                                        <Box
                                            sx={{
                                                position: 'absolute',
                                                bottom: -8,
                                                left: '50%',
                                                transform: 'translateX(-50%)',
                                                bgcolor: 'common.black',
                                                color: 'secondary.light',
                                                fontSize: '0.7rem',
                                                fontWeight: 'bold',
                                                px: 0.5,
                                                py: 0.25,
                                                borderRadius: 0.5,
                                                lineHeight: 1,
                                            }}
                                        >
                                            AUTO
                                        </Box>
                                    )}
                                </>
                            ) : (
                                <Add sx={{ fontSize: 16, color: 'text.disabled' }} />
                            )}
                        </Box>
                        {/* Show remove button for all filters (explicit and auto-assigned) */}
                        {displayFilter && (
                            <IconButton
                                size="small"
                                aria-label={removeFilterName(slotIndex + 1, displayFilter)}
                                onClick={() => removeFilter(slotIndex)}
                                sx={{
                                    position: 'absolute',
                                    // over the slot's corner by 6px at most, so 24x24 of the 30px slot stays its own to click
                                    top: -10,
                                    right: -18,
                                    width: 24,
                                    height: 24,
                                    bgcolor: 'error.main',
                                    '&:hover': { bgcolor: 'error.dark' },
                                }}
                            >
                                <Close sx={{ fontSize: 14, color: 'white' }} />
                            </IconButton>
                        )}
                    </Box>
                );
            })}

            {/* Show count if there are more inferred items than slots */}
            {shouldShowInferred && inferredFilters.length > maxSlots && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
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
