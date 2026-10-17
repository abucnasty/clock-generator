import { Autocomplete, Box, TextField, Typography, type SxProps, type Theme } from '@mui/material';
import { Check } from '@mui/icons-material';
import { useState, type ReactNode } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { ENTITY_TYPE_LABELS, entitySelectorKey, entitySelectorLabel, searchEntityOptions, type EntitySelectorOption } from '../utils/entitySelector';
import { ContentIcons, RouteBadge } from './RouteIdentity';

/** One searchable picker and identity for route endpoints and timeline inspection. */
export function EntitySelector<T extends EntitySelectorOption>({ options, value, onChange, label, ariaLabel = label, helperText, error = false, readOnly = false, rowFirst = false, sx }: {
    options: readonly T[]; value: T | null | undefined; onChange(option: T): void;
    label: string; ariaLabel?: string; helperText?: ReactNode; error?: boolean; readOnly?: boolean; rowFirst?: boolean; sx?: SxProps<Theme>;
}) {
    const { itemLabel } = useGameNames();
    const [search, setSearch] = useState<string>();
    const title = value ? [entitySelectorLabel(value), value.belt?.lanes.map((lane, i) => `Lane ${i + 1}: ${lane.ingredient ? itemLabel(lane.ingredient) : 'empty'}`).join(' · ')].filter(Boolean).join(' — ') : undefined;
    return <Autocomplete<T, false, boolean> size="small" sx={sx} options={[...options]} value={value ?? null} readOnly={readOnly}
        onClose={() => setSearch(undefined)}
        inputValue={search ?? (value ? entitySelectorLabel(value) : '')}
        onInputChange={(_, text, reason) => setSearch(reason === 'input' ? text : undefined)}
        onChange={(_, option) => { if (option) onChange(option); setSearch(undefined); }}
        getOptionLabel={entitySelectorLabel} getOptionKey={entitySelectorKey}
        groupBy={option => ENTITY_TYPE_LABELS[option.type]}
        filterOptions={(choices, state) => searchEntityOptions(choices, state.inputValue, itemLabel)}
        isOptionEqualToValue={(a, b) => entitySelectorKey(a) === entitySelectorKey(b)}
        autoHighlight disableClearable data-row-first={rowFirst ? '' : undefined}
        noOptionsText="No matching entities"
        slotProps={{ popper: { role: 'region', 'aria-label': `${label} options` } }}
        renderInput={params => <TextField {...params} label={label} title={title} error={error} helperText={helperText}
            slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': ariaLabel }, input: { ...params.InputProps,
                startAdornment: value ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}><RouteBadge option={value} /><ContentIcons option={value} /></Box> : undefined,
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
        }} />;
}
