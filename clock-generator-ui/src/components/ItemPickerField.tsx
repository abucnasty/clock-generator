import { ArrowDropDown } from '@mui/icons-material';
import { FormControl, InputAdornment, InputLabel, OutlinedInput } from '@mui/material';
import { useId, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { FilterItemPicker } from './FilterItemPicker';

/** An inline item field that opens the shared category picker. */
export function ItemPickerField({ label, inputAriaLabel, value, options, readOnly = false, onChange }: {
    label: string;
    inputAriaLabel: string;
    value: string | null;
    options: string[];
    readOnly?: boolean;
    onChange: (value: string | null) => void;
}) {
    const id = useId();
    const { itemLabel } = useGameNames();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    return <>
        <FormControl size="small" sx={{ minWidth: 0, width: '100%' }}>
            <InputLabel htmlFor={id} shrink>{label}</InputLabel>
            <OutlinedInput id={id} readOnly notched label={label} value={value ? itemLabel(value) : ''} placeholder="Choose an item"
                inputProps={{ role: readOnly ? undefined : 'button', 'aria-label': inputAriaLabel, 'aria-haspopup': readOnly ? undefined : 'dialog', 'aria-expanded': readOnly ? undefined : Boolean(anchor) }}
                onClick={event => { if (!readOnly) setAnchor(event.currentTarget); }}
                onKeyDown={event => { if (!readOnly && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setAnchor(event.currentTarget); } }}
                onContextMenu={event => { if (!readOnly && value) { event.preventDefault(); onChange(null); } }}
                startAdornment={value ? <InputAdornment position="start"><FactorioIcon name={value} size={20} alt="" /></InputAdornment> : undefined}
                endAdornment={!readOnly ? <InputAdornment position="end"><ArrowDropDown fontSize="small" /></InputAdornment> : undefined}
                sx={{ '& input': { cursor: readOnly ? 'default' : 'pointer', textOverflow: 'ellipsis' }, cursor: readOnly ? 'default' : 'pointer' }} />
        </FormControl>
        {anchor && <FilterItemPicker anchor={anchor} label={`Choose an item for ${inputAriaLabel}`} initialItem={value}
            itemNames={options} clearLabel="Clear item" onClose={close} onApply={item => { onChange(item); close(); }}
            onClear={value ? () => { onChange(null); close(); } : undefined} />}
    </>;
}
