import { ArrowDropDown } from '@mui/icons-material';
import { FormControl, FormHelperText, InputAdornment, InputLabel, OutlinedInput } from '@mui/material';
import { useContext, useId, useMemo, useState } from 'react';
import { SearchOnlyRecipesContext, useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { FilterItemPicker } from './FilterItemPicker';

/** An inline item field that opens the shared category picker. */
export function ItemPickerField({ label, inputAriaLabel, value, options, readOnly = false, onChange, kind = 'item', inputId, required, errorText, sx, size = 'small', iconOnly = false, allowCustom = false }: {
    label: string;
    inputAriaLabel: string;
    value: string | null;
    options: string[];
    readOnly?: boolean;
    kind?: 'item' | 'recipe';
    inputId?: string;
    required?: boolean;
    errorText?: string;
    sx?: object;
    size?: 'small' | 'medium';
    iconOnly?: boolean;
    allowCustom?: boolean;
    onChange: (value: string | null) => void;
}) {
    const generatedId = useId();
    const id = inputId ?? generatedId;
    const { itemLabel, recipeLabel } = useGameNames();
    const nameOf = kind === 'recipe' ? recipeLabel : itemLabel;
    const searchOnly = useContext(SearchOnlyRecipesContext);
    const offered = useMemo(() => value && !options.includes(value) ? [value, ...options] : options, [options, value]);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    return <>
        <FormControl size={size} required={required} error={Boolean(errorText)} sx={{ minWidth: 0, width: '100%', ...sx }}>
            <InputLabel htmlFor={id} shrink>{label}</InputLabel>
            <OutlinedInput aria-describedby={errorText ? `${id}-error` : undefined} id={id} readOnly notched label={label} value={value && !iconOnly ? nameOf(value) : ''} placeholder={iconOnly ? '' : kind === 'recipe' ? 'Choose a recipe' : 'Choose an item'} title={value ? nameOf(value) : undefined}
                inputProps={{ role: readOnly ? undefined : 'button', 'aria-label': inputAriaLabel, 'aria-haspopup': readOnly ? undefined : 'dialog', 'aria-expanded': readOnly ? undefined : Boolean(anchor) }}
                onClick={event => { if (!readOnly) setAnchor(event.currentTarget); }}
                onKeyDown={event => { if (!readOnly && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setAnchor(event.currentTarget); } }}
                onContextMenu={event => { if (!readOnly && value) { event.preventDefault(); onChange(null); } }}
                startAdornment={value ? <InputAdornment position="start"><FactorioIcon name={value} size={20} alt="" /></InputAdornment> : undefined}
                endAdornment={!readOnly ? <InputAdornment position="end"><ArrowDropDown fontSize="small" /></InputAdornment> : undefined}
                sx={{ '& input': { cursor: readOnly ? 'default' : 'pointer', textOverflow: 'ellipsis' }, cursor: readOnly ? 'default' : 'pointer' }} />
            {errorText && <FormHelperText id={`${id}-error`}>{errorText}</FormHelperText>}
        </FormControl>
        {anchor && <FilterItemPicker anchor={anchor} label={`Choose ${kind === 'recipe' ? 'a recipe' : 'an item'} for ${inputAriaLabel}`} kind={kind} allowCustom={allowCustom} initialItem={value}
            itemNames={offered} searchOnlyIds={kind === 'recipe' ? searchOnly : undefined} clearLabel={kind === 'recipe' ? 'Clear recipe' : 'Clear item'} onClose={close} onApply={item => { onChange(item); close(); }}
            onClear={value ? () => { onChange(null); close(); } : undefined} />}
    </>;
}
