import { Box, FormControl, FormHelperText, InputLabel, MenuItem, Select, Typography, type SxProps, type Theme } from '@mui/material';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { useId } from 'react';
import type { LaneEnd, LaneSharing } from 'clock-generator/light';
import { FLOW_DIRECTIONS, LANE_FACT_COPY, type FlowDirectionValue } from '../utils/laneFacts';
import { formatNumberText } from '../utils/numberText';
import { NumberField } from './NumberField';

/** The value of the list that stands for a fact the config does not state */
const NOT_STATED = 'not-stated';

/**
 * A dropdown of a fact the config may state. A fact it does not state shows the engine's value in grey (`defaultText`)
 * and writes nothing; choosing a value writes it, and "not stated" takes it away again. `unknown` is a stated value that
 * cannot be chosen: it shows with its note until another value is chosen.
 */
function FactSelect<T extends string>({ label, inputAriaLabel, value, options, defaultText, onChange, unknown, sx }: {
    label: string;
    inputAriaLabel: string;
    value: T | undefined;
    options: readonly { value: T; label: string }[];
    /** The engine's value of a fact the config does not state; none where the engine cannot tell */
    defaultText?: string;
    onChange: (value: T | undefined) => void;
    /** The stated value that cannot be chosen, with what it shows and the sentence under it */
    unknown?: { value: T; text: string; note: string };
    sx?: SxProps<Theme>;
}) {
    const id = useId();
    const isUnknown = unknown !== undefined && value === unknown.value;
    const labelOf = (it: string) => options.find(option => option.value === it)?.label ?? it;
    // an end the Sidecar could not tell is outlined in the warning colour until the user sets one
    const warned = isUnknown ? { '& .MuiOutlinedInput-notchedOutline, &:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main', borderWidth: 2 },
        '& .MuiInputLabel-root': { color: 'warning.main' } } : {};
    return <FormControl size="small" sx={[warned, ...(Array.isArray(sx) ? sx : [sx])]}>
        <InputLabel shrink>{label}</InputLabel>
        <Select<string> value={value ?? NOT_STATED} label={label} notched
            onChange={event => onChange(event.target.value === NOT_STATED ? undefined : event.target.value as T)}
            inputProps={{ 'aria-label': inputAriaLabel, 'aria-describedby': isUnknown ? `${id}-note` : undefined }}
            renderValue={selected => selected === NOT_STATED
                // the engine's value in grey, said as not stated; with none (a fact the engine has no default for), "Not stated" itself
                ? <Typography variant="body2" component="span" color="text.secondary">
                    {defaultText === undefined ? LANE_FACT_COPY.notStated
                        : <>{defaultText}<Box component="span" sx={VISUALLY_HIDDEN}>, {LANE_FACT_COPY.notStated.toLowerCase()}</Box></>}
                </Typography>
                : isUnknown ? unknown.text : labelOf(selected)}>
            {isUnknown
                ? <MenuItem value={unknown.value} disabled>{unknown.text}</MenuItem>
                : <MenuItem value={NOT_STATED}>
                    {LANE_FACT_COPY.notStated}{defaultText && <Typography variant="body2" component="span" color="text.secondary">&nbsp;({defaultText})</Typography>}
                </MenuItem>}
            {options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </Select>
        {isUnknown && <FormHelperText id={`${id}-note`} sx={{ mx: 0, color: 'warning.main' }}>{unknown.note}</FormHelperText>}
    </FormControl>;
}

const END_OPTIONS = (['dead_end', 'infinite'] as const).map(value => ({ value, label: LANE_FACT_COPY.ends[value] }));
const SHARING_OPTIONS = (['shared', 'per_copy'] as const).map(value => ({ value, label: LANE_FACT_COPY.sharings[value] }));

/** A lane's end: Dead end or Infinite, or not stated with the engine's end in grey; a pasted Unknown until one is chosen */
export function LaneEndField({ value, engineEnd, ownerName, onChange, sx }: {
    value: LaneEnd['kind'] | undefined;
    /** The end the engine reads for the lane when it states none */
    engineEnd: LaneEnd['kind'] | undefined;
    /** "Belt 1, lane 2": whose field it is, for its name */
    ownerName: string;
    onChange: (value: LaneEnd['kind'] | undefined) => void;
    sx?: SxProps<Theme>;
}) {
    return <FactSelect<LaneEnd['kind']> label={LANE_FACT_COPY.laneEnd} inputAriaLabel={`${LANE_FACT_COPY.laneEnd}, ${ownerName}`} value={value}
        options={END_OPTIONS} defaultText={engineEnd === undefined ? undefined : LANE_FACT_COPY.ends[engineEnd]} onChange={onChange}
        unknown={{ value: 'unknown', text: LANE_FACT_COPY.unknownChoice, note: LANE_FACT_COPY.unknownNote }} sx={sx} />;
}

/** Whether the copies share the lane: Shared or Per copy, or not stated with the engine's default in grey */
export function LaneSharingField({ value, engineSharing, ownerName, onChange, sx }: {
    value: LaneSharing | undefined;
    engineSharing: LaneSharing | undefined;
    ownerName: string;
    onChange: (value: LaneSharing | undefined) => void;
    sx?: SxProps<Theme>;
}) {
    return <FactSelect<LaneSharing> label={LANE_FACT_COPY.sharing} inputAriaLabel={`${LANE_FACT_COPY.sharing}, ${ownerName}`} value={value}
        options={SHARING_OPTIONS} defaultText={engineSharing === undefined ? undefined : LANE_FACT_COPY.sharings[engineSharing]} onChange={onChange} sx={sx} />;
}

/** Items a second onto the lane where it starts: empty shows the lane's capacity in grey and writes nothing */
export function SupplyRateField({ value, capacity, ownerName, onChange, sx }: {
    value: number | undefined;
    capacity: number | undefined;
    ownerName: string;
    onChange: (value: number | undefined) => void;
    sx?: SxProps<Theme>;
}) {
    return <NumberField label={LANE_FACT_COPY.supplyRate} inputAriaLabel={`${LANE_FACT_COPY.supplyRate}, ${ownerName}`} value={value ?? null} min={0}
        size="small" shrinkLabel placeholder={capacity === undefined ? undefined : formatNumberText(capacity, { maxDecimals: 2 })}
        onValueChange={rate => onChange(rate !== null && rate > 0 ? rate : undefined)} sx={sx} />;
}

const FLOW_OPTIONS = FLOW_DIRECTIONS.map(direction => ({ value: String(direction.value), label: direction.label }));

/** The way the items on the belt move along the copies, or not stated */
export function FlowDirectionField({ value, ownerName, onChange, sx }: {
    value: FlowDirectionValue | undefined;
    ownerName: string;
    onChange: (value: FlowDirectionValue | undefined) => void;
    sx?: SxProps<Theme>;
}) {
    return <FactSelect<string> label={LANE_FACT_COPY.flowDirection} inputAriaLabel={`${LANE_FACT_COPY.flowDirection}, ${ownerName}`}
        value={value === undefined ? undefined : String(value)} options={FLOW_OPTIONS}
        onChange={it => onChange(it === undefined ? undefined : Number(it) as FlowDirectionValue)} sx={sx} />;
}
