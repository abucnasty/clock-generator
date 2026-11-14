import { useState } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Typography } from '@mui/material';
import type { SwingAttemptResult, SwingBackoffReport } from 'clock-generator/browser';
import { attemptResultOf } from '../utils/clockSummary';
import { AppDialog } from './AppDialog';
import { DataTable } from './DataTable';

interface SwingBackoffReportDisplayProps {
    report: SwingBackoffReport | null;
    /**
     * Which report this place shows: "succeeded", the swing count that holds, in plain text inside Model and tested starts;
     * "failed", none found, as the alert on Overview
     */
    shows: 'succeeded' | 'failed';
}

export function SwingBackoffReportDisplay({ report, shows }: SwingBackoffReportDisplayProps) {
    const [open, setOpen] = useState(false);

    if (!report || !report.triggered) {
        return null;
    }

    const isSuccess = report.stable_terminal_swing_count !== null;
    if (isSuccess !== (shows === 'succeeded')) {
        return null;
    }
    const allAttempts: SwingAttemptResult[] = [report.initial_attempt, ...report.attempts];

    const summaryText = isSuccess
        ? `Output swings reduced from ${report.initial_terminal_swing_count} → ${report.stable_terminal_swing_count} so the clock holds the rate`
        : `No swing count that holds the rate was found (started at ${report.initial_terminal_swing_count}); original result used`;

    const details = (
        <Button color="inherit" size="small" onClick={() => setOpen(true)}>
            View Details
        </Button>
    );

    return (
        <>
            {isSuccess ? (
                <Box sx={{ mt: 1 }} data-swing-backoff="">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Output Swing Backoff Triggered</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
                        <Typography variant="body2">{summaryText}</Typography>
                        {details}
                    </Box>
                </Box>
            ) : (
                <Alert severity="error" sx={{ mt: 2 }} action={details}>
                    <AlertTitle>Output Swing Backoff Failed</AlertTitle>
                    <Typography variant="body2">{summaryText}</Typography>
                </Alert>
            )}

            <AppDialog open={open} onClose={() => setOpen(false)} closeButton dividers
                title={isSuccess ? 'Output Swing Backoff Report' : 'Output Swing Backoff Failed'}>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    {isSuccess ? (
                        <>
                            The initial swing count of{' '}
                            <strong>{report.initial_terminal_swing_count}</strong> did not hold the
                            rate. It held at{' '}
                            <strong>{report.stable_terminal_swing_count}</strong> swings.
                        </>
                    ) : (
                        <>
                            The initial swing count of{' '}
                            <strong>{report.initial_terminal_swing_count}</strong> did not hold the
                            rate, and no swing count that holds it was found during backoff. The result from{' '}
                            <strong>{report.initial_terminal_swing_count}</strong> swings was used.
                            Consider adjusting your build or disabling swing backoff in
                            Advanced.
                        </>
                    )}
                </Typography>
                <DataTable label="Swing counts tried" rows={allAttempts} rowKey={attempt => attempt.terminal_swing_count}
                    rowSx={attempt => attempt.holds ? { backgroundColor: 'action.selected' } : undefined} columns={[
                        { header: 'Output Swings', cell: (attempt, index) => <>
                            {attempt.terminal_swing_count}
                            {index === 0 && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(initial)</Typography>}
                        </> },
                        { header: 'Actual Items', align: 'right', cell: attempt => attempt.actual_output_items },
                        { header: 'Expected Items', align: 'right', cell: attempt => attempt.expected_output_items },
                        { header: 'Result', align: 'center', cell: attempt => <Chip label={attemptResultOf(attempt)}
                            color={attempt.holds ? 'success' : 'error'} size="small" variant="outlined" /> },
                    ]} />
            </AppDialog>
        </>
    );
}
