import { Autocomplete, Box, TextField, Tooltip, type AutocompleteHighlightChangeReason } from '@mui/material';
import { useContext, useMemo, useRef, useState } from 'react';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { SearchOnlyRecipesContext, useGameNames } from '../hooks/useGameNames';
import { nameWithId, resolveTyped, searchIds } from '../utils/gameNames';
import { prioritizedIds } from '../utils/pickerOrder';

interface ItemSelectorProps {
    priority?: { label: string; ids: string[] };
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
    /** A problem with the value, shown under the field and linked to it; the field is marked invalid */
    errorText?: string;
    /** The input's accessible name, when the visible label alone does not say whose field it is */
    inputAriaLabel?: string;
    sx?: object;
    /** If true, only show the icon in the selected value (text shown in dropdown and tooltip) */
    iconOnly?: boolean;
}

export function ItemSelector({
    value,
    options,
    priority,
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
    errorText,
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
    const offered = useMemo(
        () => (value && !options.includes(value) && nameOf(value) !== value ? [value, ...options] : options),
        [value, options, nameOf],
    );
    // Recipes the open list leaves out (recycling) but a typed query finds, after the visible matches
    const searchOnlyAll = useContext(SearchOnlyRecipesContext);
    const searchOnly = useMemo(() => {
        if (kind !== 'recipe') return [];
        const listed = new Set(offered);
        return searchOnlyAll.filter((id) => !listed.has(id));
    }, [kind, searchOnlyAll, offered]);
    const everyOption = useMemo(() => (searchOnly.length > 0 ? [...offered, ...searchOnly] : offered), [offered, searchOnly]);
    const grouped = priority && priority.ids.length > 0 ? priority : undefined;
    const matchesOf = (query: string): string[] => {
        if (grouped) return prioritizedIds(query, grouped.ids, offered, nameOf, grouped.label).ids;
        if (query.trim() === '') return offered;
        const shown = searchIds(query, offered, nameOf);
        return searchOnly.length > 0 ? [...shown, ...searchIds(query, searchOnly, nameOf)] : shown;
    };
    // The text in the field, kept here: with freeSolo, MUI keeps what the field showed when the value goes to none (a
    // Reset, an Undo, a New build or another build opened), so the field would still show the old name. It follows the
    // value whenever that changes from outside, and what is typed otherwise.
    const shownName = value && !iconOnly ? nameOf(value) : '';
    const [inputText, setInputText] = useState(shownName);
    const [shownFor, setShownFor] = useState({ value, name: shownName });
    if (shownFor.value !== value || shownFor.name !== shownName) {
        setShownFor({ value, name: shownName });
        setInputText(shownName);
    }
    // For iconOnly mode, use a more compact width
    const effectiveMinWidth = iconOnly && value ? 80 : minWidth;

    const autocomplete = (
        <Autocomplete
            id={inputId}
            size={size}
            sx={{ minWidth: effectiveMinWidth, ...sx }}
            options={grouped ? prioritizedIds('', grouped.ids, everyOption, nameOf, grouped.label).ids : everyOption}
            groupBy={grouped ? prioritizedIds('', grouped.ids, everyOption, nameOf, grouped.label).groupOf : undefined}
            value={value}
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            inputValue={inputText}
            onInputChange={(_, text, reason) => {
                setInputText(text);
                typed.current = reason === 'input' ? text : null;
                if (reason === 'input') highlightedBy.current = null;
            }}
            onHighlightChange={(_, _option, reason) => {
                highlightedBy.current = reason;
            }}
            onKeyDown={(event: React.KeyboardEvent & { defaultMuiPrevented?: boolean }) => {
                // Enter after typing takes the best match (row 1). The list highlights the chosen value instead when that
                // matches too ("Wall" is chosen and "wall" is typed), and Enter on it would keep it.
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || !open || highlightedBy.current !== null || !typed.current?.trim()) return;
                const best = matchesOf(typed.current)[0];
                if (best === undefined || best === value) return;
                event.defaultMuiPrevented = true;
                event.preventDefault();
                typed.current = null;
                setOpen(false);
                onChange(best);
            }}
            // a typed name or id (freeSolo's Enter) is stored as its id; anything else as typed
            onChange={(_, newValue) => onChange(typeof newValue === 'string' ? resolveTyped(newValue, everyOption, nameOf) : newValue)}
            // When iconOnly, don't show the text in the input field
            getOptionLabel={(option) => iconOnly ? '' : nameOf(option)}
            // by the name and the id, in any word order, best first
            filterOptions={(_ids, state) => matchesOf(state.inputValue)}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    placeholder={iconOnly ? '' : placeholder}
                    required={required}
                    error={errorText !== undefined}
                    helperText={errorText}
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
