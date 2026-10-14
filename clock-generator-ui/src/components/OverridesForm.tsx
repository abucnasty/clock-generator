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

interface OverridesFormProps {
    lcm?: number;
    terminalSwingCount?: number;
    useFractionalSwings?: boolean;
    nonMovingBelts?: boolean;
    searchForFewerWakeUps?: boolean;
    onUpdate: (field: 'lcm' | 'terminal_swing_count' | 'use_fractional_swings' | 'non_moving_belts' | 'search_for_fewer_wake_ups', value: number | boolean | undefined) => void;
}

export function OverridesForm({
    lcm,
    terminalSwingCount,
    useFractionalSwings,
    nonMovingBelts,
    searchForFewerWakeUps,
    onUpdate,
}: OverridesFormProps) {
    return (
        <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
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
                        helperText="Override the calculated LCM"
                    />
                    <Tooltip
                        title="Uses exactly this many output swings per crafting cycle for every potential clock, even if the result is unstable. Leave empty to let the generator pick the count, lower it until the output is stable, and offer other counts as potential clocks."
                        arrow
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
                        title="Turn on when the belts your inserters pick up from are backed up and standing still. By default a clock is made for a moving belt: each window of an inserter that picks up from a belt stays open a few ticks longer (belt pickup slack), because a pickup can come late on a moving belt, and a non-moving belt clock is only selected when no other holds the target rate. When enabled, every clock is made without the slack and the one with the fewest wake-ups is selected. A clock that does not hold the target rate without the slack is listed as unstable."
                        arrow
                        placement="top"
                    >
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={nonMovingBelts ?? false}
                                    color="primary"
                                    onChange={(e) =>
                                        onUpdate(
                                            'non_moving_belts',
                                            e.target.checked ? true : undefined
                                        )
                                    }
                                />
                            }
                            label="Belts do not move"
                            sx={{ ml: 1 }}
                        />
                    </Tooltip>
                    <Tooltip
                        title="Runs the four searches for every build: observed windows, uneven output swings, shifted swings and full-hand output swings. They take most of the time of a generation, so by default they only run when no clock made without a search is stable. Where one is, a search can still find a stable clock with fewer wake-ups: turn this on to look for it."
                        arrow
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
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                    Note: If the final output machine has more than one inserter, the output swings you force are divided equally between them.
                </Typography>
            </AccordionDetails>
        </Accordion>
    );
}
