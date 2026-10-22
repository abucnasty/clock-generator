import { Block, ContentCopy, DeleteOutline, FilterAlt } from '@mui/icons-material';
import { Box, Button, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import { BLOCK_MARKERS, containerSlotCount, isBlockMarker, paintSlotFilters, shownSlotFilter, slotRange } from '../utils/containerSlotFilters';
import type { SlotContainerFormData, SlotFilterFormData } from '../utils/configForm/formData';
import { entityLabel } from '../utils/entityLabel';
import { FactorioIcon } from './FactorioIcon';
import { FilterItemPicker } from './FilterItemPicker';
import { ItemSelector } from './ItemSelector';
import { insetSlotSx } from './insetSlot';

interface Props {
    chest: SlotContainerFormData;
    itemNames: string[];
    onChange: (filters: SlotFilterFormData[]) => void;
}

interface Stroke { from: number; to: number; item: string }
const NO_FILTERS: SlotFilterFormData[] = [];

/** Inventory-shaped filters, with Factorio copy/paste gestures and a reusable item brush. */
export function ContainerFilterGrid({ chest, itemNames, onChange }: Props) {
    const filters = chest.slot_filters ?? NO_FILTERS;
    const count = containerSlotCount(chest);
    const filterOptions = [...new Set([...BLOCK_MARKERS, ...itemNames])];
    const blockPriority = { label: 'Block slots', ids: [...BLOCK_MARKERS] };
    const name = entityLabel('chest', chest.id);
    const { itemLabel } = useGameNames();
    const announce = useAnnounce();
    const helpId = useId();
    const [brush, setBrush] = useState<string | null>(null);
    const [focusSlot, setFocusSlot] = useState(1);
    const [columns, setColumns] = useState(10);
    const [picker, setPicker] = useState<{ slot: number; anchor: HTMLElement } | null>(null);
    const [stroke, setStroke] = useState<Stroke | null>(null);
    const grid = useRef<HTMLDivElement>(null);
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);
    const pointerType = useRef('');
    const visibleFilters = stroke ? paintSlotFilters(filters, slotRange(stroke.from, stroke.to), stroke.item) : filters;
    const bySlot = new Map(visibleFilters.map(filter => [filter.slot, shownSlotFilter(filter)]));
    const outside = filters.filter(filter => filter.slot < 1 || filter.slot > count || !Number.isInteger(filter.slot));
    const filled = Array.from({ length: count }, (_, i) => i + 1).filter(slot => bySlot.get(slot));
    const blocked = visibleFilters.filter(filter => filter.blocked && filter.slot >= 1 && filter.slot <= count).length;
    const currentSlot = Math.min(focusSlot, count);
    const rowStart = Math.floor((currentSlot - 1) / columns) * columns + 1;

    useEffect(() => {
        const element = grid.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setColumns(getComputedStyle(element).gridTemplateColumns.split(' ').length));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!stroke) return;
        const finish = () => {
            onChange(paintSlotFilters(filters, slotRange(stroke.from, stroke.to), stroke.item));
            announce(`Filtered slots ${Math.min(stroke.from, stroke.to)} to ${Math.max(stroke.from, stroke.to)} to ${itemLabel(stroke.item)}, ${name}.`);
            setStroke(null);
        };
        const cancel = () => setStroke(null);
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', escape);
        window.addEventListener('blur', cancel);
        return () => {
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', escape);
            window.removeEventListener('blur', cancel);
        };
    }, [stroke, filters, onChange, announce, itemLabel, name]);

    const paint = (slots: number[], item: string | null = brush) => {
        onChange(paintSlotFilters(filters, slots, item));
        announce(`${item ? `Set ${itemLabel(item)} on` : 'Cleared'} ${slots.length} ${slots.length === 1 ? 'slot' : 'slots'}, ${name}.`);
    };
    const copy = (slot: number) => {
        const item = bySlot.get(slot) || null;
        setBrush(item);
        announce(item ? `Copied ${itemLabel(item)}. Click or drag to apply it to other slots.` : 'This slot has no filter. Choose an item first.');
    };
    const paste = (slot: number) => {
        if (brush) paint([slot]);
        else announce('Choose a filter item, or Shift + right-click a filtered slot to copy it first.');
    };

    return <Box role="group" aria-label={`Filtered slots, ${name}`} sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1,
        containerType: 'inline-size', containerName: 'inventory-filters' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="subtitle2">Filtered slots</Typography>
            <Typography variant="caption" color="text.secondary">{filled.length} / {count} filtered{blocked > 0 ? ` · ${blocked} blocked` : ''} · Unfiltered slots accept any item</Typography>
        </Box>
        <Typography id={helpId} variant="caption" color="text.secondary">
            Choose an item, then click or drag across slots. Shift + right-click copies; Shift + click pastes. Right-click or Delete clears.
        </Typography>
        <Typography variant="caption" color="text.secondary">
            No item and Deconstruction planner block a slot so inserters cannot fill it.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <ItemSelector value={brush} options={filterOptions} priority={blockPriority} label="Filter item" inputAriaLabel={`Filter item, ${name}`}
                onChange={setBrush} minWidth={0} sx={{ flex: '1 1 180px', maxWidth: 300, minWidth: 0 }} />
            <Button size="small" color="inherit" disabled={!brush} onClick={() => paint(slotRange(rowStart, Math.min(rowStart + columns - 1, count)))}>
                Fill row {Math.floor((currentSlot - 1) / columns) + 1}
            </Button>
            <Button size="small" color="inherit" disabled={!brush || filled.length === count}
                onClick={() => paint(slotRange(1, count).filter(slot => !bySlot.get(slot)))}>Fill unfiltered slots</Button>
            <Button size="small" color="inherit" startIcon={<Block />} disabled={filled.length === count}
                onClick={() => paint(slotRange(1, count).filter(slot => !bySlot.get(slot)), isBlockMarker(brush) ? brush : BLOCK_MARKERS[0])}>
                Block unfiltered slots
            </Button>
            <Button size="small" color="inherit" startIcon={<DeleteOutline />} disabled={filters.length === 0}
                onClick={() => { onChange([]); announce(`Cleared all slot filters, ${name}.`); }}>Clear filters</Button>
        </Box>
        <Box ref={grid} role="group" aria-label={`${name} inventory filters`} aria-describedby={helpId}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 0.5,
                '@container inventory-filters (max-width: 360px)': { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', maxWidth: 200 },
                width: '100%', maxWidth: 396, p: 0.5, boxSizing: 'border-box', bgcolor: 'action.hover',
                border: 1, borderColor: 'divider', borderRadius: 0.5 }}>
            {Array.from({ length: count }, (_, index) => {
                const slot = index + 1;
                const item = bySlot.get(slot);
                const isBlocked = isBlockMarker(item);
                const description = isBlocked ? `Blocked (${itemLabel(item!)})` : item ? `${itemLabel(item)} filter` : 'Unfiltered';
                const base = insetSlotSx({ open: picker?.slot === slot || Boolean(stroke && slot >= Math.min(stroke.from, stroke.to) && slot <= Math.max(stroke.from, stroke.to)) });
                return <Tooltip key={slot} disableInteractive enterDelay={600} disableHoverListener={Boolean(stroke)}
                    title={`Slot ${slot}: ${isBlocked ? `${itemLabel(item!)} blocks this slot; inserters cannot fill it` : item ? `${itemLabel(item)} only` : 'Any item'}. Shift + right-click to copy; right-click to clear.`}>
                    <ButtonBase ref={element => { buttons.current[index] = element; }}
                        aria-label={`Slot ${slot}: ${description}`}
                        aria-haspopup={!brush ? 'dialog' : undefined} aria-keyshortcuts="Control+c Meta+c Control+v Meta+v Delete"
                        tabIndex={slot === currentSlot ? 0 : -1} onFocus={() => setFocusSlot(slot)}
                        onPointerDown={event => {
                            pointerType.current = event.pointerType;
                            if (event.button === 1) event.preventDefault();
                            if (event.button === 0 && brush && event.pointerType === 'mouse') {
                                event.preventDefault();
                                event.currentTarget.focus();
                                setStroke({ from: slot, to: slot, item: brush });
                            }
                        }}
                        onPointerEnter={event => { if (stroke && event.buttons === 1) setStroke({ ...stroke, to: slot }); }}
                        onClick={event => {
                            if (event.shiftKey && !brush) { paste(slot); return; }
                            if (brush) { if (event.detail === 0 || pointerType.current !== 'mouse') paste(slot); }
                            else setPicker({ slot, anchor: event.currentTarget });
                        }}
                        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); setPicker({ slot, anchor: event.currentTarget }); } }}
                        onContextMenu={event => { event.preventDefault(); if (event.shiftKey) copy(slot); else paint([slot], null); }}
                        onKeyDown={event => {
                            if ((event.ctrlKey || event.metaKey) && ['c', 'v'].includes(event.key.toLowerCase())) {
                                event.preventDefault();
                                if (event.key.toLowerCase() === 'c') copy(slot); else paste(slot);
                            } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); paint([slot], null); }
                            else {
                                const next = { ArrowLeft: slot - 1, ArrowRight: slot + 1, ArrowUp: slot - columns, ArrowDown: slot + columns,
                                    Home: Math.floor(index / columns) * columns + 1, End: Math.min(Math.floor(index / columns) * columns + columns, count) }[event.key];
                                if (next !== undefined) { event.preventDefault(); buttons.current[Math.max(1, Math.min(count, next)) - 1]?.focus(); }
                            }
                        }}
                        sx={[...(Array.isArray(base) ? base : [base]), { width: '100%', height: 'auto', aspectRatio: '1', touchAction: 'pan-y',
                            userSelect: 'none', bgcolor: item ? 'action.selected' : undefined,
                            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1, zIndex: 1 } }]}>
                        {item && <>
                            <FactorioIcon name={item} size={24} alt="" />
                            {isBlocked && item !== BLOCK_MARKERS[0] && <Block aria-hidden sx={{ position: 'absolute', top: 1, left: 1, fontSize: 10, color: 'text.secondary' }} />}
                            {!isBlocked && <FilterAlt aria-hidden sx={{ position: 'absolute', top: 1, left: 1, fontSize: 10, color: 'text.secondary' }} />}
                        </>}
                        <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 0, right: 2, fontSize: 9, lineHeight: 1.2, color: 'text.secondary' }}>{slot}</Box>
                    </ButtonBase>
                </Tooltip>;
            })}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ContentCopy sx={{ fontSize: 14 }} /> Arrow keys move between slots. Ctrl/Cmd + C copies; Ctrl/Cmd + V pastes.
        </Typography>
        {outside.length > 0 && <Box>
            <Typography variant="body2">Some filters are outside this inventory. Change the quality or remove them.</Typography>
            {outside.map((filter, index) => <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="caption">Slot {filter.slot}: {itemLabel(shownSlotFilter(filter))}</Typography>
                <Button size="small" color="inherit" onClick={() => onChange(filters.filter(row => row !== filter))}>Remove filter for slot {filter.slot}</Button>
            </Box>)}
        </Box>}
        {picker && <FilterItemPicker anchor={picker.anchor} label={`Choose a slot filter, ${name}`} initialItem={bySlot.get(picker.slot)}
            itemNames={filterOptions} priority={blockPriority} onClose={() => setPicker(null)} onClear={bySlot.get(picker.slot) ? () => { paint([picker.slot], null); setPicker(null); } : undefined}
            onApply={item => { setBrush(item); paint([picker.slot], item); setPicker(null); }} />}
    </Box>;
}
