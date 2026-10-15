import { Autocomplete, Box, TextField, Tooltip } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { useGameNames } from '../hooks/useGameNames';
import { resolveTyped, searchIds } from '../utils/gameNames';

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
    // For iconOnly mode, use a more compact width
    const effectiveMinWidth = iconOnly && value ? 80 : minWidth;

    const autocomplete = (
        <Autocomplete
            id={inputId}
            size={size}
            sx={{ minWidth: effectiveMinWidth, ...sx }}
            options={options}
            value={value}
            // a typed name or id (freeSolo's Enter) is stored as its id; anything else as typed
            onChange={(_, newValue) => onChange(typeof newValue === 'string' ? resolveTyped(newValue, options, nameOf) : newValue)}
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
                        // hovering the chosen name shows its id
                        htmlInput: { ...params.inputProps, title: value || undefined, 'aria-label': inputAriaLabel },
                        input: {
                            ...params.InputProps,
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
                        title={option}
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
            <Tooltip title={`${nameOf(value)} (${value})`} placement="top">
                <Box>{autocomplete}</Box>
            </Tooltip>
        );
    }

    return autocomplete;
}
