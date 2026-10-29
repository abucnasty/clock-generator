import { Box, FormControl, InputLabel, MenuItem, Select, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode, Ref } from 'react';

interface SelectFieldProps<T extends string> {
    label: string;
    /** The choices, in order */
    options: readonly T[];
    /** How a choice shows, in the field and in the list */
    render?: (value: T) => ReactNode;
    /** How a choice shows in the list, when it says more there (a description) */
    renderOption?: (value: T) => ReactNode;
    onChange: (value: T) => void;
    /** The field's value; without it the field is an action that shows `placeholder` and does what is chosen */
    value?: T;
    placeholder?: string;
    /** The field's name when its label alone does not say whose it is: "Belt type, Belt 2" */
    inputAriaLabel?: string;
    describedBy?: string;
    readOnly?: boolean;
    /** The label always above the field, as for a field with a picture in it */
    shrink?: boolean;
    startAdornment?: ReactNode;
    fullWidth?: boolean;
    /** The first field of a row of the build, which the focus goes to when the row is added */
    first?: boolean;
    inputRef?: Ref<HTMLInputElement>;
    sx?: SxProps<Theme>;
}

/** A choice in a dropdown's list with a line under it that says what it does */
export function OptionWithNote({ label, note }: { label: ReactNode; note: ReactNode }) {
    return <Box sx={{ whiteSpace: 'normal' }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>
    </Box>;
}

/** A labelled small dropdown of a few choices */
export function SelectField<T extends string>({ label, options, render = String, renderOption = render, onChange, value, placeholder, inputAriaLabel = label,
    describedBy, readOnly = false, shrink = placeholder !== undefined, startAdornment, fullWidth, first = false, inputRef, sx }: SelectFieldProps<T>) {
    const action = value === undefined;
    return <FormControl data-row-first={first ? '' : undefined} size="small" fullWidth={fullWidth} sx={sx}>
        <InputLabel shrink={shrink || undefined}>{label}</InputLabel>
        <Select<T | ''> value={value ?? ''} label={label} readOnly={readOnly} notched={shrink || undefined} inputRef={inputRef}
            onChange={event => { if (event.target.value !== '') onChange(event.target.value as T); }}
            inputProps={{ 'aria-label': inputAriaLabel, 'aria-describedby': describedBy }} startAdornment={startAdornment}
            displayEmpty={action} renderValue={selected => selected === ''
                ? <Typography variant="body2" color="text.secondary">{placeholder}</Typography>
                : render(selected)}>
            {options.map(option => <MenuItem key={option} value={option}>{renderOption(option)}</MenuItem>)}
        </Select>
    </FormControl>;
}
