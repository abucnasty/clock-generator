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
import type { ReactNode } from 'react';

interface OverridesFormProps {
    lcm?: number;
    terminalSwingCount?: number;
    useFractionalSwings?: boolean;
    searchForFewerWakeUps?: boolean;
    onUpdate: (field: 'lcm' | 'terminal_swing_count' | 'use_fractional_swings' | 'search_for_fewer_wake_ups', value: number | boolean | undefined) => void;
    /** The swing plan of the last check, under the fields */
    planSlot?: ReactNode;
}

export function OverridesForm({
    lcm,
    terminalSwingCount,
    useFractionalSwings,
    searchForFewerWakeUps,
    onUpdate,
    planSlot,
}: OverridesFormProps) {
    return (
        <Accordion slotProps={{ heading: { component: 'h2' } }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6" component="span">
                    Advanced Overrides (Optional)
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
                        helperText="Override the calculated LCM. The swing plan below shows the calculated value."
                    />
                    <Tooltip
                        title="Uses exactly this many output swings per crafting cycle for every potential clock, even if the result is unstable. Leave empty to let the generator pick the count, lower it until the output is stable, and offer other counts as potential clocks."
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
                        title="Runs the four searches for every build: observed windows, uneven output swings, shifted swings and full-hand output swings. They take most of the time of a generation, so by default they only run when no clock made without a search is stable. Where one is, a search can still find a stable clock with fewer wake-ups: turn this on to look for it."
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
