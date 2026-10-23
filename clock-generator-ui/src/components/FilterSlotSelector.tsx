import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { usesAutomaticFilters } from '../utils/inserterFilters';
import { FactorioIcon } from './FactorioIcon';
import { FilterItemPicker } from './FilterItemPicker';
import { AUTO_BADGE_SX, insetSlotSx } from './insetSlot';

interface FilterSlotSelectorProps {
    label?: string;
    /** Keep the label in normal flow in tightly wrapped rows. */
    compact?: boolean;
    priority?: { label: string; ids: string[] };
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


export function FilterSlotSelector({ priority, filters,
    inferredFilters = [], itemNames, onFilterChange, onRemoveFilter, maxSlots = 5,
}: FilterSlotSelectorProps) {
    const { itemLabel } = useGameNames();
    const automatic = usesAutomaticFilters(filters);
    const displayed = automatic ? inferredFilters.slice(0, maxSlots) : filters!;
    // Older imported configurations remain editable, without offering additional slots beyond the new limit.
    const slotCount = Math.max(maxSlots, displayed.length);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [active, setActive] = useState<number | null>(null);
    const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const close = () => { setAnchor(null); setActive(null); };
    const clear = (index: number) => {
        onRemoveFilter(index);
        close();
        requestAnimationFrame(() => slotRefs.current[Math.min(index, Math.max(0, displayed.length - 1))]?.focus());
    };
    return <Box>
        <Box role="group" aria-label="Inserter filter slots" sx={{ display: 'flex', gap: 0.5, p: 0.5, pb: automatic && displayed.length ? 1.5 : 0.5, width: 'fit-content', bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 0.5, boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.25)' }}>
            {Array.from({ length: slotCount }, (_, index) => {
                const item = displayed[index];
                const auto = automatic && Boolean(item);
                const base = insetSlotSx({ auto, open: Boolean(anchor) && active === index });
                return <Tooltip key={index} title={item ? `${itemLabel(item)}${auto ? ' (automatic)' : ''}. Right-click to clear.${displayed.length === 1 ? ' Clearing the last filter returns to Automatic.' : ''}` : 'Choose an item'}>
                    <ButtonBase ref={element => { slotRefs.current[index] = element; }}
                        aria-label={item ? `Filter ${index + 1}: ${itemLabel(item)}${auto ? ' (auto)' : ''}` : `Add filter ${index + 1}`} aria-haspopup="dialog"
                        aria-keyshortcuts={item ? 'Delete' : undefined}
                        onClick={event => { setActive(index); setAnchor(event.currentTarget); }}
                        onContextMenu={event => { event.preventDefault(); if (item) clear(index); }}
                        onKeyDown={event => { if ((event.key === 'Delete' || event.key === 'Backspace') && item) { event.preventDefault(); clear(index); } }}
                        sx={[...(Array.isArray(base) ? base : [base]), { width: 36, height: 36 }]}>
                        {item && <FactorioIcon name={item} size={26} alt="" fallback={<Typography variant="caption">{itemLabel(item).slice(0, 2)}</Typography>} />}
                        {auto && <Box aria-hidden sx={AUTO_BADGE_SX}>AUTO</Box>}
                    </ButtonBase>
                </Tooltip>;
            })}
        </Box>
        {automatic && inferredFilters.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            No items inferred. Choose an item to set an explicit filter.
        </Typography>}
        {automatic && inferredFilters.length > maxSlots && <Typography variant="caption" color="text.secondary">+{inferredFilters.length - maxSlots} inferred items</Typography>}
        {anchor && active !== null && <FilterItemPicker anchor={anchor} label="Choose an inserter filter" initialItem={displayed[active]}
            itemNames={itemNames} priority={priority} onClose={close}
            onClear={displayed[active] ? () => clear(active) : undefined}
            onApply={item => { onFilterChange(active, item); close(); }} />}
    </Box>;
}
