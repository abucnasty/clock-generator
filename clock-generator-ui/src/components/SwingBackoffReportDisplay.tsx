import { useState } from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { SwingAttemptResult, SwingBackoffReport } from 'clock-generator/browser';

interface SwingBackoffReportDisplayProps {
    report: SwingBackoffReport | null;
}

export function SwingBackoffReportDisplay({ report }: SwingBackoffReportDisplayProps) {
    const [open, setOpen] = useState(false);

    if (!report || !report.triggered) {
        return null;
    }

    const isSuccess = report.stable_terminal_swing_count !== null;
    const allAttempts: SwingAttemptResult[] = [report.initial_attempt, ...report.attempts];

    const summaryText = isSuccess
        ? `Output swings reduced from ${report.initial_terminal_swing_count} → ${report.stable_terminal_swing_count} for stable output`
        : `No stable swing count found (started at ${report.initial_terminal_swing_count}); original result used`;

    return (
        <>
            <Alert
                severity={isSuccess ? 'warning' : 'error'}
                sx={{ mt: 2 }}
                action={
                    <Button color="inherit" size="small" onClick={() => setOpen(true)}>
                        View Details
                    </Button>
                }
            >
                <AlertTitle>
                    {isSuccess ? 'Output Swing Backoff Triggered' : 'Output Swing Backoff Failed'}
                </AlertTitle>
                <Typography variant="body2">{summaryText}</Typography>
            </Alert>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {isSuccess ? 'Output Swing Backoff Report' : 'Output Swing Backoff Failed'}
                    <IconButton size="small" onClick={() => setOpen(false)} aria-label="close">
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </DialogTitle>

                <DialogContent dividers>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        {isSuccess ? (
                            <>
                                The initial swing count of{' '}
                                <strong>{report.initial_terminal_swing_count}</strong> produced unstable
                                output. A stable result was found at{' '}
                                <strong>{report.stable_terminal_swing_count}</strong> swings.
                            </>
                        ) : (
                            <>
                                The initial swing count of{' '}
                                <strong>{report.initial_terminal_swing_count}</strong> produced unstable
                                output, and no stable swing count was found during backoff. The result from{' '}
                                <strong>{report.initial_terminal_swing_count}</strong> swings was used.
                                Consider adjusting your configuration or disabling swing backoff in
                                Advanced Overrides.
                            </>
                        )}
                    </Typography>

                    <Box>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Output Swings</TableCell>
                                        <TableCell align="right">Actual Items</TableCell>
                                        <TableCell align="right">Expected Items</TableCell>
                                        <TableCell align="center">Result</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {allAttempts.map((attempt, index) => (
                                        <TableRow
                                            key={attempt.terminal_swing_count}
                                            sx={attempt.is_stable ? { backgroundColor: 'action.selected' } : undefined}
                                        >
                                            <TableCell>
                                                {attempt.terminal_swing_count}
                                                {index === 0 && (
                                                    <Typography
                                                        component="span"
                                                        variant="caption"
                                                        color="text.secondary"
                                                        sx={{ ml: 0.5 }}
                                                    >
                                                        (initial)
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell align="right">{attempt.actual_output_items}</TableCell>
                                            <TableCell align="right">{attempt.expected_output_items}</TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={attempt.is_stable ? 'Stable' : 'Unstable'}
                                                    color={attempt.is_stable ? 'success' : 'error'}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                </DialogContent>
            </Dialog>
        </>
    );
}
