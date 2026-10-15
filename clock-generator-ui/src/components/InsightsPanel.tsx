import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { ClockInsight } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { GameName } from './GameName';
import { ExactTicks, SwingComparison } from './SwingComparison';

interface InsightsPanelProps {
    insights: ClockInsight[];
    /** Name of the selected clock */
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
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>{insight.title}</Typography>
            <Part label="What" text={insight.what} />
            <Part label="Why" text={insight.why} />
            <Part label="Explanation" text={insight.explanation} />
            {insight.swing_comparison && <SwingComparison data={insight.swing_comparison} />}
            {insight.table && (insight.swing_comparison ? <ExactTicks><InsightTable table={insight.table} /></ExactTicks> : <InsightTable table={insight.table} />)}
        </Paper>
    );
}

function InsightTable({ table }: { table: NonNullable<ClockInsight['table']> }) {
    const { names, nameIdsIn } = useGameNames();
    // a cell that is exactly an id of the game data shows its name; the engine's other text is left as it is
    const cellOf = (cell: string): ReactNode => {
        if (Object.hasOwn(names.recipe, cell) && !Object.hasOwn(names.item, cell)) return <GameName id={cell} kind="recipe" />;
        return Object.hasOwn(names.item, cell) ? <GameName id={cell} /> : nameIdsIn(cell);
    };
    return (
        <>
            {(
                <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                {table.columns.map(column => <TableCell key={column}>{column}</TableCell>)}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {table.rows.map((row, index) => (
                                <TableRow key={index}>
                                    {row.map((cell, column) => <TableCell key={column}>{cellOf(cell)}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </>
    );
}

/**
 * A readable report of what the simulation found: first what holds for the build whichever clock is picked,
 * then what is particular to the selected clock.
 */
export function InsightsPanel({ insights, clockLabel, children }: InsightsPanelProps) {
    const build = insights.filter(insight => insight.scope === 'build');
    const clock = insights.filter(insight => insight.scope === 'clock');

    return (
        <Box>
            <Typography variant="h6" component="h2">About this clock{clockLabel ? `: ${clockLabel}` : ''}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                What is particular to the clock selected above.
            </Typography>
            {clock.map(insight => <InsightCard key={insight.id} insight={insight} />)}
            {children}
            {clock.length === 0 && !children && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Nothing stands out: this clock swings as planned and holds the target rate.
                </Typography>
            )}

            <Typography variant="h6" component="h2" sx={{ mt: 3 }}>About this build</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                The limits every clock for this build has to work within.
            </Typography>
            {build.map(insight => <InsightCard key={insight.id} insight={insight} />)}
        </Box>
    );
}
