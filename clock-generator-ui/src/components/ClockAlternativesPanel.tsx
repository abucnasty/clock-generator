import { InfoOutlined } from '@mui/icons-material';
import {
    Box,
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
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';

interface ClockAlternativesPanelProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** Labels of alternatives still being generated */
    pending?: string[];
}

export function ClockAlternativesPanel({ alternatives, selectedIndex, onSelect, pending = [] }: ClockAlternativesPanelProps) {
    if (alternatives.length === 0 && pending.length === 0) {
        return null;
    }

    return (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
            <Typography variant="h6">Clock Alternatives</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Each alternative clock was checked by simulating the build driven only by the clock windows,
                starting the clock at several points. Fewer windows means more batched swings.
                Select one to show its blueprint and timelines.
            </Typography>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox" />
                            <TableCell>Alternative</TableCell>
                            <TableCell align="right">Output swings / cycle</TableCell>
                            <TableCell align="right">Inserter windows</TableCell>
                            <TableCell align="right">Rate (items/s)</TableCell>
                            <TableCell align="right">Clock-only output</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {alternatives.map((alternative, index) => (
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
                                <TableCell align="right">{alternative.terminalSwingCount}</TableCell>
                                <TableCell align="right">{alternative.inserterWindowCount}</TableCell>
                                <TableCell align="right">{alternative.itemsPerSecond.toFixed(2)}</TableCell>
                                <TableCell align="right">
                                    {alternative.asBuilt
                                        ? `${alternative.asBuilt.actual_output_items} / ${alternative.expectedOutputItems}`
                                        : '—'}
                                </TableCell>
                                <TableCell>
                                    <Tooltip
                                        title={alternative.asBuilt
                                            ? `${alternative.asBuilt.start_phases_checked} clock start phase(s) simulated`
                                            : 'Not checked'}
                                        arrow
                                    >
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
                                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                                    {label}: computing…
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Paper>
    );
}
