import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Collapse,
    Typography,
} from '@mui/material';
import { useId, type ReactNode } from 'react';
import { useBuildSection } from '../hooks/useBuildViewContext';
import type { ClockInsight } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { GameName } from './GameName';
import { Panel } from './Panel';
import { DataTable } from './DataTable';
import { ExactTicks, SwingComparison } from './SwingComparison';

/** Every string of the panel that is not the engine's */
const INSIGHTS_COPY = {
    clockHeading: 'Notes on this clock',
    clockIntro: 'What is particular to the clock shown at the top.',
    nothing: 'Nothing stands out: this clock swings as planned and holds the setpoint.',
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
    /** What the clock's notes say when it has none here; "Nothing stands out" when not given */
    nothing?: string;
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

/**
 * One finding: its title, what it is in a sentence, and the reasons behind "Why?", with its chart or table. A finding with no
 * "why" (that of a clock that overproduces) shows its explanation under what was found, with no "Why?"
 */
export function InsightCard({ insight, level = 4 }: { insight: ClockInsight; level?: 3 | 4 }) {
    const { nameIdsIn } = useGameNames();
    const [open, setOpen] = useBuildSection(`insight:${insight.id}`);
    const reasonsId = useId();
    const hasWhy = insight.why !== '';
    // a note with no explanation shows no Explanation label
    const explanation = insight.explanation !== '' && <Part label={INSIGHTS_COPY.explanation}><Typography variant="body2">{nameIdsIn(insight.explanation)}</Typography></Part>;
    return (
        <Panel title={nameIdsIn(insight.title)} level={level} data-insight={insight.id}>
            <Part label={INSIGHTS_COPY.what}>
                <Typography variant="body2">{nameIdsIn(insight.what)}</Typography>
                {hasWhy && <Button
                    size="small"
                    aria-expanded={open}
                    aria-controls={reasonsId}
                    onClick={() => setOpen(!open)}
                    endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
                    // the label lines up with the sentence above it
                    sx={{ mt: 0.25, ml: -0.75, minWidth: 0 }}
                >
                    {INSIGHTS_COPY.whyButton}
                </Button>}
            </Part>
            {hasWhy ? <Collapse in={open} id={reasonsId}>
                <Part label={INSIGHTS_COPY.why}><Typography variant="body2">{nameIdsIn(insight.why)}</Typography></Part>
                {explanation}
            </Collapse> : explanation}
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
        <DataTable label={`${title} table`} sx={{ mt: 1 }} rows={table.rows} rowKey={(_, index) => index}
            columns={table.columns.map((column, index) => ({ header: column, align: numeric[index] ? 'right' as const : 'left' as const, cell: (row: string[]) => cellOf(row[index], column) }))} />
    );
}

/**
 * What the simulation found: what is particular to the selected clock, each finding in a sentence with its reasons
 * behind "Why?"; then, folded away, what holds for the build whichever clock is picked.
 */
export function InsightsPanel({ insights, children, nothing = INSIGHTS_COPY.nothing }: InsightsPanelProps) {
    const [buildOpen, setBuildOpen] = useBuildSection('insights-build');
    const build = insights.filter(insight => insight.scope === 'build');
    const clock = insights.filter(insight => insight.scope === 'clock');
    const buildSummaryId = useId();

    return (
        <Box>
            <Panel title={INSIGHTS_COPY.clockHeading} level={3}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {INSIGHTS_COPY.clockIntro}
                </Typography>
                {clock.map(insight => <InsightCard key={insight.id} insight={insight} />)}
                {children}
                {clock.length === 0 && !children && (
                    <Typography variant="body2" color="text.secondary">{nothing}</Typography>
                )}
            </Panel>

            {build.length > 0 && (
                <Accordion expanded={buildOpen} onChange={(_, open) => setBuildOpen(open)} disableGutters variant="outlined" slotProps={{ heading: { component: 'h3' }, region: { 'aria-labelledby': buildSummaryId } }}>
                    <AccordionSummary id={buildSummaryId} expandIcon={<ExpandMoreIcon />}>
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
