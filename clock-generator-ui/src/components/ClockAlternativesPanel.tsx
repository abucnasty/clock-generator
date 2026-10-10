import { InfoOutlined } from '@mui/icons-material';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Paper,
    Radio,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';

// fractional (subtick) periods are shown to 3 decimals
const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

function statusDetail(alternative: ClockAlternativeView): string {
    const check = alternative.asBuilt;
    if (!check) {
        return 'Not checked';
    }
    const phases = `${check.start_phases_checked} clock start phase(s) simulated`;
    if (check.repeat_periods === undefined || check.repeat_output_items === undefined) {
        return phases;
    }
    return `${phases}. The build repeats every ${check.repeat_periods} periods, moving ${check.repeat_output_items} of `
        + `${alternative.expectedOutputItems * check.repeat_periods} items over them`;
}

interface ClockAlternativesPanelProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** Labels of alternatives still being generated */
    pending?: string[];
}

export function ClockAlternativesPanel({ alternatives, selectedIndex, onSelect, pending = [] }: ClockAlternativesPanelProps) {
    const [showUnstable, setShowUnstable] = useState(false);

    if (alternatives.length === 0 && pending.length === 0) {
        return null;
    }

    // unstable clocks are hidden until asked for, unless nothing is stable: then they are all there is to look at
    const unstableCount = alternatives.filter(alternative => !alternative.isStable).length;
    const anyStable = unstableCount < alternatives.length;
    const hidesUnstable = anyStable && !showUnstable;
    const rows = alternatives
        .map((alternative, index) => ({ alternative, index }))
        .filter(({ alternative, index }) => !hidesUnstable || alternative.isStable || index === selectedIndex);
    const hiddenCount = alternatives.length - rows.length;

    return (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
            <Typography variant="h6">Potential Clocks</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Each potential clock was checked by simulating the build driven only by the clock windows,
                starting the clock at several points. The one selected for you has the fewest wake-ups among
                those that hold the target rate; a clock that leaves belt pickup slack out for a non-moving
                belt is only selected when no clock for a moving belt holds it. With "Belts do not move" on
                every clock is made without the slack. Fewer windows means more batched swings.
                Select one to show its blueprint and timelines.
                {!anyStable && alternatives.length > 0 && pending.length === 0 && (
                    <> None of the clocks tried holds the target rate, so the unstable ones are listed.</>
                )}
            </Typography>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox" />
                            <TableCell>Clock</TableCell>
                            <TableCell>
                                <Tooltip
                                    title="The belt the clock is made for. Moving: each window of an inserter that picks up from a belt stays open the ticks shown longer (belt pickup slack), so a pickup that comes late on a moving belt can finish; a rule of thumb, not a simulated belt. Non-moving belt: the windows fit a belt that is full and does not move, which is what the simulator models; on a moving belt an inserter can be switched off holding a partial hand. A subtick clock is always made for a non-moving belt, and is not ranked behind other clocks for it. Blank when no clocked inserter picks up from a belt."
                                    arrow
                                >
                                    <span>Belt</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">
                                <Tooltip
                                    title="Swings each output inserter makes per crafting cycle. The clock repeats after a whole number of cycles (the clock period)."
                                    arrow
                                >
                                    <span>Output swings</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">Clock period</TableCell>
                            <TableCell align="right">Inserter windows</TableCell>
                            <TableCell align="right">
                                <Tooltip
                                    title="How often a machine wakes an inserter that is enabled and waiting on it, per minute, summed over the inserters of one copy of the build in a long run of this clock. Each wake-up is a check that moves little or nothing; fewer is better. Shown for clocks that were run long enough to count them."
                                    arrow
                                >
                                    <span>Wake-ups (per min)</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">Rate achieved (items/s)</TableCell>
                            <TableCell align="right">Clock-only output</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(({ alternative, index }) => (
                            <TableRow
                                key={alternative.id}
                                hover
                                selected={index === selectedIndex}
                                onClick={() => onSelect(index)}
                                sx={{ cursor: 'pointer' }}
                            >
                                <TableCell padding="checkbox">
                                    <Radio checked={index === selectedIndex} size="small" />
                                </TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        {alternative.label}
                                        <Tooltip
                                            title={<Typography variant="body2">{alternative.description}</Typography>}
                                            placement="right"
                                            arrow
                                        >
                                            <InfoOutlined
                                                fontSize="small"
                                                color="action"
                                                aria-label={`How ${alternative.label} is made`}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </Tooltip>
                                    </Box>
                                </TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{alternative.beltLabel}</TableCell>
                                <TableCell align="right">
                                    {alternative.terminalSwingCount} per {formatTicks(alternative.cycleTicks)} ticks
                                </TableCell>
                                <TableCell align="right">{formatTicks(alternative.simulationDurationTicks)} ticks</TableCell>
                                <TableCell align="right">{alternative.inserterWindowCount}</TableCell>
                                <TableCell align="right">
                                    {alternative.asBuilt?.wake_ups
                                        ? Math.round(alternative.asBuilt.wake_ups.wake_ups_per_minute)
                                        : '—'}
                                </TableCell>
                                <TableCell align="right">{alternative.itemsPerSecond.toFixed(2)}</TableCell>
                                <TableCell align="right">
                                    {alternative.asBuilt
                                        ? `${alternative.asBuilt.actual_output_items} / ${alternative.expectedOutputItems}`
                                        : '—'}
                                </TableCell>
                                <TableCell>
                                    <Tooltip title={statusDetail(alternative)} arrow>
                                        <Chip
                                            size="small"
                                            label={alternative.isStable ? 'Stable' : 'Unstable'}
                                            color={alternative.isStable ? 'success' : 'error'}
                                            variant="outlined"
                                        />
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                        {pending.map(label => (
                            <TableRow key={`pending-${label}`}>
                                <TableCell padding="checkbox">
                                    <CircularProgress size={16} sx={{ ml: 1.5 }} />
                                </TableCell>
                                <TableCell colSpan={9} sx={{ color: 'text.secondary' }}>
                                    {label}: computing…
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            {anyStable && (showUnstable ? unstableCount > 0 : hiddenCount > 0) && (
                <Box sx={{ mt: 1 }}>
                    <Button size="small" onClick={() => setShowUnstable(shown => !shown)}>
                        {showUnstable
                            ? `Hide ${unstableCount} unstable clock${unstableCount === 1 ? '' : 's'}`
                            : `Show ${hiddenCount} unstable clock${hiddenCount === 1 ? '' : 's'} that ${hiddenCount === 1 ? 'was' : 'were'} tried`}
                    </Button>
                </Box>
            )}
        </Paper>
    );
}
