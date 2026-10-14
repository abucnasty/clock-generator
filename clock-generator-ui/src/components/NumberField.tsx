import * as React from 'react';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import IconButton from '@mui/material/IconButton';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { SxProps, Theme } from '@mui/material/styles';
import { FIELD_DECIMALS, shownNumberText } from '../utils/numberText';

/**
 * This component is a placeholder for FormControl to correctly set the shrink label state on SSR.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SSRInitialFilled(_props: BaseNumberField.Root.Props) {
    return null;
}
SSRInitialFilled.muiName = 'Input';

interface NumberFieldProps extends BaseNumberField.Root.Props {
    label?: React.ReactNode;
    size?: 'small' | 'medium';
    error?: boolean;
    helperText?: string;
    sx?: SxProps<Theme>;
    /** Decimals shown while the field is not focused; the full value shows on focus and is the one stored */
    displayDecimals?: number;
}

export function NumberField({
    id: idProp,
    label,
    error,
    helperText,
    size = 'medium',
    sx,
    min,
    max,
    onValueChange,
    format,
    displayDecimals = FIELD_DECIMALS,
    ...other
}: NumberFieldProps) {
    let id = React.useId();
    if (idProp) {
        id = idProp;
    }

    // Default format to preserve high precision decimals
    const effectiveFormat: Intl.NumberFormatOptions = format ?? {
        maximumFractionDigits: 20,
        useGrouping: false,
    };

    // Compute validation error message
    const [validationError, setValidationError] = React.useState<string | null>(null);
    // the rounding is of the shown text only: the value and the text typed keep every decimal
    const [focused, setFocused] = React.useState(false);
    // Tab selects the whole rounded text; the full text that replaces it on focus is then selected too, so typing replaces it
    const selectOnFocusRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    React.useLayoutEffect(() => {
        if (focused && selectOnFocusRef.current) {
            selectOnFocusRef.current.select();
        }
        selectOnFocusRef.current = null;
    }, [focused]);

    const handleValueChange = React.useCallback<NonNullable<BaseNumberField.Root.Props['onValueChange']>>(
        (value: number | null, eventDetails) => {
            // Validate against min/max
            if (value !== null) {
                if (min !== undefined && value < min) {
                    setValidationError(`Minimum value is ${min}`);
                } else if (max !== undefined && value > max) {
                    setValidationError(`Maximum value is ${max}`);
                } else {
                    setValidationError(null);
                }
            } else {
                setValidationError(null);
            }

            // Call original onValueChange if provided
            onValueChange?.(value, eventDetails);
        },
        [min, max, onValueChange]
    );

    const hasError = error || Boolean(validationError);
    const displayHelperText = validationError || helperText;

    return (
        <BaseNumberField.Root
            {...other}
            // the steppers' aria-controls point at the input by this id
            id={id}
            min={min}
            max={max}
            format={effectiveFormat}
            onValueChange={handleValueChange}
            render={(props, state) => (
                <FormControl
                    size={size}
                    ref={props.ref}
                    disabled={state.disabled}
                    required={state.required}
                    error={hasError}
                    variant="outlined"
                    sx={sx}
                >
                    {props.children}
                </FormControl>
            )}
        >
            <SSRInitialFilled {...other} min={min} max={max} />
            <InputLabel htmlFor={id}>{label}</InputLabel>
            <BaseNumberField.Input
                id={id}
                render={(props, state) => {
                    const shown = shownNumberText({
                        focused,
                        value: state.value,
                        inputValue: state.inputValue,
                        maxDecimals: displayDecimals,
                        locale: other.locale,
                    });
                    return (
                        <OutlinedInput
                            label={label}
                            inputRef={props.ref}
                            value={shown}
                            onBlur={(e) => {
                                // the base handler reads the full text, so it runs before the shown text is rounded again
                                props.onBlur?.(e);
                                setFocused(false);
                            }}
                            onChange={props.onChange}
                            onKeyUp={props.onKeyUp}
                            onKeyDown={props.onKeyDown}
                            onFocus={(e) => {
                                props.onFocus?.(e);
                                const input = e.currentTarget;
                                const allSelected = input.value !== ''
                                    && input.selectionStart === 0
                                    && input.selectionEnd === input.value.length;
                                selectOnFocusRef.current = allSelected && input.value !== state.inputValue ? input : null;
                                setFocused(true);
                            }}
                            slotProps={{
                                input: {
                                    ...props,
                                    // the input slot's props are spread over the value above, so it is set again here
                                    value: shown,
                                    title: shown !== state.inputValue ? state.inputValue : undefined,
                                    'aria-describedby': displayHelperText ? `${id}-helper` : undefined,
                                },
                            }}
                            endAdornment={
                                <InputAdornment
                                    position="end"
                                    sx={{
                                        flexDirection: 'column',
                                        maxHeight: 'unset',
                                        alignSelf: 'stretch',
                                        borderLeft: '1px solid',
                                        borderColor: 'divider',
                                        ml: 0,
                                        '& button': {
                                            py: 0,
                                            flex: 1,
                                            borderRadius: 0.5,
                                        },
                                    }}
                                >
                                    <BaseNumberField.Increment
                                        render={<IconButton size={size} aria-label="Increase" />}
                                    >
                                        <KeyboardArrowUpIcon
                                            fontSize={size}
                                            sx={{ transform: 'translateY(2px)' }}
                                        />
                                    </BaseNumberField.Increment>

                                    <BaseNumberField.Decrement
                                        render={<IconButton size={size} aria-label="Decrease" />}
                                    >
                                        <KeyboardArrowDownIcon
                                            fontSize={size}
                                            sx={{ transform: 'translateY(-2px)' }}
                                        />
                                    </BaseNumberField.Decrement>
                                </InputAdornment>
                            }
                            sx={{ pr: 0 }}
                        />
                    );
                }}
            />
            {displayHelperText && (
                <FormHelperText id={`${id}-helper`} sx={{ ml: 0, '&:empty': { mt: 0 } }}>
                    {displayHelperText}
                </FormHelperText>
            )}
        </BaseNumberField.Root>
    );
}
