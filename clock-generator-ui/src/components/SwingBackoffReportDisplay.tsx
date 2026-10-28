import { useState } from 'react';
import { Alert, AlertTitle, Button, Chip, Typography } from '@mui/material';
import type { SwingAttemptResult, SwingBackoffReport } from 'clock-generator/browser';
import { AppDialog } from './AppDialog';
import { DataTable } from './DataTable';

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
        ? `Output swings reduced from ${report.initial_terminal_swing_count} → ${report.stable_terminal_swing_count} so the clock holds the rate`
        : `No swing count that holds the rate was found (started at ${report.initial_terminal_swing_count}); original result used`;

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
                        { header: 'Result', align: 'center', cell: attempt => <Chip label={attempt.holds ? 'Holds the rate' : 'Does not hold it'}
                            color={attempt.holds ? 'success' : 'error'} size="small" variant="outlined" /> },
                    ]} />
            </AppDialog>
        </>
    );
}
