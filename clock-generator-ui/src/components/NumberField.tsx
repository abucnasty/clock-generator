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
import { FIELD_DECIMALS, NUMBER_FIELD_INPUT_FORMAT, isUneditedPrecisionLoss, shownNumberText } from '../utils/numberText';

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
    placeholder?: string;
    /**
     * What is wrong with the value, under the helper text, which then stays as it is: the field is marked invalid and
     * the line is in the lighter red (the error red is 4.4:1 on a card, under the 4.5 text needs)
     */
    problem?: string | null;
    sx?: SxProps<Theme>;
    /** Decimals shown while the field is not focused; the full value shows on focus and is the one stored */
    displayDecimals?: number;
    /** Keep an invalid value legible while blurred, without changing the stored number. */
    preserveInputOnBlur?: boolean;
    /** The input's name, for a field with no label of its own to show; `aria-label` would land on the wrapper */
    inputAriaLabel?: string;
}

export function NumberField({
    id: idProp,
    label,
    error,
    helperText,
    placeholder,
    problem,
    size = 'medium',
    sx,
    min,
    max,
    onValueChange,
    format,
    displayDecimals = FIELD_DECIMALS,
    preserveInputOnBlur = false,
    inputAriaLabel,
    ...other
}: NumberFieldProps) {
    let id = React.useId();
    if (idProp) {
        id = idProp;
    }

    const effectiveFormat = format ?? NUMBER_FIELD_INPUT_FORMAT;
    const editedSinceFocus = React.useRef(false);

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
            if (isUneditedPrecisionLoss({
                value: other.value, nextValue: value, reason: eventDetails.reason,
                edited: editedSinceFocus.current, customFormat: format !== undefined, min, max,
            })) {
                // Cancel only Base UI's no-edit blur quantization; its controlled-value sync restores the full input text.
                eventDetails.cancel();
                return;
            }
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
        [min, max, onValueChange, other.value, format]
    );

    const hasError = error || Boolean(validationError) || Boolean(problem);
    const displayHelperText = validationError || helperText;
    const describedBy = [displayHelperText && `${id}-helper`, problem && `${id}-problem`].filter(Boolean).join(' ') || undefined;

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
                placeholder={placeholder}
                render={(props, state) => {
                    const shown = shownNumberText({
                        focused,
                        preserveInputOnBlur,
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
                            onChange={(e) => {
                                editedSinceFocus.current = true;
                                props.onChange?.(e);
                            }}
                            onKeyUp={props.onKeyUp}
                            onKeyDown={props.onKeyDown}
                            onFocus={(e) => {
                                editedSinceFocus.current = false;
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
                                    'aria-label': inputAriaLabel,
                                    'aria-describedby': describedBy,
                                    // the input slot's props come from the number field, which does not say it is invalid
                                    'aria-invalid': hasError || undefined,
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
                <FormHelperText
                    id={`${id}-helper`}
                    // with a problem line of its own the helper text is not the problem: it keeps its colour
                    error={problem && !error && !validationError ? false : undefined}
                    sx={{ ml: 0, '&:empty': { mt: 0 } }}
                >
                    {displayHelperText}
                </FormHelperText>
            )}
            {problem && (
                // not a live region: it is read with the field, and the workflow bar's note names it too
                <FormHelperText id={`${id}-problem`} sx={{ ml: 0, mt: 0.5, '&, &.Mui-error': { color: 'error.light' } }}>
                    {problem}
                </FormHelperText>
            )}
        </BaseNumberField.Root>
    );
}
