import { ExpandMore } from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    FormControlLabel,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useId, type ReactNode } from 'react';
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
                    <Tooltip
                        title="Uses exactly this many output swings per crafting cycle for every clock, even if the clock does not hold the rate. Leave empty to let the generator pick the count, lower it until the output holds the rate, and offer other counts as clocks."
                        arrow
                        describeChild
                        placement="top"
                    >
                        <TextField
                            label="Force Output Swings"
                            type="number"
                            value={terminalSwingCount ?? ''}
                            onChange={(e) =>
                                onUpdate(
                                    'terminal_swing_count',
                                    parseInt(e.target.value) || undefined
                                )
                            }
                            slotProps={{ htmlInput: { min: 1 } }}
                            sx={{ width: 240 }}
                            size="small"
                            helperText="Per output inserter, per crafting cycle"
                        />
                    </Tooltip>
                    <Tooltip 
                        title="When enabled, inserters with fractional swing counts (e.g., 1.5 swings per cycle) will distribute swings across multiple sub-cycles. For example, 3/2 swings becomes 1 swing in the first sub-cycle and 2 swings in the second."
                        arrow
                        describeChild
                        placement="top"
                    >
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={useFractionalSwings ?? false}
                                    color="primary"
                                    onChange={(e) =>
                                        onUpdate(
                                            'use_fractional_swings',
                                            e.target.checked ? true : undefined
                                        )
                                    }
                                />
                            }
                            label="Enable Fractional Swings"
                            sx={{ ml: 1 }}
                        />
                    </Tooltip>
                    <Tooltip
                        title="Runs the four searches for every build: observed wake windows, uneven output swings, shifted swings and full-hand output swings. They take most of the time of a generation, so by default they only run when no clock made without a search is stable. Where one is, a search can still find a stable clock with fewer wake-ups: turn this on to look for it."
                        arrow
                        describeChild
                        placement="top"
                    >
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={searchForFewerWakeUps ?? false}
                                    color="primary"
                                    onChange={(e) =>
                                        onUpdate(
                                            'search_for_fewer_wake_ups',
                                            e.target.checked ? true : undefined
                                        )
                                    }
                                />
                            }
                            label="Search for fewer wake-ups"
                            sx={{ ml: 1 }}
                        />
                    </Tooltip>
                </Box>
                {planSlot && <Box sx={{ mt: 2 }}>{planSlot}</Box>}
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                    Note: If the final output machine has more than one inserter, the output swings you force are divided equally between them.
                </Typography>
            </AccordionDetails>
        </Accordion>
    );
}
