import { Autocomplete, Box, TextField, Tooltip, type AutocompleteHighlightChangeReason } from '@mui/material';
import { useRef, useState } from 'react';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { useGameNames } from '../hooks/useGameNames';
import { nameWithId, resolveTyped, searchIds } from '../utils/gameNames';

interface ItemSelectorProps {
    /** The chosen id; the options are ids too, shown by their in-game names */
    value: string | null;
    options: string[];
    onChange: (value: string | null) => void;
    /** Whether the ids are items (fluids and entities too) or recipes, for their names */
    kind?: 'item' | 'recipe';
    label?: string;
    placeholder?: string;
    size?: 'small' | 'medium';
    minWidth?: number;
    freeSolo?: boolean;
    required?: boolean;
    /** The input's element id */
    inputId?: string;
    /** The input's accessible name, when the visible label alone does not say whose field it is */
    inputAriaLabel?: string;
    sx?: object;
    /** If true, only show the icon in the selected value (text shown in dropdown and tooltip) */
    iconOnly?: boolean;
}

export function ItemSelector({
    value,
    options,
    onChange,
    kind = 'item',
    label = 'Item',
    placeholder = 'Search items...',
    size = 'small',
    minWidth = 200,
    freeSolo = false,
    required,
    inputId,
    inputAriaLabel,
    sx,
    iconOnly = false,
}: ItemSelectorProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    const nameOf = kind === 'recipe' ? recipeLabel : itemLabel;
    const [open, setOpen] = useState(false);
    // What the player typed since the input was last filled in, and how the player moved the highlight since (null: the
    // list placed it, which it does on the chosen value when that matches what was typed, rather than on the best match)
    const typed = useRef<string | null>(null);
    const highlightedBy = useRef<AutocompleteHighlightChangeReason | null>(null);
    // the chosen value stays an option, even one the list would not offer (a mod's, or a hidden recipe of an imported build)
    const offered = value && !options.includes(value) && nameOf(value) !== value ? [value, ...options] : options;
    // For iconOnly mode, use a more compact width
    const effectiveMinWidth = iconOnly && value ? 80 : minWidth;

    const autocomplete = (
        <Autocomplete
            id={inputId}
            size={size}
            sx={{ minWidth: effectiveMinWidth, ...sx }}
            options={offered}
            value={value}
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            onInputChange={(_, text, reason) => {
                typed.current = reason === 'input' ? text : null;
                if (reason === 'input') highlightedBy.current = null;
            }}
            onHighlightChange={(_, _option, reason) => {
                highlightedBy.current = reason;
            }}
            onKeyDown={(event: React.KeyboardEvent & { defaultMuiPrevented?: boolean }) => {
                // Enter after typing takes the best match (row 1). The list highlights the chosen value instead when that
                // matches too ("Wall recycling" for "Wall"), and Enter on it would keep it.
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || !open || highlightedBy.current !== null || !typed.current?.trim()) return;
                const best = searchIds(typed.current, offered, nameOf)[0];
                if (best === undefined || best === value) return;
                event.defaultMuiPrevented = true;
                event.preventDefault();
                typed.current = null;
                setOpen(false);
                onChange(best);
            }}
            // a typed name or id (freeSolo's Enter) is stored as its id; anything else as typed
            onChange={(_, newValue) => onChange(typeof newValue === 'string' ? resolveTyped(newValue, offered, nameOf) : newValue)}
            // When iconOnly, don't show the text in the input field
            getOptionLabel={(option) => iconOnly ? '' : nameOf(option)}
            // by the name and the id, in any word order, best first
            filterOptions={(ids, state) => searchIds(state.inputValue, ids, nameOf)}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    placeholder={iconOnly ? '' : placeholder}
                    required={required}
                    slotProps={{
                        htmlInput: { ...params.inputProps, 'aria-label': inputAriaLabel },
                        input: {
                            ...params.InputProps,
                            // hovering the chosen value shows its whole name and its id; on the wrapper, not the input, so
                            // that a screen reader does not spell the id out as the field's description
                            title: value && !iconOnly ? nameWithId(nameOf(value), value) : undefined,
                            startAdornment: value ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                                    <FactorioIcon name={value} size={20} alt={iconOnly ? nameOf(value) : ''} />
                                </Box>
                            ) : null,
                        },
                    }}
                />
            )}
            renderOption={(props, option) => {
                const { key, ...rest } = props;
                return (
                    <Box
                        component="li"
                        key={key}
                        {...rest}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <FactorioIcon name={option} size={20} alt="" />
                        <GameName id={option} kind={kind} />
                    </Box>
                );
            }}
            freeSolo={freeSolo}
            autoHighlight
        />
    );

    // Wrap in tooltip when iconOnly to show the full name on hover
    if (iconOnly && value) {
        return (
            <Tooltip title={nameWithId(nameOf(value), value)} placement="top">
                <Box>{autocomplete}</Box>
            </Tooltip>
        );
    }

    return autocomplete;
}
