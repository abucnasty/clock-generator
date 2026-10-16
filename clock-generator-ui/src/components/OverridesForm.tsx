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
import { useId, type ReactNode } from 'react';
import { HelpButton } from './HelpButton';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';

interface OverridesFormProps {
    lcm?: number;
    terminalSwingCount?: number;
    useFractionalSwings?: boolean;
    searchForFewerWakeUps?: boolean;
    onUpdate: (field: 'lcm' | 'terminal_swing_count' | 'use_fractional_swings' | 'search_for_fewer_wake_ups', value: number | boolean | undefined) => void;
    /** The swing plan of the last check, under the fields */
    planSlot?: ReactNode;
    /** Closed on a first visit, and again when the build is replaced (Import, Paste, Reset) */
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
    /** How many of its settings the build uses (`advancedSetCount`), shown in the title */
    setCount: number;
}

export function OverridesForm({
    lcm,
    terminalSwingCount,
    useFractionalSwings,
    searchForFewerWakeUps,
    onUpdate,
    planSlot,
    expanded,
    onExpandedChange,
    setCount,
}: OverridesFormProps) {
    const summaryId = useId();
    const forceId = useId();
    const fractionalId = useId();
    const searchId = useId();
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
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    These options allow you to manually override calculated values.
                    Leave empty to use automatic calculation.
                    <br />
                    
                </Typography>
                
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <TextField
                        label="LCM Override"
                        type="number"
                        value={lcm ?? ''}
                        onChange={(e) =>
                            onUpdate(
                                'lcm',
                                parseInt(e.target.value) || undefined
                            )
                        }
                        slotProps={{ htmlInput: { min: 1 } }}
                        sx={{ width: 200 }}
                        size="small"
                        helperText="Crafting cycles per clock period (overrides the calculated LCM). The swing plan below shows the calculated value."
                    />
                    <Box sx={{ width: 260, maxWidth: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography component="label" htmlFor={forceId} variant="body2">Force Output Swings</Typography>
                            <HelpButton label="About Force Output Swings">
                                <Typography variant="body2">
                                    Uses exactly this many total output swings per crafting cycle of each output machine for every clock, even if the clock does not hold the rate.
                                    The total is divided equally among that machine's output inserters; each inserter's count may be fractional.
                                    Leave empty to let the generator pick the count, lower it until the output holds the rate, and offer other counts as clocks.
                                </Typography>
                            </HelpButton>
                        </Box>
                        <TextField
                            id={forceId}
                            type="number"
                            value={terminalSwingCount ?? ''}
                            onChange={e => onUpdate('terminal_swing_count', parseInt(e.target.value) || undefined)}
                            slotProps={{ htmlInput: { min: 1, 'aria-describedby': `${forceId}-help` } }}
                            fullWidth
                            size="small"
                        />
                        <Typography id={`${forceId}-help`} variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                            Total output swings per crafting cycle of each output machine
                        </Typography>
                    </Box>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <FormControlLabel
                                control={<Switch id={fractionalId} checked={useFractionalSwings ?? false} color="primary"
                                    slotProps={{ input: { 'aria-describedby': `${fractionalId}-help` } }}
                                    onChange={e => onUpdate('use_fractional_swings', e.target.checked ? true : undefined)} />}
                                label="Enable Fractional Swings"
                                sx={{ mr: 0 }}
                            />
                            <HelpButton label="About Enable Fractional Swings">
                                <Typography variant="body2">
                                    When enabled, inserters with fractional swing counts (e.g., 1.5 swings per cycle) will distribute swings across multiple sub-cycles.
                                    For example, 3/2 swings becomes 1 swing in the first sub-cycle and 2 swings in the second.
                                </Typography>
                            </HelpButton>
                        </Box>
                        <Typography id={`${fractionalId}-help`} variant="caption" color="text.secondary" component="p">
                            Spread fractional swings over multiple crafting cycles.
                        </Typography>
                    </Box>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <FormControlLabel
                                control={<Switch id={searchId} checked={searchForFewerWakeUps ?? false} color="primary"
                                    slotProps={{ input: { 'aria-describedby': `${searchId}-help` } }}
                                    onChange={e => onUpdate('search_for_fewer_wake_ups', e.target.checked ? true : undefined)} />}
                                label="Search for fewer wake-ups"
                                sx={{ mr: 0 }}
                            />
                            <HelpButton label="About Search for fewer wake-ups">
                                <Typography variant="body2">
                                    Runs the four searches for every build: observed wake windows, uneven output swings, shifted swings and full-hand output swings.
                                    They take most of the time of a generation, so by default they only run when no clock made without a search is stable.
                                    Where one is, a search can still find a stable clock with fewer wake-ups: turn this on to look for it.
                                </Typography>
                            </HelpButton>
                        </Box>
                        <Typography id={`${searchId}-help`} variant="caption" color="text.secondary" component="p">
                            Search even when a clock already holds the rate; generation takes longer.
                        </Typography>
                    </Box>
                </Box>
                {planSlot && <Box sx={{ mt: 2 }}>{planSlot}</Box>}
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                    Note: Each output machine’s total output swings are divided equally among its output inserters; per-inserter counts may be fractional.
                </Typography>
            </AccordionDetails>
        </Accordion>
    );
}
