import { Check, Close, DeleteOutline, Search } from '@mui/icons-material';
import { Box, Typography, Popover, TextField, Button, ButtonBase, IconButton, InputAdornment, Tab, Tabs, Tooltip } from '@mui/material';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { searchIds } from '../utils/gameNames';
import recipePickerGroups from '../data/recipePickerGroups.json';
import { insetSlotSx } from './insetSlot';
// Snapshot of the game's category/subgroup order; unfamiliar items are offered under Other.
import itemPickerGroups from '../data/itemPickerGroups.json';
// The crafting machines as the game groups them: a tab for each group, and a row for each of its subgroups.
import machinePickerGroups from '../data/machinePickerGroups.json';

interface FilterItemPickerProps {
    anchor: HTMLElement;
    label: string;
    initialItem?: string | null;
    initialQuantity?: number;
    quantityLabel?: string;
    minQuantity?: number;
    itemNames: string[];
    priority?: { label: string; ids: string[] };
    onClose: () => void;
    onApply: (item: string, quantity: number) => void;
    onClear?: () => void;
    clearLabel?: string;
    kind?: 'item' | 'recipe' | 'machine';
    searchOnlyIds?: readonly string[];
    allowCustom?: boolean;
    /** A line under the chosen entry's name (a machine's crafting speed) */
    detailOf?: (id: string) => string | undefined;
}

interface PickerGroup { id: string; label: string; icon: string; items: string[]; /** The game's subgroups, one row each */ rows?: string[][] }

const MACHINE_GROUPS: PickerGroup[] = machinePickerGroups.map(group => ({ ...group, items: group.rows.flat() }));

/** The words of the picker for what it picks */
const WORDS = {
    item: { title: 'Choose an item', cancel: 'Cancel filter editing', search: 'Search items', categories: 'Item categories', none: 'No matching items.', above: 'Choose an item above' },
    recipe: { title: 'Choose a recipe', cancel: 'Cancel recipe selection', search: 'Search recipes', categories: 'Recipe categories', none: 'No matching recipes.', above: 'Choose a recipe above' },
    machine: { title: 'Choose a machine', cancel: 'Cancel machine selection', search: 'Search machines', categories: 'Machine categories', none: 'No matching machines.', above: 'Choose a machine above' },
} as const;

export function FilterItemPicker({ anchor, label, initialItem, initialQuantity = 1, quantityLabel, minQuantity = 1, itemNames, priority, onClose: close, onApply, onClear, clearLabel = 'Clear slot', kind = 'item', searchOnlyIds = [], allowCustom = false, detailOf }: FilterItemPickerProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    const nameOf = kind === 'recipe' ? recipeLabel : itemLabel;
    const groupData: PickerGroup[] = kind === 'recipe' ? recipePickerGroups : kind === 'machine' ? MACHINE_GROUPS : itemPickerGroups;
    const words = WORDS[kind];
    const searchRef = useRef<HTMLInputElement>(null);
    const selectedRef = useRef<HTMLButtonElement>(null);
    const [item, setItem] = useState(initialItem ?? null);
    const [quantity, setQuantity] = useState(String(initialQuantity));
    const [query, setQuery] = useState('');
    const groups = useMemo(() => {
        const offeredNames = [...new Set(initialItem ? [initialItem, ...itemNames] : itemNames)];
        const offered = new Set(offeredNames);
        const known = new Set(groupData.flatMap(group => group.items));
        const rowsOffered = (group: PickerGroup) => group.rows?.map(row => row.filter(name => offered.has(name))).filter(row => row.length > 0);
        const catalog: PickerGroup[] = groupData.map(group => ({ ...group, rows: rowsOffered(group), items: [...group.items.filter(name => offered.has(name)), ...(group.id === 'other' ? offeredNames.filter(name => !known.has(name)) : [])] })).filter(group => group.items.length > 0);
        // a machine the groups do not know (a mod's) is in a group of its own
        const unknown = kind === 'machine' ? offeredNames.filter(name => !known.has(name)) : [];
        if (unknown.length > 0) catalog.push({ id: 'other', label: 'Other', icon: unknown[0], items: unknown, rows: [unknown] });
        const suggested = priority?.ids.filter(name => offered.has(name)) ?? [];
        return suggested.length ? [{ id: 'suggested', label: priority!.label, icon: suggested[0], items: suggested }, ...catalog] : catalog;
    }, [itemNames, initialItem, priority, groupData, kind]);
    const [category, setCategory] = useState(() => groups.find(group => group.items.includes(initialItem ?? ''))?.id ?? groups[0]?.id ?? 'other');
    const shownItems = useMemo(() => {
        const search = query.trim().toLocaleLowerCase();
        const candidates = search ? [...new Set([...groups.flatMap(group => group.items), ...searchOnlyIds])] : groups.find(group => group.id === category)?.items ?? groups[0]?.items ?? [];
        return search ? searchIds(query, candidates, nameOf) : candidates;
    }, [groups, category, nameOf, query, searchOnlyIds]);
    // the rows of the open group, one for each subgroup the game has; a search or a group without them is one row
    const shownRows = useMemo(() => {
        const open = query.trim() ? undefined : groups.find(group => group.id === category) ?? groups[0];
        return open?.rows ?? [shownItems];
    }, [groups, category, query, shownItems]);
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [shownItems]);
    const validQuantity = Number.isSafeInteger(Number(quantity)) && Number(quantity) >= minQuantity;
    const apply = () => { if (item && (!quantityLabel || validQuantity)) onApply(item, Number(quantity)); };
    const slotStyles = (open: boolean, width: number | string = 36) => {
        const base = insetSlotSx({ open });
        return [...(Array.isArray(base) ? base : [base]), { width, height: 36 }];
    };
    return (
        <Popover open anchorEl={anchor} onClose={close} transitionDuration={{ enter: 120, exit: 80 }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { width: 420, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto' } }, transition: { onEntered: () => {
                selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                searchRef.current?.focus({ preventScroll: true });
            } } }}>
            <Box sx={{ p: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{kind === 'item' && clearLabel !== 'Clear item' ? 'Set the filter' : words.title}</Typography>
                    <IconButton size="small" aria-label={words.cancel} onClick={close}><Close fontSize="small" /></IconButton>
                </Box>
                <TextField inputRef={searchRef} autoFocus fullWidth size="small" label={words.search} value={query} onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => { if (kind !== 'item' && event.key === 'Enter' && !event.nativeEvent.isComposing && query.trim() && shownItems[0]) { event.preventDefault(); onApply(shownItems[0], 1); } }}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
                <Tabs value={query.trim() ? false : groups.some(group => group.id === category) ? category : groups[0]?.id ?? false}
                    onChange={(_, value: string) => { setCategory(value); setQuery(''); }} aria-label={words.categories}
                    variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mt: 1, minHeight: 44, borderBottom: 1, borderColor: 'divider' }}>
                    {groups.map(group => <Tab key={group.id} value={group.id} aria-label={group.label}
                        label={<Tooltip title={group.label}><Box component="span" sx={{ display: 'flex' }}><FactorioIcon name={group.icon} size={28} alt="" /></Box></Tooltip>}
                        sx={{ minWidth: 46, p: 0.75, minHeight: 44 }} />)}
                </Tabs>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    {query.trim() ? 'Search results across all categories' : groups.find(group => group.id === category)?.label ?? groups[0]?.label}
                </Typography>
                <Box role="group" aria-label={words.title} sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 0.5, maxHeight: 'min(250px, max(72px, calc(100dvh - 310px)))', overflowY: 'auto', p: 0.5, bgcolor: 'action.hover' }}>
                    {shownRows.map((row, index) => <Fragment key={index}>
                        {index > 0 && <Box aria-hidden sx={{ gridColumn: '1 / -1', height: 6 }} />}
                        {row.map(name => <Tooltip key={name} title={nameOf(name)}>
                            <ButtonBase ref={item === name ? selectedRef : undefined} aria-label={nameOf(name)} aria-pressed={item === name} onClick={() => setItem(name)}
                                sx={slotStyles(item === name, '100%')}>
                                <FactorioIcon name={name} size={28} alt="" fallback={<Typography variant="caption">{nameOf(name).slice(0, 2)}</Typography>} />
                            </ButtonBase>
                        </Tooltip>)}
                    </Fragment>)}
                    {shownItems.length === 0 && <Typography variant="body2" sx={{ gridColumn: '1 / -1', p: 1 }}>{words.none}</Typography>}
                </Box>
                {kind === 'recipe' && allowCustom && query.trim() && shownItems.length === 0 && <Button size="small" onClick={() => onApply(query.trim(), 1)}>Use recipe ID “{query.trim()}”</Button>}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1.5, minWidth: 0 }}>
                    {item && <FactorioIcon name={item} size={28} alt="" />}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item ? nameOf(item) : words.above}</Typography>
                        {item && detailOf?.(item) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{detailOf(item)}</Typography>}
                    </Box>
                    {quantityLabel && <TextField label={quantityLabel} type="number" size="small" value={quantity} onChange={event => setQuantity(event.target.value)}
                        error={!validQuantity} helperText={!validQuantity ? 'Whole number, at least 1' : undefined}
                        slotProps={{ htmlInput: { min: minQuantity, step: 1 } }} sx={{ width: 120, flexShrink: 0 }}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />}
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    {kind === 'machine' && !onClear ? <span /> : <Button color="inherit" startIcon={<DeleteOutline />} disabled={!onClear}
                        onClick={onClear}>{clearLabel}</Button>}
                    <Button variant="contained" color="secondary" startIcon={<Check />} onClick={apply} disabled={!item || !validQuantity}>Apply</Button>
                </Box>
            </Box>
        </Popover>
    );
}
