import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Collapse,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import type { ClockInsight } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { GameName } from './GameName';
import { Panel } from './Panel';
import { ScrollX } from './ScrollX';
import { ExactTicks, SwingComparison } from './SwingComparison';

/** Every string of the panel that is not the engine's */
const INSIGHTS_COPY = {
    clockHeading: 'Notes on this clock',
    clockIntro: 'What is particular to the clock shown at the top.',
    nothing: 'Nothing stands out: this clock swings as planned and holds the target rate.',
    buildHeading: 'About this build: what every clock has to work within',
    what: 'What',
    why: 'Why',
    explanation: 'Explanation',
    whyButton: 'Why?',
};

/** The width of a part's label, so every card's text starts at the same place */
const LABEL_WIDTH = 110;
/** A line of prose no longer than this, so it reads as a paragraph and not one long line */
const PROSE_WIDTH = '75ch';

interface InsightsPanelProps {
    insights: ClockInsight[];
    /** Insights drawn by the page itself (a chart, a report), listed with the selected clock's */
    children?: ReactNode;
}

function Part({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 0.75 }}>
            <Typography variant="body2" color="text.secondary" sx={{ width: LABEL_WIDTH, flexShrink: 0, fontWeight: 600 }}>
                {label}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0, maxWidth: PROSE_WIDTH }}>{children}</Box>
        </Box>
    );
}

/** One finding: its title, what it is in a sentence, and the reasons behind "Why?", with its chart or table */
function InsightCard({ insight }: { insight: ClockInsight }) {
    const { nameIdsIn } = useGameNames();
    const [open, setOpen] = useState(false);
    const reasonsId = useId();
    return (
        <Panel title={nameIdsIn(insight.title)} level={4}>
            <Part label={INSIGHTS_COPY.what}>
                <Typography variant="body2">{nameIdsIn(insight.what)}</Typography>
                <Button
                    size="small"
                    aria-expanded={open}
                    aria-controls={reasonsId}
                    onClick={() => setOpen(shown => !shown)}
                    endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
                    // the label lines up with the sentence above it
                    sx={{ mt: 0.25, ml: -0.75, minWidth: 0 }}
                >
                    {INSIGHTS_COPY.whyButton}
                </Button>
            </Part>
            <Collapse in={open} id={reasonsId}>
                <Part label={INSIGHTS_COPY.why}><Typography variant="body2">{nameIdsIn(insight.why)}</Typography></Part>
                <Part label={INSIGHTS_COPY.explanation}><Typography variant="body2">{nameIdsIn(insight.explanation)}</Typography></Part>
            </Collapse>
            {insight.swing_comparison && <SwingComparison data={insight.swing_comparison} />}
            {insight.table && (insight.swing_comparison ? <ExactTicks><InsightTable table={insight.table} title={insight.title} /></ExactTicks> : <InsightTable table={insight.table} title={insight.title} />)}
        </Panel>
    );
}

/** A cell that is a number, with a unit or none: "12", "4.5 ticks", "93%", "240/s" */
const NUMERIC_CELL = /^[-+−]?\d[\d,.]*\s*(ticks?|%|\/s|\/min|s|×)?$/;

/** The columns whose every cell is a number, which line up on the right as numbers do */
function numericColumns(table: NonNullable<ClockInsight['table']>): boolean[] {
    return table.columns.map((_, column) => {
        const cells = table.rows.map(row => (row[column] ?? '').trim()).filter(cell => cell !== '' && cell !== '—');
        return cells.length > 0 && cells.every(cell => NUMERIC_CELL.test(cell));
    });
}

function InsightTable({ table, title }: { table: NonNullable<ClockInsight['table']>; title: string }) {
    const { names, nameIdsIn } = useGameNames();
    const numeric = numericColumns(table);
    // a cell that is exactly an id of the game data shows its name; the engine's other text is left as it is
    const cellOf = (cell: string, columnName: string): ReactNode => {
        if (columnName === 'Recipe' && Object.hasOwn(names.recipe, cell)) return <GameName id={cell} kind="recipe" />;
        if (Object.hasOwn(names.recipe, cell) && !Object.hasOwn(names.item, cell)) return <GameName id={cell} kind="recipe" />;
        return Object.hasOwn(names.item, cell) ? <GameName id={cell} /> : nameIdsIn(cell);
    };
    return (
        <ScrollX label={`${title} table`} sx={{ mt: 1 }}>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        {table.columns.map((column, index) => (
                            <TableCell key={column} align={numeric[index] ? 'right' : 'left'}>{column}</TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {table.rows.map((row, index) => (
                        <TableRow key={index}>
                            {row.map((cell, column) => (
                                <TableCell key={column} align={numeric[column] ? 'right' : 'left'}>{cellOf(cell, table.columns[column])}</TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </ScrollX>
    );
}

/**
 * What the simulation found: what is particular to the selected clock, each finding in a sentence with its reasons
 * behind "Why?"; then, folded away, what holds for the build whichever clock is picked.
 */
export function InsightsPanel({ insights, children }: InsightsPanelProps) {
    const build = insights.filter(insight => insight.scope === 'build');
    const clock = insights.filter(insight => insight.scope === 'clock');

    return (
        <Box>
            <Panel title={INSIGHTS_COPY.clockHeading} level={3}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {INSIGHTS_COPY.clockIntro}
                </Typography>
                {clock.map(insight => <InsightCard key={insight.id} insight={insight} />)}
                {children}
                {clock.length === 0 && !children && (
                    <Typography variant="body2" color="text.secondary">{INSIGHTS_COPY.nothing}</Typography>
                )}
            </Panel>

            {build.length > 0 && (
                <Accordion disableGutters variant="outlined" slotProps={{ heading: { component: 'h3' } }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>{INSIGHTS_COPY.buildHeading}</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        {build.map(insight => <InsightCard key={insight.id} insight={insight} />)}
                    </AccordionDetails>
                </Accordion>
            )}
        </Box>
    );
}
