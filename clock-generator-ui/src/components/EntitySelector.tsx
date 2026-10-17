import { Autocomplete, Box, IconButton, Menu, MenuItem, TextField, Tooltip, Typography, type SxProps, type Theme } from '@mui/material';
import { Check, FilterList } from '@mui/icons-material';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_ORDER, entitySelectorKey, entitySelectorLabel, filterEntityOptions, type EntitySelectorOption, type SelectorEntityType } from '../utils/entitySelector';
import { ContentIcons, RouteBadge } from './RouteIdentity';

/** One searchable picker and identity for route endpoints and timeline inspection. */
export function EntitySelector<T extends EntitySelectorOption>({ options, value, onChange, label, ariaLabel = label, helperText, error = false, readOnly = false, rowFirst = false, sx }: {
    options: readonly T[]; value: T | null | undefined; onChange(option: T): void;
    label: string; ariaLabel?: string; helperText?: ReactNode; error?: boolean; readOnly?: boolean; rowFirst?: boolean; sx?: SxProps<Theme>;
}) {
    const { itemLabel } = useGameNames();
    const [search, setSearch] = useState<string>();
    const [type, setType] = useState<SelectorEntityType | 'all'>('all');
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const input = useRef<HTMLInputElement>(null), filterButton = useRef<HTMLButtonElement>(null);
    const filterChanged = useRef(false);
    const menuId = useId();
    const types = useMemo(() => ENTITY_TYPE_ORDER.filter(type => options.some(option => option.type === type)), [options]);
    const activeType = type === 'all' || types.includes(type) ? type : 'all';
    const typeLabel = activeType === 'all' ? 'All types' : ENTITY_TYPE_LABELS[activeType];
    const title = value ? [entitySelectorLabel(value), value.belt?.lanes.map((lane, i) => `Lane ${i + 1}: ${lane.ingredient ? itemLabel(lane.ingredient) : 'empty'}`).join(' · ')].filter(Boolean).join(' — ') : undefined;
    return <>
        <Autocomplete<T, false, boolean> size="small" sx={sx} options={[...options]} value={value ?? null} readOnly={readOnly}
            open={open && !anchor} onOpen={() => setOpen(true)} onClose={() => { setOpen(false); setSearch(undefined); }}
            inputValue={search ?? (value ? entitySelectorLabel(value) : '')}
            onInputChange={(_, text, reason) => setSearch(reason === 'input' ? text : undefined)}
            onChange={(_, option) => { if (option) onChange(option); setSearch(undefined); }}
            getOptionLabel={entitySelectorLabel} getOptionKey={entitySelectorKey}
            groupBy={option => ENTITY_TYPE_LABELS[option.type]}
            filterOptions={(choices, state) => filterEntityOptions(choices, activeType, state.inputValue, itemLabel)}
            isOptionEqualToValue={(a, b) => entitySelectorKey(a) === entitySelectorKey(b)}
            autoHighlight disableClearable data-row-first={rowFirst ? '' : undefined}
            noOptionsText={`No matching ${activeType === 'all' ? 'entities' : typeLabel.toLowerCase()}`}
            slotProps={{ popper: { role: 'region', 'aria-label': `${label} options` } }}
            renderInput={params => <TextField {...params} label={label} title={title} error={error} helperText={helperText} inputRef={input}
                slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': ariaLabel }, input: { ...params.InputProps,
                    startAdornment: value ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}><RouteBadge option={value} /><ContentIcons option={value} /></Box> : undefined,
                    endAdornment: <>
                        {!readOnly && types.length > 1 && <Tooltip title={`Filter by entity type · ${typeLabel}`}><IconButton ref={filterButton} size="small" aria-label={`Filter ${ariaLabel} by entity type`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? menuId : undefined}
                            onClick={event => { setOpen(false); setAnchor(event.currentTarget); }} sx={{ color: activeType === 'all' ? 'text.secondary' : 'text.primary', bgcolor: activeType === 'all' ? undefined : 'action.selected', mr: 3 }}><FilterList fontSize="small" /></IconButton></Tooltip>}
                        {params.InputProps.endAdornment}
                    </>,
                } }} />}
            renderOption={(props, option, { selected }) => {
                const { key, ...rest } = props;
                return <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <RouteBadge option={option} />
                    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                        <Typography variant="body2">{option.label}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><ContentIcons option={option} size={16} />
                            <Typography variant="caption" color="text.secondary">{option.sublabel ?? (option.ingredientIcons?.map(itemLabel).join(' · ') || 'No items')}</Typography></Box>
                    </Box>
                    {selected && <Check aria-hidden sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
                </Box>;
            }} />
        <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} disableRestoreFocus
            slotProps={{ list: { 'aria-label': `${label} entity types` }, transition: { onExited: () => {
                if (filterChanged.current) { filterChanged.current = false; input.current?.focus(); setOpen(true); }
                else filterButton.current?.focus();
            } } }}>
            {(['all', ...types] as const).map(option => <MenuItem key={option} role="menuitemradio" aria-checked={option === activeType} selected={option === activeType}
                onClick={() => { setType(option); setSearch(undefined); filterChanged.current = true; setAnchor(null); }}>
                {option === 'all' ? 'All types' : ENTITY_TYPE_LABELS[option]}
            </MenuItem>)}
        </Menu>
    </>;
}
