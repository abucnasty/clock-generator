import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Box,
    CircularProgress,
    IconButton,
    Radio,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import { useHeldOrder } from '../hooks/useHeldOrder';
import { CLOCK_TABLE_NAME, CLOCK_TABLE_REGION, clockHelpName, termsHelpName } from '../utils/a11yLabels';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { shownRateOf } from '../utils/shownRate';
import { SUMMARY_COPY, foldedMakes, recoversOf, statusOf, wakeUpsAverageOf } from '../utils/clockSummary';
import { directRouterOf, familyCopyOf, fullClockName, clockChipsOf, sourceLinesOf, strategyNameOf } from '../utils/strategyNames';
import { ClockChips } from './StrategyChips';
import { SIGNAL_DEFINITION, WAKEUP_DEFINITION, TERMS_FOCUS, type GlossaryId } from '../utils/glossary';
import { HelpButton } from './HelpButton';
import { CauseHeadline } from './CheckedLanesView';
import { descriptionShown } from '../utils/checkedLanes';
import { ScrollX } from './ScrollX';
import { AppDialog } from './AppDialog';
import { ClockStatusMark } from './ClockStatusMark';
import { HANDS_TEXT } from '../utils/targetCounts';
import { TermsList } from './TermsPopover';
import { OUTPUT_PER_WINDOW_CYCLE_HEADER, SIGNALS_HEADER, WAKE_UPS_HEADER, formatNumberText, makesHeader } from '../utils/numberText';
import { RECOMMENDED_COPY, partitionClockRows, searchesRunLine, type ClockRow, type PickRule } from '../utils/recommendedClock';

/** The header of the column that counts a clock's decider combinators */
const DECIDERS_HEADER = 'Deciders';

// fractional (subtick) window cycles are shown to 3 decimals
const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

/** Every string of the table that is not the clocks' own or the pick's */
const COMPARE_COPY = {
    heading: 'Compare clocks',
    terms: 'About comparing clocks',
    clock: 'Clock',
    status: 'Status',
    howMadeHeading: 'How it is made',
    worksHeading: 'Status',
    swings: 'Output swings',
    windowCycle: 'Window cycle time',
    windows: 'Enable windows',
    details: 'Details',
    detailsOf: (name: string) => `Details of ${name}`,
    swingsHelp: 'Total output swings each output cycle of each output machine, shared equally across its output inserters. '
        + 'Per-inserter counts may be fractional. The clock repeats after a whole number of output cycles (the window cycle).',
    decidersHelp: 'How many decider combinators the clock\'s blueprint has to switch inserters and drills on and off, not counting the clock itself. Each one is wired to the inserters and drills its description names, so fewer deciders is less wiring to do by hand.',
    windowsHelp: 'How many enable windows the clock has in all: stretches of ticks during which it switches an inserter on.',
    signalsHelp: SIGNAL_DEFINITION + ' Counted per minute for one copy of the build, in the same run as the wakeups. Of clocks with the same wakeups, the one with fewer signals ranks first.',
    wakeUpsHelp: WAKEUP_DEFINITION + ' Counted per minute, summed over the inserters of one copy of the build '
        + 'in a long run of this clock. Shown for clocks that were run long enough to count them. It is the count from '
        + 'one start point, but on a build with a loop of machines: a clock there settles into another steady state from '
        + 'another start point, with another count, so its figure is the average over 12 start points, and the table says so.',
    noneRecover: 'No clock qualifies as stable across its completed checks. Compare its modeled rate, recovery and sampled starts separately.',
    noneHold: 'None of the clocks tried holds the setpoint, so they are all listed.',
    computing: (label: string) => `${label}: computing…`,
};

function statusDetail(alternative: ClockAlternativeView): string {
    const starts = alternative.assessment.start_dependence;
    const startup = starts ? `${starts.starts.filter(start => start.reaches_target).length} of ${starts.starts.length} sampled starts reached the target. ` : '';
    const recovery = recoversOf(alternative).detail;
    const check = alternative.asBuilt;
    if (!check) {
        return `${startup}Clock-phase check unavailable. ${recovery}`;
    }
    const phases = `${startup}${recovery} Checked from ${check.start_phases_checked} clock phase${check.start_phases_checked === 1 ? '' : 's'}`;
    if (check.repeat_window_cycles === undefined || check.repeat_output_items === undefined) {
        return phases;
    }
    return `${phases}. The build repeats every ${check.repeat_window_cycles} window cycles, moving ${check.repeat_output_items} of `
        + `${alternative.expectedOutputItems * check.repeat_window_cycles} items over them`;
}

/** The engine's description in sentences, so the popover reads as short paragraphs and not one block */
const sentencesOf = (text: string) => text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);


/** "Wakeups/min (1 copy)" is the name over "(1 copy)"; a head with no bracket is one line */
const splitHead = (label: string): [string, string | undefined] => {
    const at = label.lastIndexOf(' (');
    return at === -1 ? [label, undefined] : [label.slice(0, at), label.slice(at + 1)];
};

/**
 * A column's head: the name on the first line with its (?), the unit or "(1 copy)" under it in the secondary colour, and
 * no break inside either line. In a number column the (?) stands before the name, so that the words end where the
 * figures end.
 */
function Head({ label, help, numeric = false }: { label: string; help?: ReactNode; numeric?: boolean }) {
    const [name, unit] = splitHead(label);
    return (
        <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: numeric ? 'flex-end' : 'flex-start' }} data-head="">
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', columnGap: 0.25, whiteSpace: 'nowrap', flexDirection: numeric ? 'row-reverse' : 'row', minHeight: 22 }} data-head-name="">
                <span>{name}</span>
                {help && <Box component="span" sx={{ display: 'inline-flex', my: -0.5, mx: -0.5 }}>{help}</Box>}
            </Box>
            {unit && <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontWeight: 400 }} data-head-unit="">{unit}</Box>}
        </Box>
    );
}

const termsHelp = (label: string, focus: readonly GlossaryId[]) => (
    <HelpButton label={termsHelpName(label)}><TermsList focus={focus} /></HelpButton>
);
const textHelp = (label: string, help: string) => (
    <HelpButton label={`About ${label}`}><Typography variant="body2">{help}</Typography></HelpButton>
);

/** The (?) of the Status head: each status the column can show, once, then how the clocks are checked */
function StatusHelp() {
    return (
        <HelpButton label={`About ${COMPARE_COPY.status}`}>
            {SUMMARY_COPY.statusHelp.map(([word, meaning]) => (
                <Typography key={word} variant="body2" sx={{ mb: 0.75 }}><Box component="strong">{word}:</Box> {meaning}</Typography>
            ))}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{SUMMARY_COPY.statusChecks}</Typography>
        </HelpButton>
    );
}

/** The (?) of the Rank head: the engine's seven keys in order, and whether the slower searches ran */
function RankHelp({ pickRule }: { pickRule: PickRule | null }) {
    const { rank, rankLead, rankKeys, rankTie, rankFirst } = RECOMMENDED_COPY;
    return (
        <HelpButton label={`About ${rank}`}>
            <Typography variant="body2" sx={{ mb: 0.75 }}>{rankLead}</Typography>
            <Box component="ol" sx={{ m: 0, mb: 1, pl: 2.5, typography: 'body2', '& li': { mb: 0.5 } }}>
                {rankKeys.map(key => <li key={key}>{key}</li>)}
            </Box>
            <Typography variant="body2" sx={{ mb: 0.75 }}>{rankTie}</Typography>
            <Typography variant="body2" sx={{ mb: 0.75, fontWeight: 600 }}>{rankFirst}</Typography>
            <Typography variant="body2" color="text.secondary">{searchesRunLine(pickRule)}</Typography>
        </HelpButton>
    );
}

/**
 * The clock's name, its chips and its (?) on one line where the table has the width for it; where it has not (the
 * default columns), the chips wrap under the name, so that the Status column stays in view. The (?) wraps with the last
 * chip. With every column, the line never wraps: the table has every column only where its names fit (useAllColumns).
 */
const NAME_LINE_SX = { display: 'flex', alignItems: 'center', columnGap: 0.5, rowGap: 0.25, flexWrap: 'wrap' } as const;

/** The Clock cell: the name, its chips and its (?) on one line, then what is said beside the status */
function ClockNameCell({ alternative }: { alternative: ClockAlternativeView }) {
    const status = statusOf(alternative);
    return (
        <>
            {/* the status is the Status column's word and the place is the Rank's */}
            <Box sx={NAME_LINE_SX} data-name-line="">
                <Box component="span" sx={{ fontWeight: 600 }}>{strategyNameOf(alternative)}</Box>
                {/* the (?) stays with the last chip when the line wraps; the line that explains the clock's name stands on the card only */}
                <ClockChips clock={alternative} after={<Box component="span" sx={{ display: 'inline-flex', my: -0.75 }}>
                    <HelpButton label={clockHelpName(fullClockName(alternative))}>
                        <StrategyHelp clock={alternative} />
                        <Typography variant="subtitle2" component="p" sx={{ mb: 0.5 }}>{COMPARE_COPY.howMadeHeading}</Typography>
                        {sentencesOf(descriptionShown(alternative)).map(sentence => (
                            <Typography key={sentence} variant="body2" sx={{ mb: 0.75 }}>{sentence}</Typography>
                        ))}
                        <Typography variant="subtitle2" component="p" sx={{ mt: 1.5, mb: 0.5 }}>{COMPARE_COPY.worksHeading}</Typography>
                        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                            <ClockStatusMark kind={status.kind} />{status.text}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">{statusDetail(alternative)}</Typography>
                        {/* a clock not stable on a lane its copies share: its headline; Diagnostics of the selected clock shows the parts */}
                        {alternative.checkedLanes?.cause && <Box sx={{ mt: 1.5 }}><CauseHeadline cause={alternative.checkedLanes.cause} clock={alternative} /></Box>}
                    </HelpButton>
                </Box>} />
            </Box>
            {/* what is said beside the status: the rate, the reason code's words, or why the loss trials gave no answer */}
            {status.detail && <Typography variant="body2" color="text.secondary" data-status-detail="">{status.detail}</Typography>}
        </>
    );
}

type ColumnId = 'rank' | 'select' | 'clock' | 'makes' | 'wakeUps' | 'signals' | 'deciders' | 'swings' | 'windowCycle' | 'windows' | 'perWindowCycle' | 'status';
const NUMERIC: ReadonlySet<ColumnId> = new Set(['rank', 'makes', 'wakeUps', 'signals', 'deciders', 'swings', 'windowCycle', 'windows', 'perWindowCycle']);
/** The figures that are columns where the table has the width, and a details row under each clock where it has not */
const DETAIL_COLUMNS: readonly ColumnId[] = ['swings', 'windowCycle', 'windows', 'perWindowCycle'];

interface Shared {
    pickRule: PickRule | null; copies: number; counts: ClockAlternativeView['counts'];
    /**
     * Every figure a column: the Wakeups and Signals heads have the help of the table that had every column (what is
     * counted, and how), the default columns the Terms, as the two tables had them
     */
    allColumns: boolean;
}

const swingsLabel = (counts: ClockAlternativeView['counts']) => counts === 'destroyed' ? HANDS_TEXT.column : COMPARE_COPY.swings;
const swingsHelp = (counts: ClockAlternativeView['counts']) => counts === 'destroyed'
    ? textHelp(HANDS_TEXT.column, HANDS_TEXT.columnHelp) : textHelp(COMPARE_COPY.swings, COMPARE_COPY.swingsHelp);

/** A column's head */
function headOf(id: ColumnId, { pickRule, copies, counts, allColumns }: Shared): ReactNode {
    switch (id) {
        case 'rank': return <Head label={RECOMMENDED_COPY.rank} help={<RankHelp pickRule={pickRule} />} numeric />;
        case 'select': return <Box component="span" sx={VISUALLY_HIDDEN}>Select</Box>;
        case 'clock': return <Head label={COMPARE_COPY.clock} />;
        case 'makes': return <Head label={makesHeader(copies, counts)} numeric />;
        case 'wakeUps': return <Head label={WAKE_UPS_HEADER} numeric
            help={allColumns ? textHelp(WAKE_UPS_HEADER, COMPARE_COPY.wakeUpsHelp) : termsHelp(WAKE_UPS_HEADER, TERMS_FOCUS.wakeUps)} />;
        case 'signals': return <Head label={SIGNALS_HEADER} numeric
            help={allColumns ? textHelp(SIGNALS_HEADER, COMPARE_COPY.signalsHelp) : termsHelp(SIGNALS_HEADER, TERMS_FOCUS.signals)} />;
        case 'deciders': return <Head label={DECIDERS_HEADER} help={textHelp(DECIDERS_HEADER, COMPARE_COPY.decidersHelp)} numeric />;
        case 'swings': return <Head label={swingsLabel(counts)} help={swingsHelp(counts)} numeric />;
        case 'windowCycle': return <Head label={COMPARE_COPY.windowCycle} numeric />;
        case 'windows': return <Head label={COMPARE_COPY.windows} help={textHelp(COMPARE_COPY.windows, COMPARE_COPY.windowsHelp)} numeric />;
        case 'perWindowCycle': return <Head label={OUTPUT_PER_WINDOW_CYCLE_HEADER} numeric />;
        case 'status': return <Head label={COMPARE_COPY.status} help={<StatusHelp />} />;
    }
}

const swingsText = (alternative: ClockAlternativeView) => `${alternative.terminalSwingCount} per ${formatTicks(alternative.cycleTicks)} ticks`;
const windowCycleText = (alternative: ClockAlternativeView) => `${formatTicks(alternative.simulationDurationTicks)} ticks`;
const perWindowCycleText = (alternative: ClockAlternativeView) => alternative.asBuilt
    ? `${formatNumberText(alternative.asBuilt.actual_output_items)} / ${alternative.expectedOutputItems}`
    : '—';

/** A cell's content */
function cellOf(id: ColumnId, { alternative, index, rank }: ClockRow<ClockAlternativeView>, selectedIndex: number, onSelect: (index: number) => void): ReactNode {
    switch (id) {
        case 'rank': return rank;
        case 'select': return (
            // one native group, so the arrow keys move between the clocks; the row's own press selects too
            <Radio name="clock" value={index} checked={index === selectedIndex} onChange={() => onSelect(index)}
                slotProps={{ input: { 'aria-label': fullClockName(alternative) } }} size="small" />
        );
        case 'clock': return <ClockNameCell alternative={alternative} />;
        case 'makes': return formatNumberText(shownRateOf(alternative));
        case 'wakeUps': return wakeUpsCell(alternative);
        case 'signals': return signalsCell(alternative);
        case 'deciders': return alternative.deciders;
        case 'swings': return swingsText(alternative);
        case 'windowCycle': return windowCycleText(alternative);
        case 'windows': return alternative.inserterWindowCount;
        case 'perWindowCycle': return perWindowCycleText(alternative);
        case 'status': {
            const status = statusOf(alternative);
            return (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}>
                    <ClockStatusMark kind={status.kind} />
                    {status.text}
                </Box>
            );
        }
    }
}

/** The figures of a clock that have no column at this width, as label-value pairs across the row */
function DetailsPairs({ alternative, counts }: { alternative: ClockAlternativeView; counts: ClockAlternativeView['counts'] }) {
    const pairs: { label: string; help?: ReactNode; value: ReactNode }[] = [
        { label: swingsLabel(counts), help: swingsHelp(counts), value: swingsText(alternative) },
        { label: COMPARE_COPY.windowCycle, value: windowCycleText(alternative) },
        { label: COMPARE_COPY.windows, help: textHelp(COMPARE_COPY.windows, COMPARE_COPY.windowsHelp), value: alternative.inserterWindowCount },
        { label: OUTPUT_PER_WINDOW_CYCLE_HEADER, value: perWindowCycleText(alternative) },
    ];
    return (
        <Box component="dl" sx={{ m: 0, display: 'flex', flexWrap: 'wrap', columnGap: 4, rowGap: 1 }} data-details-row="">
            {pairs.map(({ label, help, value }) => (
                <Box key={label}>
                    <Box component="dt" sx={{ typography: 'caption', color: 'text.secondary', display: 'flex', alignItems: 'center', minHeight: 22 }}>
                        {label}
                        {help && <Box component="span" sx={{ display: 'inline-flex', my: -0.5, mx: -0.25 }}>{help}</Box>}
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'body2', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Box>
                </Box>
            ))}
        </Box>
    );
}

/**
 * Whether the table has every figure as a column: where it fits its box with every clock's name on one line, and no
 * sideways scroll. The table tries every column first; where it is wider than its box, the width it needed is kept and
 * the table has the default columns until the box is that wide. A change of the rows (`rowsKey`) tries again. Measured
 * before the page is painted, so the other form is never seen; the box is watched, so a resize or a late font measures again.
 */
function useAllColumns(rowsKey: string) {
    const box = useRef<HTMLDivElement>(null);
    const table = useRef<HTMLTableElement>(null);
    const [boxWidth, setBoxWidth] = useState(0);
    const [needed, setNeeded] = useState<{ rowsKey: string; width: number } | null>(null);
    const need = needed?.rowsKey === rowsKey ? needed.width : null;
    const allColumns = need === null || boxWidth >= need;
    useLayoutEffect(() => {
        const element = box.current;
        if (!element) return;
        const measure = () => {
            setBoxWidth(element.clientWidth);
            const width = table.current?.offsetWidth ?? 0;
            // only the form with every column says how wide it needs to be
            if (table.current?.hasAttribute('data-all-columns') && width > element.clientWidth + 1) setNeeded({ rowsKey, width });
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        if (table.current) observer.observe(table.current);
        return () => observer.disconnect();
    }, [rowsKey, allColumns]);
    return { allColumns, box, table };
}

/** Every head top-aligned, so that the first lines (and their (?)) are one line across the table */
const TABLE_SX = {
    '& .MuiTableCell-root:not(.MuiTableCell-paddingCheckbox):not(.MuiTableCell-paddingNone)': { px: 0.75 },
    '& thead th': { verticalAlign: 'top' },
    '& tbody td[data-column]:not([data-column="clock"])': { whiteSpace: 'nowrap' },
    '& tbody td[data-column="clock"]': { width: '100%' },
    '&[data-all-columns] [data-name-line]': { flexWrap: 'nowrap', whiteSpace: 'nowrap' },
} as const;

interface ClockAlternativesPanelProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** What the selection rule was given by the latest generation's config; null before one */
    pickRule: PickRule | null;
    /** Labels of alternatives still being generated */
    pending?: string[];
    /**
     * A run is adding clocks: the rows hold still, a clock that arrives goes to the bottom of its group, and the rows are
     * sorted by rank when it is false again. Not `pending`, which is empty between the stages of a run.
     */
    running?: boolean;
}

/**
 * Every clock of the generation, to compare: the Stable ones, then the others under their divider, ranked in the
 * engine's order, each with every figure. Where the table has the width for every figure as a column with every name on
 * one line (useAllColumns), it has them all; where it has not, the default columns, and a details row under each clock
 * opens the others. One table, two widths: the
 * user never chooses the columns. A row selects its clock.
 */
export function ClockAlternativesPanel({ alternatives, selectedIndex, onSelect, pickRule, pending = [], running = false }: ClockAlternativesPanelProps) {
    const tableId = useId();
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
    const held = useHeldOrder(alternatives, running);
    // the rows and what stands in them: a clock that arrives, or a fold of Makes, may need another width
    const { allColumns, box, table } = useAllColumns([...alternatives.map(alternative => alternative.id), ...pending].join(' '));

    if (alternatives.length === 0 && pending.length === 0) {
        return null;
    }

    const isStable = (alternative: ClockAlternativeView) => statusOf(alternative).kind === 'stable';
    // while a run adds clocks, the rows hold their order and show the ranks so far; after it, they are sorted by rank
    const { stable, unstable } = partitionClockRows(alternatives, { isStable, held });
    const anyHolds = alternatives.some(alternative => alternative.assessment.holds);
    const shared: Shared = { pickRule, copies: alternatives[0]?.copies ?? 1, counts: alternatives[0]?.counts, allColumns };
    // a Makes column that says the same on every row is one line above the table instead
    const fold = foldedMakes([...stable, ...unstable].map(({ alternative }) => alternative));
    const columns: ColumnId[] = ['rank', 'select', 'clock', ...(fold === null ? ['makes' as const] : []), 'wakeUps', 'signals', 'deciders',
        ...(allColumns ? DETAIL_COLUMNS : []), 'status'];
    const columnCount = columns.length + (allColumns ? 0 : 1);
    const toggle = (id: string) => setOpen(previous => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
    });

    // the index is the one drawn in this render, so a press cannot land on a row that has since moved
    const renderRow = (row: ClockRow<ClockAlternativeView>) => {
        const { alternative, index, rank } = row;
        const detailsOpen = !allColumns && open.has(alternative.id);
        const detailsId = `${tableId}-${alternative.id}`;
        const selected = index === selectedIndex;
        return (
            <Fragment key={alternative.id}>
                <TableRow hover selected={selected} onClick={() => onSelect(index)} sx={{ cursor: 'pointer', '& > td': detailsOpen ? { borderBottom: 'none' } : {} }}>
                    {/* the control first, so that it is in view on a phone, where the table scrolls sideways */}
                    {!allColumns && <TableCell padding="none" sx={{ width: 32, pl: 0.5 }}>
                        <IconButton size="small" sx={{ p: 0.25 }} aria-expanded={detailsOpen} aria-controls={detailsOpen ? detailsId : undefined}
                            aria-label={COMPARE_COPY.detailsOf(fullClockName(alternative))}
                            onClick={event => { event.stopPropagation(); toggle(alternative.id); }}>
                            <ExpandMoreIcon fontSize="small" sx={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                        </IconButton>
                    </TableCell>}
                    {columns.map(id => (
                        <TableCell key={id} data-column={id} align={NUMERIC.has(id) ? 'right' : undefined} padding={id === 'select' ? 'checkbox' : undefined}
                            data-rank={id === 'rank' ? '' : undefined}
                            sx={id === 'rank' ? { fontVariantNumeric: 'tabular-nums', fontWeight: rank === 1 ? 700 : undefined, pr: 0.5 } : undefined}>
                            {cellOf(id, row, selectedIndex, onSelect)}
                        </TableCell>
                    ))}
                </TableRow>
                {detailsOpen && (
                    <TableRow selected={selected} id={detailsId}>
                        <TableCell colSpan={3} />
                        {/* no wider than the screen, so that the pairs wrap on a phone and do not scroll away */}
                        <TableCell colSpan={columnCount - 3} sx={{ pt: 0, pb: 1.25, '& [data-details-row]': { maxWidth: 'calc(100vw - 210px)' } }}>
                            <DetailsPairs alternative={alternative} counts={shared.counts} />
                        </TableCell>
                    </TableRow>
                )}
            </Fragment>
        );
    };

    return (
        <Box data-compare-clocks="">
            {stable.length === 0 && alternatives.length > 0 && pending.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: '72ch' }}>
                    {anyHolds ? COMPARE_COPY.noneRecover : COMPARE_COPY.noneHold}
                </Typography>
            )}
            {fold !== null && <Typography variant="body2" sx={{ mb: 0.5 }} data-makes-fold="">{fold}</Typography>}
            <Box ref={box} sx={{ minWidth: 0 }} data-compare-fit=""><ScrollX label={CLOCK_TABLE_REGION}>
                <Table ref={table} id={tableId} size="small" aria-label={CLOCK_TABLE_NAME} sx={TABLE_SX} data-all-columns={allColumns ? '' : undefined}>
                    <TableHead>
                        <TableRow>
                            {!allColumns && <TableCell padding="none"><Box component="span" sx={VISUALLY_HIDDEN}>{COMPARE_COPY.details}</Box></TableCell>}
                            {columns.map(id => (
                                <TableCell key={id} align={NUMERIC.has(id) ? 'right' : undefined} padding={id === 'select' ? 'checkbox' : undefined}
                                    sx={id === 'rank' ? { pr: 0.5 } : undefined}>
                                    {headOf(id, shared)}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    {(stable.length > 0 || unstable.length > 0) && <TableBody>
                        {stable.map(renderRow)}
                        {stable.length > 0 && unstable.length > 0 && <TableRow><TableCell colSpan={columnCount} sx={{ color: 'text.secondary' }}>{RECOMMENDED_COPY.unstableDivider}</TableCell></TableRow>}
                        {unstable.map(renderRow)}
                    </TableBody>}
                    <TableBody>
                        {pending.map(label => (
                            <TableRow key={`pending-${label}`}>
                                {/* no rank until the engine has ranked the clock */}
                                {!allColumns && <TableCell padding="none" />}
                                <TableCell data-rank="" />
                                <TableCell padding="checkbox">
                                    <CircularProgress size={16} sx={{ ml: 1.5 }} aria-hidden />
                                </TableCell>
                                <TableCell colSpan={columns.length - 2} sx={{ color: 'text.secondary' }}>
                                    {COMPARE_COPY.computing(label)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollX></Box>
        </Box>
    );
}

/**
 * The compare table over the page, opened from the list of clocks: a close button, and Escape, close it, and the focus
 * goes back to what opened it. Choosing a row selects that clock and leaves it open. Full screen on a phone.
 */
export function CompareClocksDialog({ open, onClose, ...table }: ClockAlternativesPanelProps & { open: boolean; onClose: () => void }) {
    const phone = useMediaQuery(useTheme().breakpoints.down('sm'), { noSsr: true });
    return (
        <AppDialog open={open} onClose={onClose} closeButton maxWidth={false} fullScreen={phone} scroll="paper"
            title={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {COMPARE_COPY.heading}
                <HelpButton label={COMPARE_COPY.terms}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        Select a clock to compare its rate, recovery and wakeups. Belt compatibility is a separate condition.
                    </Typography>
                    <TermsList />
                </HelpButton>
            </Box>}>
            <Box data-compare-dialog="">
                <ClockAlternativesPanel {...table} />
            </Box>
        </AppDialog>
    );
}

/**
 * The wake-ups of one copy, rounded; under them, where they are the average of the start points, how many, and the
 * cold start's figure where it is far off it; a dash when they were not counted
 */
function wakeUpsCell(alternative: ClockAlternativeView): ReactNode {
    const perMinute = alternative.assessment.wake_ups_per_minute;
    if (perMinute === null) {
        return '—';
    }
    const average = wakeUpsAverageOf(alternative);
    return (
        <>
            {`${Math.round(perMinute)}`}
            {average !== null && (
                <Typography variant="caption" component="div" color="text.secondary" sx={{ whiteSpace: 'normal', minWidth: '12ch' }} data-wake-ups-average="">
                    {SUMMARY_COPY.wakeUpsAverage(average.starts)}
                    {average.coldStart !== null && <><br />{SUMMARY_COPY.wakeUpsColdStart(Math.round(average.coldStart))}</>}
                </Typography>
            )}
        </>
    );
}

/** The signals of one copy a minute, rounded; a dash when they were not counted */
function signalsCell(alternative: ClockAlternativeView): ReactNode {
    const perMinute = alternative.assessment.signals_per_minute;
    return perMinute === null || perMinute === undefined ? '—' : `${Math.round(perMinute)}`;
}

/** The (i) of a clock: its strategy's definition and practice, for Coordinated Sources what each source was given, then what each chip says */
export function StrategyHelp({ clock }: { clock: ClockAlternativeView }) {
    const family = familyCopyOf(clock);
    const sources = sourceLinesOf(clock);
    const direct = directRouterOf(clock);
    return (
        // a source's address is one long word: it breaks at the popover's edge and does not run past it
        <Box sx={{ overflowWrap: 'anywhere' }}>
            {family && <>
                <Typography variant="body2" sx={{ mb: 0.75 }}>{family.definition}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>{family.practice}</Typography>
            </>}
            {direct && <Typography variant="body2" sx={{ mb: 0.75 }} data-router="direct"><strong>{direct.name}.</strong> {direct.definition}</Typography>}
            {sources.map(line => (
                <Typography key={line} variant="body2" sx={{ mb: 0.75 }} data-source-line="">{line}</Typography>
            ))}
            {clockChipsOf(clock).map(chip => (
                <Typography key={chip.id} variant="body2" sx={{ mb: 0.75 }}><strong>{chip.label}.</strong> {chip.line}</Typography>
            ))}
        </Box>
    );
}
