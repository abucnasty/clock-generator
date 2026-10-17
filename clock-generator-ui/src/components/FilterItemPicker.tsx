import { Check, Close, DeleteOutline, Search } from '@mui/icons-material';
import { Box, Typography, Popover, TextField, Button, ButtonBase, IconButton, InputAdornment, Tab, Tabs, Tooltip } from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { searchIds } from '../utils/gameNames';
import recipePickerGroups from '../data/recipePickerGroups.json';
import { insetSlotSx } from './insetSlot';
// Snapshot of the game's category/subgroup order; unfamiliar items are offered under Other.
import itemPickerGroups from '../data/itemPickerGroups.json';

interface FilterItemPickerProps {
    anchor: HTMLElement;
    label: string;
    initialItem?: string | null;
    initialQuantity?: number;
    quantityLabel?: string;
    itemNames: string[];
    priority?: { label: string; ids: string[] };
    onClose: () => void;
    onApply: (item: string, quantity: number) => void;
    onClear?: () => void;
    clearLabel?: string;
    kind?: 'item' | 'recipe';
    searchOnlyIds?: readonly string[];
    allowCustom?: boolean;
}

export function FilterItemPicker({ anchor, label, initialItem, initialQuantity = 1, quantityLabel, itemNames, priority, onClose: close, onApply, onClear, clearLabel = 'Clear slot', kind = 'item', searchOnlyIds = [], allowCustom = false }: FilterItemPickerProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    const nameOf = kind === 'recipe' ? recipeLabel : itemLabel;
    const groupData = kind === 'recipe' ? recipePickerGroups : itemPickerGroups;
    const searchRef = useRef<HTMLInputElement>(null);
    const [item, setItem] = useState(initialItem ?? null);
    const [quantity, setQuantity] = useState(String(initialQuantity));
    const [query, setQuery] = useState('');
    const groups = useMemo(() => {
        const offered = new Set(itemNames);
        const known = new Set(groupData.flatMap(group => group.items));
        const catalog = groupData.map(group => ({ ...group, items: [...group.items.filter(name => offered.has(name)), ...(group.id === 'other' ? itemNames.filter(name => !known.has(name)) : [])] })).filter(group => group.items.length > 0);
        const suggested = priority?.ids.filter(name => offered.has(name)) ?? [];
        return suggested.length ? [{ id: 'suggested', label: priority!.label, icon: suggested[0], items: suggested }, ...catalog] : catalog;
    }, [itemNames, priority, groupData]);
    const [category, setCategory] = useState(() => groups.find(group => group.items.includes(initialItem ?? ''))?.id ?? groups[0]?.id ?? 'other');
    const shownItems = useMemo(() => {
        const search = query.trim().toLocaleLowerCase();
        const candidates = search ? [...new Set([...groups.flatMap(group => group.items), ...searchOnlyIds])] : groups.find(group => group.id === category)?.items ?? groups[0]?.items ?? [];
        return search ? searchIds(query, candidates, nameOf) : candidates;
    }, [groups, category, nameOf, query, searchOnlyIds]);
    const validQuantity = Number.isSafeInteger(Number(quantity)) && Number(quantity) >= 1;
    const apply = () => { if (item && (!quantityLabel || validQuantity)) onApply(item, Number(quantity)); };
    const slotStyles = (open: boolean, width: number | string = 36) => {
        const base = insetSlotSx({ open });
        return [...(Array.isArray(base) ? base : [base]), { width, height: 36 }];
    };
    return (
        <Popover open anchorEl={anchor} onClose={close} transitionDuration={{ enter: 120, exit: 80 }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { width: 420, maxWidth: 'calc(100vw - 24px)' } }, transition: { onEntered: () => searchRef.current?.focus() } }}>
            <Box sx={{ p: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{kind === 'recipe' ? 'Choose a recipe' : clearLabel === 'Clear item' ? 'Choose an item' : 'Set the filter'}</Typography>
                    <IconButton size="small" aria-label={kind === 'recipe' ? 'Cancel recipe selection' : 'Cancel filter editing'} onClick={close}><Close fontSize="small" /></IconButton>
                </Box>
                <TextField inputRef={searchRef} autoFocus fullWidth size="small" label={kind === 'recipe' ? 'Search recipes' : 'Search items'} value={query} onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => { if (kind === 'recipe' && event.key === 'Enter' && !event.nativeEvent.isComposing && query.trim() && shownItems[0]) { event.preventDefault(); onApply(shownItems[0], 1); } }}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
                <Tabs value={query.trim() ? false : groups.some(group => group.id === category) ? category : groups[0]?.id ?? false}
                    onChange={(_, value: string) => { setCategory(value); setQuery(''); }} aria-label={kind === 'recipe' ? 'Recipe categories' : 'Item categories'}
                    variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mt: 1, minHeight: 44, borderBottom: 1, borderColor: 'divider' }}>
                    {groups.map(group => <Tab key={group.id} value={group.id} aria-label={group.label}
                        label={<Tooltip title={group.label}><Box component="span" sx={{ display: 'flex' }}><FactorioIcon name={group.icon} size={28} alt="" /></Box></Tooltip>}
                        sx={{ minWidth: 46, p: 0.75, minHeight: 44 }} />)}
                </Tabs>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    {query.trim() ? 'Search results across all categories' : groups.find(group => group.id === category)?.label ?? groups[0]?.label}
                </Typography>
                <Box role="group" aria-label={kind === 'recipe' ? 'Choose a recipe' : 'Choose an item'} sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 0.5, maxHeight: 250, overflowY: 'auto', p: 0.5, bgcolor: 'action.hover' }}>
                    {shownItems.map(name => <Tooltip key={name} title={nameOf(name)}>
                        <ButtonBase aria-label={nameOf(name)} aria-pressed={item === name} onClick={() => setItem(name)}
                            sx={slotStyles(item === name, '100%')}>
                            <FactorioIcon name={name} size={28} alt="" fallback={<Typography variant="caption">{nameOf(name).slice(0, 2)}</Typography>} />
                        </ButtonBase>
                    </Tooltip>)}
                    {shownItems.length === 0 && <Typography variant="body2" sx={{ gridColumn: '1 / -1', p: 1 }}>{kind === 'recipe' ? 'No matching recipes.' : 'No matching items.'}</Typography>}
                </Box>
                {kind === 'recipe' && allowCustom && query.trim() && shownItems.length === 0 && <Button size="small" onClick={() => onApply(query.trim(), 1)}>Use recipe ID “{query.trim()}”</Button>}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1.5, minWidth: 0 }}>
                    {item && <FactorioIcon name={item} size={28} alt="" />}
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item ? nameOf(item) : kind === 'recipe' ? 'Choose a recipe above' : 'Choose an item above'}</Typography>
                    {quantityLabel && <TextField label={quantityLabel} type="number" size="small" value={quantity} onChange={event => setQuantity(event.target.value)}
                        error={!validQuantity} helperText={!validQuantity ? 'Whole number, at least 1' : undefined}
                        slotProps={{ htmlInput: { min: 1, step: 1 } }} sx={{ width: 120, flexShrink: 0 }}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />}
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Button color="inherit" startIcon={<DeleteOutline />} disabled={!onClear}
                        onClick={onClear}>{clearLabel}</Button>
                    <Button variant="contained" color="secondary" startIcon={<Check />} onClick={apply} disabled={!item || !validQuantity}>Apply</Button>
                </Box>
            </Box>
        </Popover>
    );
}
