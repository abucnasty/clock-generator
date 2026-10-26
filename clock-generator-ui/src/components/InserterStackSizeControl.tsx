import { Box, Checkbox, FormControlLabel } from '@mui/material';
import { useState } from 'react';
import type { InserterFormData } from '../utils/configForm/formData';
import { effectiveInserterStackSize } from '../utils/inserterMetadata';
import { stackSizeFrom } from '../utils/inserterOptions';
import { NumberField } from './NumberField';

/** Uses the existing omitted stack_size contract when the override is off. */
export function InserterStackSizeControl({ value, label, id, compact = false, onChange }: {
    value: Pick<InserterFormData, 'prototype' | 'stack_size'>;
    label: string;
    id: string;
    compact?: boolean;
    onChange: (stackSize: number | undefined) => void;
}) {
    const automaticSize = effectiveInserterStackSize({ prototype: value.prototype });
    const knownCapacity = Number.isFinite(automaticSize);
    // Unsupported imported types still allow entering an override, without inventing their capacity.
    const [editingUnknown, setEditingUnknown] = useState(false);
    const [emptyDraft, setEmptyDraft] = useState(false);
    const [previous, setPrevious] = useState({ prototype: value.prototype, stackSize: value.stack_size });
    if (previous.prototype !== value.prototype || !Object.is(previous.stackSize, value.stack_size)) {
        setPrevious({ prototype: value.prototype, stackSize: value.stack_size });
        setEditingUnknown(false);
        setEmptyDraft(false);
    }
    const overriding = value.stack_size !== undefined || editingUnknown;
    return <Box onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEmptyDraft(false);
    }} sx={{ display: 'flex', flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', alignItems: compact ? 'flex-start' : 'stretch', gap: 1.5, minWidth: 0 }}>
        <FormControlLabel label="Override stack size" sx={{ m: 0 }} control={<Checkbox
            checked={overriding}
            slotProps={{ input: { 'aria-label': `Override stack size, ${label}` } }}
            onChange={(_, checked) => {
                setEditingUnknown(checked && !knownCapacity);
                setEmptyDraft(false);
                if (!checked) onChange(undefined);
                else if (knownCapacity) onChange(automaticSize);
            }} />} />
        <NumberField id={id} label="Stack size" disabled={!overriding}
            value={overriding ? emptyDraft ? null : value.stack_size ?? null : knownCapacity ? automaticSize : null}
            placeholder={knownCapacity ? undefined : 'Unavailable'}
            helperText={knownCapacity ? undefined
                : overriding ? 'Capacity unavailable for this type. Enter a stack size.' : 'Capacity unavailable for this inserter type.'}
            onValueChange={n => {
                // Keep the field blank while replacing text, retaining the last committed override.
                setEmptyDraft(n === null);
                if (n !== null) onChange(stackSizeFrom(n));
            }}
            min={1} step={1} sx={{ width: compact ? 160 : '100%', maxWidth: '100%', alignSelf: compact && knownCapacity ? 'center' : undefined }} size="small" />
    </Box>;
}
