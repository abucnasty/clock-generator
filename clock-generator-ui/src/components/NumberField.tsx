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
                render={(props, state) => (
                    <OutlinedInput
                        label={label}
                        inputRef={props.ref}
                        value={state.inputValue}
                        onBlur={props.onBlur}
                        onChange={props.onChange}
                        onKeyUp={props.onKeyUp}
                        onKeyDown={props.onKeyDown}
                        onFocus={props.onFocus}
                        slotProps={{
                            input: props,
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
                )}
            />
            {displayHelperText && (
                <FormHelperText sx={{ ml: 0, '&:empty': { mt: 0 } }}>
                    {displayHelperText}
                </FormHelperText>
            )}
        </BaseNumberField.Root>
    );
}
