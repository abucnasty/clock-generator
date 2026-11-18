import { ExpandMore } from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    FormControlLabel,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { catalogRowOf } from 'clock-generator/light';
import { useId, type ReactNode } from 'react';
import { HelpButton } from './HelpButton';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import type { ConfigFormData } from '../utils/configForm/formData';
import { FORCE_TEXT, type TargetCounts } from '../utils/targetCounts';

/** The names of the searches that "Search for fewer wakeups" runs, read from the strategy catalog */
const SEARCH_NAMES = {
    time_study: catalogRowOf({ id: 'time_study_windows', tuning_method: 'observed' }).name,
    moved_output: catalogRowOf({ id: 'moved_output_swing', tuning_method: 'observed' }).name,
    phase_shifted: catalogRowOf({ id: 'phase_shifted_batch', tuning_method: 'observed' }).name,
    pitch: catalogRowOf({ id: 'pitch_pickups', tuning_method: 'observed' }).name,
};

/** The one height of a label row: the help button's, so a field without one still starts its box on the same line */
const LABEL_ROW_HEIGHT = 30;

interface NumberFieldProps {
    id: string;
    label: string;
    /** The "?" after the label, with what it opens */
    help?: { label: string; text: string };
    value: number | undefined;
    onChange: (value: number | undefined) => void;
    /** Under the box, tied to it */
    description: string;
}

/**
 * A whole-number override in the same four parts every time, so that the fields line up where they sit side by side
 * and stack alike where they do not: the label, with its help button where there is one, then the box, then its
 * help text. Empty takes the calculated value.
 */
function NumberField({ id, label, help, value, onChange, description }: NumberFieldProps) {
    return (
        <Box sx={{ width: 260, maxWidth: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: LABEL_ROW_HEIGHT }}>
                <Typography component="label" htmlFor={id} variant="body2">{label}</Typography>
                {help && (
                    <HelpButton label={help.label}>
                        <Typography variant="body2">{help.text}</Typography>
                    </HelpButton>
                )}
            </Box>
            <TextField
                id={id}
                type="number"
                value={value ?? ''}
                onChange={e => onChange(parseInt(e.target.value) || undefined)}
                slotProps={{ htmlInput: { min: 1, 'aria-describedby': `${id}-help` } }}
                fullWidth
                size="small"
            />
            <Typography id={`${id}-help`} variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                {description}
            </Typography>
        </Box>
    );
}

interface OverridesFormProps {
    importedChecks?: ConfigFormData['overrides'];
    lcm?: number;
    terminalSwingCount?: number;
    /** What the target counts: for the item destroyed, the forced count is of hands brought into a machine, not of output swings */
    counts?: TargetCounts;
    searchForFewerWakeUps?: boolean;
    /** The start every clock is judged from; none named is the backpressure start */
    judgedStart?: NonNullable<ConfigFormData['overrides']>['judged_start'];
    onUpdate: (field: 'lcm' | 'terminal_swing_count' | 'search_for_fewer_wake_ups' | 'judged_start', value: number | boolean | string | undefined) => void;
    /** The swing plan of the last check, under the fields */
    planSlot?: ReactNode;
    /** Closed on a first visit, and again when the build is replaced (Import, Paste, Reset) */
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
    /** How many of its settings the build uses (`advancedSetCount`), shown in the title */
    setCount: number;
}

export function OverridesForm({
    importedChecks,
    lcm,
    terminalSwingCount,
    counts = 'made',
    searchForFewerWakeUps,
    judgedStart,
    onUpdate,
    planSlot,
    expanded,
    onExpandedChange,
    setCount,
}: OverridesFormProps) {
    const summaryId = useId();
    const lcmId = useId();
    const forceId = useId();
    const searchId = useId();
    const startId = useId();
    const force = FORCE_TEXT[counts];
    return (
        <Accordion
            expanded={expanded}
            onChange={(_, open) => onExpandedChange(open)}
            slotProps={{ heading: { component: 'h2' }, region: { 'aria-labelledby': summaryId } }}
        >
            <AccordionSummary id={summaryId} expandIcon={<ExpandMore />}>
                <Typography variant="h6" component="span">
                    Advanced
                    {/* it folds after Import, Paste and Reset: says that a build sets some all the same */}
                    {setCount > 0 && (
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                            {/* read "Advanced, 1 set": a comma for the pause, the dot for the eye */}
                            <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>
                            <span aria-hidden="true">· </span>
                            {setCount} set
                        </Typography>
                    )}
                </Typography>
            </AccordionSummary>
            <AccordionDetails>
                {(importedChecks?.check_start_dependence !== undefined || importedChecks?.kick_start_items !== undefined) && <Typography variant="body2" sx={{ mb: 2 }}>
                    Imported model settings (read-only):
                    {importedChecks.check_start_dependence !== undefined && ` other-start checks ${importedChecks.check_start_dependence ? 'requested' : 'not requested'}.`}
                    {importedChecks.kick_start_items !== undefined && ` Kick start ${importedChecks.kick_start_items} items per self-feeding machine.`}
                </Typography>}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    These options allow you to manually override calculated values.
                    Leave empty to use automatic calculation.
                    <br />
                    
                </Typography>
                
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <NumberField
                        id={lcmId}
                        label="LCM Override"
                        value={lcm}
                        onChange={value => onUpdate('lcm', value)}
                        description="Output cycles per window cycle (overrides the calculated LCM). The swing plan below shows the calculated value."
                    />
                    <NumberField
                        id={forceId}
                        label={force.label}
                        help={{ label: force.helpLabel, text: force.help.join(' ') }}
                        value={terminalSwingCount}
                        onChange={value => onUpdate('terminal_swing_count', value)}
                        description={force.field}
                    />
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <FormControlLabel
                                control={<Switch id={searchId} checked={searchForFewerWakeUps ?? false} color="primary"
                                    slotProps={{ input: { role: 'switch', 'aria-describedby': `${searchId}-help` } }}
                                    onChange={e => onUpdate('search_for_fewer_wake_ups', e.target.checked ? true : undefined)} />}
                                label="Search for fewer wakeups"
                                sx={{ mr: 0 }}
                            />
                            <HelpButton label="About Search for fewer wakeups">
                                <Typography variant="body2">
                                    Runs the four searches for every build: {SEARCH_NAMES.time_study}, {SEARCH_NAMES.moved_output}, {SEARCH_NAMES.phase_shifted} and {SEARCH_NAMES.pitch}.
                                    They take most of the time of a generation, so by default they only run when no clock made without a search is stable, except that {SEARCH_NAMES.time_study} and {SEARCH_NAMES.phase_shifted} also run on a short clock that still has wakeups.
                                    Where one is, a search can still find a stable clock with fewer wakeups: turn this on to look for it.
                                </Typography>
                            </HelpButton>
                        </Box>
                        <Typography id={`${searchId}-help`} variant="caption" color="text.secondary" component="p">
                            Search even when a clock already holds the rate; generation takes longer.
                        </Typography>
                    </Box>
                    <Box>
                        <FormControlLabel
                            control={<Switch id={startId} checked={judgedStart === 'cold'} color="primary"
                                slotProps={{ input: { role: 'switch', 'aria-describedby': `${startId}-help` } }}
                                onChange={e => onUpdate('judged_start', e.target.checked ? 'cold' : undefined)} />}
                            label="Judge from the cold start"
                            sx={{ mr: 0 }}
                        />
                        <Typography id={`${startId}-help`} variant="caption" color="text.secondary" component="p">
                            Off: the backpressure start. On: the cold start, with empty machines.
                        </Typography>
                    </Box>
                </Box>
                {planSlot && <Box sx={{ mt: 2 }}>{planSlot}</Box>}
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                    {force.note}
                </Typography>
            </AccordionDetails>
        </Accordion>
    );
}
