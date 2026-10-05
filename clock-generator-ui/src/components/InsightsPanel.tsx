import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { ClockInsight } from 'clock-generator/browser';

interface InsightsPanelProps {
    insights: ClockInsight[];
    /** Name of the selected potential clock */
    clockLabel: string | null;
    /** Insights drawn by the page itself (a chart, a report), listed with the selected clock's */
    children?: ReactNode;
}

function Part({ label, text }: { label: string; text: string }) {
    return (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 0.75 }}>
            <Typography variant="body2" color="text.secondary" sx={{ width: 110, flexShrink: 0, fontWeight: 600 }}>
                {label}
            </Typography>
            <Typography variant="body2" sx={{ flex: 1 }}>{text}</Typography>
        </Box>
    );
}

function InsightCard({ insight }: { insight: ClockInsight }) {
    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{insight.title}</Typography>
            <Part label="What" text={insight.what} />
            <Part label="Why" text={insight.why} />
            <Part label="Explanation" text={insight.explanation} />
            {insight.table && (
                <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                {insight.table.columns.map(column => <TableCell key={column}>{column}</TableCell>)}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {insight.table.rows.map((row, index) => (
                                <TableRow key={index}>
                                    {row.map((cell, column) => <TableCell key={column}>{cell}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Paper>
    );
}

/**
 * A readable report of what the simulation found: first what holds for the build whichever clock is picked,
 * then what is particular to the selected potential clock.
 */
export function InsightsPanel({ insights, clockLabel, children }: InsightsPanelProps) {
    const build = insights.filter(insight => insight.scope === 'build');
    const clock = insights.filter(insight => insight.scope === 'clock');

    return (
        <Box>
            <Typography variant="h6">About this clock{clockLabel ? `: ${clockLabel}` : ''}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                What is particular to the potential clock selected above.
            </Typography>
            {clock.map(insight => <InsightCard key={insight.id} insight={insight} />)}
            {children}
            {clock.length === 0 && !children && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Nothing stands out: this clock swings as planned and holds the target rate.
                </Typography>
            )}

            <Typography variant="h6" sx={{ mt: 3 }}>About this build</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                The limits every potential clock for this configuration has to work within.
            </Typography>
            {build.map(insight => <InsightCard key={insight.id} insight={insight} />)}
        </Box>
    );
}
