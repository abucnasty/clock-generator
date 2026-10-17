import { Box, Typography, ButtonBase, Tooltip } from '@mui/material';
import { useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { FilterItemPicker } from './FilterItemPicker';
import { insetSlotSx } from './insetSlot';

export interface ChestFilterSlot {
    item_name: string;
    quantity: number;
}

const slotStyles = (open: boolean, width: number | string = 36) => {
    const base = insetSlotSx({ open });
    return [...(Array.isArray(base) ? base : [base]), { width, height: 36 }];
};

interface ChestFilterSlotSelectorProps {
    filters: ChestFilterSlot[];
    itemNames: string[];
    /** Replaces a slot, or appends when slotIndex is filters.length. */
    onFilterChange: (slotIndex: number, filter: ChestFilterSlot) => void;
    onRemoveFilter: (slotIndex: number) => void;
    maxSlots?: number;
    quantityLabel?: string;
    canAddMore?: boolean;
}

export function ChestFilterSlotSelector({ filters, itemNames, onFilterChange, onRemoveFilter,
    maxSlots = 10, quantityLabel = 'Count', canAddMore = true,
}: ChestFilterSlotSelectorProps) {
    const { itemLabel } = useGameNames();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [active, setActive] = useState<number | null>(null);
    const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
    // An existing empty filter already offers the next choice; otherwise reveal one new slot.
    const hasEmptySlot = filters.some(filter => !filter.item_name);
    const slots = Math.min(maxSlots, filters.length + (canAddMore && !hasEmptySlot ? 1 : 0));
    const openSlot = (index: number, element: HTMLElement) => {
        // Empty placeholders all append to the next real slot, so saved filters never contain holes.
        const slot = Math.min(index, filters.length);
        setActive(slot);
        setAnchor(element);
    };
    const close = () => { setAnchor(null); setActive(null); };
    const clear = (index: number) => {
        onRemoveFilter(index);
        close();
        requestAnimationFrame(() => slotRefs.current[Math.min(index, Math.max(0, filters.length - 2))]?.focus());
    };
    return <>
        <Box role="group" aria-label="Infinity chest filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
            {Array.from({ length: slots }, (_, index) => {
                const filter = filters[index];
                const label = filter?.item_name ? `Filter ${index + 1}: ${itemLabel(filter.item_name)} (${filter.quantity})` : `Configure filter ${index + 1}`;
                return <Tooltip key={index} title={filter?.item_name ? `${itemLabel(filter.item_name)} × ${filter.quantity}. Right-click to clear.` : 'Choose an item'}>
                    <ButtonBase ref={element => { slotRefs.current[index] = element; }} aria-label={label} aria-haspopup="dialog"
                        onClick={event => openSlot(index, event.currentTarget)}
                        onContextMenu={event => { event.preventDefault(); if (filter?.item_name) clear(index); }}
                        onKeyDown={event => { if ((event.key === 'Delete' || event.key === 'Backspace') && filter?.item_name) { event.preventDefault(); clear(index); } }}
                        sx={slotStyles(Boolean(anchor) && anchor === slotRefs.current[index])}>
                        {filter?.item_name && <>
                            <FactorioIcon name={filter.item_name} size={26} alt="" />
                            <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 0, right: 2, fontSize: 11, fontWeight: 700, lineHeight: 1.1, color: '#fff', textShadow: '0 1px 2px #000, 1px 0 2px #000, -1px 0 2px #000' }}>{filter.quantity}</Box>
                        </>}
                    </ButtonBase>
                </Tooltip>;
            })}
        </Box>
        {filters.length > maxSlots && <Typography variant="caption" color="text.secondary">+{filters.length - maxSlots} more</Typography>}
        {anchor && active !== null && <FilterItemPicker anchor={anchor} label="Choose a chest filter"
            initialItem={filters[active]?.item_name} initialQuantity={filters[active]?.quantity ?? 1}
            quantityLabel={quantityLabel} itemNames={itemNames} onClose={close}
            onClear={filters[active]?.item_name ? () => clear(active) : undefined}
            onApply={(item, quantity) => { onFilterChange(active, { item_name: item, quantity }); close(); }} />}

    </>;
}
