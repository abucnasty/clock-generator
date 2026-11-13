import { Cancel, CheckCircle, Warning } from '@mui/icons-material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Chip,
    CircularProgress,
    Radio,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import { useBuildSection } from '../hooks/useBuildViewContext';
import type { BuildViewContext } from '../utils/buildViewContext';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import { CLOCK_TABLE_NAME, CLOCK_TABLE_REGION, clockHelpName, termsHelpName } from '../utils/a11yLabels';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { shownRateOf } from '../utils/shownRate';
import { SUMMARY_COPY, clockBadges, foldedMakes, pickNameMeaning, recoversOf, statusOf, wakeUpsAverageOf, type ClockStatus } from '../utils/clockSummary';
import { directRouterOf, familyCopyOf, fullClockName, clockChipsOf, sourceLinesOf, strategyNameOf } from '../utils/strategyNames';
import { BadgeChips, ClockChips } from './StrategyChips';
import { SIGNAL_DEFINITION, WAKEUP_DEFINITION, TERMS_FOCUS, type GlossaryId } from '../utils/glossary';
import { HelpButton } from './HelpButton';
import { CauseHeadline } from './CheckedLanesView';
import { descriptionShown } from '../utils/checkedLanes';
import { ScrollX } from './ScrollX';
import { Panel } from './Panel';
import { RecommendedChip } from './RecommendedChip';
import { HANDS_TEXT } from '../utils/targetCounts';
import { TermsList } from './TermsPopover';
import { OUTPUT_PER_WINDOW_CYCLE_HEADER, SIGNALS_HEADER, WAKE_UPS_HEADER, formatNumberText, makesHeader, rateHeader } from '../utils/numberText';
import { RECOMMENDED_COPY, disclosureRunLine, partitionClockRows, type ClockRow, type PickRule } from '../utils/recommendedClock';

// fractional (subtick) window cycles are shown to 3 decimals
/** The header of the column that counts a clock's decider combinators */
const DECIDERS_HEADER = 'Deciders';

const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

/** "8 clocks that are not Stable", "1 clock that is not Stable" */
const notStable = (count: number) => `${count} ${count === 1 ? 'clock that is' : 'clocks that are'} not Stable`;

/** Every string of the panel that is not the clocks' own or the pick's */
const COMPARE_COPY = {
    heading: 'Compare other clocks',
    terms: 'About comparing clocks',
    showAll: 'Show all columns',
    clock: 'Clock',
    status: 'Status',
    howMadeHeading: 'How it is made',
    worksHeading: 'Status',
    swingsHelp: 'Total output swings each output cycle of each output machine, shared equally across its output inserters. '
        + 'Per-inserter counts may be fractional. The clock repeats after a whole number of output cycles (the window cycle).',
    signalsHelp: SIGNAL_DEFINITION + ' Counted per minute for one copy of the build, in the same run as the wakeups. No clock is ranked by signals.',
    decidersHelp: 'How many decider combinators the clock\'s blueprint has to switch inserters and drills on and off, not counting the clock itself. Each one is wired to the inserters and drills its description names, so fewer deciders is less wiring to do by hand.',
    windowsHelp: 'How many enable windows the clock has in all: stretches of ticks during which it switches an inserter on.',
    wakeUpsHelp: WAKEUP_DEFINITION + ' Counted per minute, summed over the inserters of one copy of the build '
        + 'in a long run of this clock. Shown for clocks that were run long enough to count them. It is the count from '
        + 'one start point, but on a build with a loop of machines: a clock there settles into another steady state from '
        + 'another start point, with another count, so its figure is the average over 12 start points, and the table says so.',
    noneRecover: 'No clock qualifies as stable across its completed checks. Compare its modeled rate, recovery and sampled starts separately.',
    noneHold: 'None of the clocks tried holds the setpoint, so they are all listed.',
    computing: (label: string) => `${label}: computing…`,
    showUnstable: (hidden: number) => `Show ${notStable(hidden)}`,
    hideUnstable: (count: number) => `Hide ${notStable(count)}`,
};

/** The icon beside the words of the compact table's Status: never the colour alone. Error has the red of a failed check */
const YES_ICON = <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} />;
const CAUTION_ICON = <Warning fontSize="small" aria-hidden sx={{ color: 'warning.main' }} />;
const NO_ICON = <Cancel fontSize="small" aria-hidden sx={{ color: 'error.light' }} />;
const STATUS_ICON: Record<ClockStatus['kind'], ReactNode> = {
    stable: YES_ICON, 'start-dependent': CAUTION_ICON, 'no-recovery': CAUTION_ICON, underproduces: NO_ICON, overproduces: NO_ICON, oscillates: NO_ICON, error: NO_ICON,
};
/** The colour of the full table's Status chip: a clock that underproduces, overproduces or oscillates, and Error, in red as "Check failed" */
const STATUS_COLOR: Record<ClockStatus['kind'], 'success' | 'warning' | 'error'> = {
    stable: 'success', 'start-dependent': 'warning', 'no-recovery': 'warning', underproduces: 'error', overproduces: 'error', oscillates: 'error', error: 'error',
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

/** A header with its (i), which opens the Terms with the column's terms first */
function TermsHeader({ label, focus }: { label: string; focus: readonly GlossaryId[] }) {
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, whiteSpace: 'nowrap' }}>
            {label}
            <HelpButton label={termsHelpName(label)}>
                <TermsList focus={focus} />
            </HelpButton>
        </Box>
    );
}

/** The header Status, of both tables, with its help: each status the column can show, once */
function StatusHeader() {
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, whiteSpace: 'nowrap' }}>
            {COMPARE_COPY.status}
            <HelpButton label={`About ${COMPARE_COPY.status}`}>
                {SUMMARY_COPY.statusHelp.map(([word, meaning]) => (
                    <Typography key={word} variant="body2" sx={{ mb: 0.75 }}><Box component="strong">{word}:</Box> {meaning}</Typography>
                ))}
            </HelpButton>
        </Box>
    );
}

/** A header of the full table with the help that was its hover text */
function HelpHeader({ label, help }: { label: string; help: string }) {
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, whiteSpace: 'nowrap' }}>
            {label}
            <HelpButton label={`About ${label}`}>
                <Typography variant="body2">{help}</Typography>
            </HelpButton>
        </Box>
    );
}

interface ClockAlternativesPanelProps {
    comparison: BuildViewContext['comparison'];
    onComparisonChange(comparison: BuildViewContext['comparison']): void;
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** The clock the selection rule picks, which gets the "Recommended" chip; null while there are none */
    recommendedIndex: number | null;
    /** What the selection rule was given by the latest generation's config; null before one */
    pickRule: PickRule | null;
    /** While true more clocks may still arrive, so the recommendation is the best so far */
    isGenerating: boolean;
    /** Labels of alternatives still being generated */
    pending?: string[];
    /** Shown below the table: whether a deeper search is on offer */
    notice?: ReactNode;
    /** Keeps the panel, and so the notice, on screen while a generation has no clocks yet, so its focus is not lost */
    holdNotice?: boolean;
}

/**
 * Half-width, the full table (Show all columns; the compact one fits 720 on its own): the Clock column keeps 200px, so
 * that its name wraps to a few lines and not one word to a line, and every other cell stays on one line. The table then
 * scrolls sideways in its box (ScrollX). A header may wrap but is never narrower than 96px.
 */
const FULL_CLOCK_TABLE_SX = {
    '& th': { minWidth: 96 },
    '& tbody td:nth-of-type(2)': { minWidth: 200 },
    '& tbody td:not(:nth-of-type(2))': { whiteSpace: 'nowrap' },
} as const;

/**
 * The other clocks of the generation, to compare with the one at the top: by default a compact table (the plain name,
 * what it makes, its wake-ups and whether it works), with every column one press away. A row selects its clock.
 */
export function ClockAlternativesPanel({
    comparison,
    onComparisonChange,
    alternatives,
    selectedIndex,
    onSelect,
    recommendedIndex,
    pickRule,
    isGenerating,
    pending = [],
    notice,
    holdNotice = false,
}: ClockAlternativesPanelProps) {
    const { showUnstable, allColumns } = comparison;
    const setShowUnstable = (showUnstable: boolean) => onComparisonChange({ ...comparison, showUnstable });
    const setAllColumns = (next: boolean | ((shown: boolean) => boolean)) => onComparisonChange({ ...comparison, allColumns: typeof next === 'function' ? next(allColumns) : next });
    const [helpOpen, setHelpOpen] = useBuildSection('comparison-help');
    // the unstable rows that were on screen when the others were shown
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const tableId = useId();

    if (alternatives.length === 0 && pending.length === 0 && !holdNotice) {
        return null;
    }

    const { stable, unstable, unstableCount, hiddenCount, anyStable } = partitionClockRows(
        alternatives,
        // the recommended row leads once the run is over: while it runs the pick can change, and rows must not jump
        // under the pointer
        { selectedIndex, recommendedIndex, showUnstable, pinnedIds, recommendedFirst: !isGenerating },
    );
    const anyHolds = alternatives.some(alternative => alternative.assessment.holds);
    const copies = alternatives[0]?.copies ?? 1; // of the generation, so a stale table keeps its own number
    // a Makes column that says the same on every row is one line above the table instead
    const fold = allColumns ? null : foldedMakes([...stable, ...unstable].map(({ alternative }) => alternative));
    const columnCount = allColumns ? 11 : fold === null ? 7 : 6;

    // the index is the one drawn in this render, so a click cannot land on a row that has since moved
    const renderRow = ({ alternative, index }: ClockRow<ClockAlternativeView>) => {
        const status = statusOf(alternative);
        return (
            <TableRow
                key={alternative.id}
                hover
                selected={index === selectedIndex}
                onClick={() => onSelect(index)}
                sx={{ cursor: 'pointer' }}
            >
                <TableCell padding="checkbox">
                    <Radio
                        // one native group, so the arrow keys move between the clocks; the row's own click selects too
                        name="clock"
                        value={index}
                        checked={index === selectedIndex}
                        onChange={() => onSelect(index)}
                        slotProps={{ input: { 'aria-label': fullClockName(alternative) } }}
                        size="small"
                    />
                </TableCell>
                <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}>
                        <Box component="span" sx={{ fontWeight: 600 }}>{strategyNameOf(alternative)}</Box>
                        <ClockChips clock={alternative} />
                        {/* the status is the Status column's word: only what it has fewest of stands beside the name */}
                        <BadgeChips badges={clockBadges(alternatives, index).filter(badge => badge.kind !== 'status')} meanings={badgeMeanings(alternatives, index)} />
                        {index === recommendedIndex && <RecommendedChip isGenerating={isGenerating} />}
                    </Box>
                    {/* what is said beside the status: the rate, the reason code's words, or why the loss trials gave no answer */}
                    {status.detail && <Typography variant="body2" color="text.secondary" data-status-detail="">{status.detail}</Typography>}
                    {/* the line that explains the clock's name stands on the card only */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', typography: 'body2' }}>
                        <HelpButton label={clockHelpName(fullClockName(alternative))}>
                            <StrategyHelp clock={alternative} />
                            <Typography variant="subtitle2" component="p" sx={{ mb: 0.5 }}>{COMPARE_COPY.howMadeHeading}</Typography>
                            {sentencesOf(descriptionShown(alternative)).map(sentence => (
                                <Typography key={sentence} variant="body2" sx={{ mb: 0.75 }}>{sentence}</Typography>
                            ))}
                            <Typography variant="subtitle2" component="p" sx={{ mt: 1.5, mb: 0.5 }}>{COMPARE_COPY.worksHeading}</Typography>
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                                {STATUS_ICON[status.kind]}{status.text}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">{statusDetail(alternative)}</Typography>
                            {/* a clock not stable on a lane its copies share: its headline; the Diagnostics tab of the selected clock shows the parts */}
                            {alternative.checkedLanes?.cause && <Box sx={{ mt: 1.5 }}><CauseHeadline cause={alternative.checkedLanes.cause} /></Box>}
                        </HelpButton>
                    </Box>
                </TableCell>
                {allColumns ? (
                    <>
                        <TableCell align="right">
                            {alternative.terminalSwingCount} per {formatTicks(alternative.cycleTicks)} ticks
                        </TableCell>
                        <TableCell align="right">{formatTicks(alternative.simulationDurationTicks)} ticks</TableCell>
                        <TableCell align="right">{alternative.inserterWindowCount}</TableCell>
                        <TableCell align="right">{alternative.deciders}</TableCell>
                        <TableCell align="right">{wakeUpsCell(alternative)}</TableCell>
                        <TableCell align="right">{signalsCell(alternative)}</TableCell>
                        <TableCell align="right">{shownRateOf(alternative).toFixed(2)}</TableCell>
                        <TableCell align="right">
                            {alternative.asBuilt
                                ? `${formatNumberText(alternative.asBuilt.actual_output_items)} / ${alternative.expectedOutputItems}`
                                : '—'}
                        </TableCell>
                        <TableCell>
                            <Tooltip title={statusDetail(alternative)} arrow describeChild>
                                <Chip
                                    tabIndex={0}
                                    size="small"
                                    label={status.text}
                                    color={STATUS_COLOR[status.kind]}
                                    variant="outlined"
                                    // on the card colour of its own: the selected row's orange tint, hovered, takes green and red
                                    // words under 4.5:1
                                    sx={{ bgcolor: 'background.paper' }}
                                />
                            </Tooltip>
                        </TableCell>
                    </>
                ) : (
                    <>
                        {fold === null && (
                            <TableCell align="right">{formatNumberText(shownRateOf(alternative))}</TableCell>
                        )}
                        <TableCell align="right">{wakeUpsCell(alternative)}</TableCell>
                        <TableCell align="right">{signalsCell(alternative)}</TableCell>
                        <TableCell align="right">{alternative.deciders}</TableCell>
                        <TableCell>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                {STATUS_ICON[status.kind]}
                                {status.text}
                            </Box>
                        </TableCell>
                    </>
                )}
            </TableRow>
        );
    };

    return (
        <Panel
            title={COMPARE_COPY.heading}
            help={{ label: COMPARE_COPY.terms, content: <>
                <Typography variant="body2" sx={{ mb: 1 }}>
                    Select a clock to compare its rate, recovery and wakeups. Belt compatibility is a separate condition.
                </Typography>
                <TermsList />
            </> }}
            sx={{ mb: 0, '& > :last-child': { p: 1.5 } }}
            data-compare-clocks="" data-build-anchor="comparison"
        >
            {!anyStable && alternatives.length > 0 && pending.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: '72ch' }}>
                    {anyHolds ? COMPARE_COPY.noneRecover : COMPARE_COPY.noneHold}
                </Typography>
            )}
            <Accordion
                expanded={helpOpen}
                onChange={(_, open) => setHelpOpen(open)}
                disableGutters
                elevation={0}
                slotProps={{ heading: { component: 'h3' }, region: { 'aria-labelledby': 'how-clocks-are-chosen-summary' } }}
                sx={{ mb: 1, maxWidth: '72ch' }}
            >
                <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    id="how-clocks-are-chosen-summary"
                    aria-controls="how-clocks-are-chosen-details"
                    // the chevron next to its words, not at the far end of the line
                    sx={{ px: 1.5, justifyContent: 'flex-start', '& .MuiAccordionSummary-content': { flexGrow: 0, mr: 1 } }}
                >
                    <Typography variant="body2" component="span">{RECOMMENDED_COPY.disclosureTitle}</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.5, pt: 0 }}>
                    {RECOMMENDED_COPY.disclosure.map(paragraph => (
                        <Typography key={paragraph} variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {paragraph}
                        </Typography>
                    ))}
                    <Typography variant="body2">{disclosureRunLine(pickRule)}</Typography>
                </AccordionDetails>
            </Accordion>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5, mb: 0.5 }}>
                {fold !== null && <Typography variant="body2" data-makes-fold="">{fold}</Typography>}
                <Button
                    size="small"
                    aria-expanded={allColumns}
                    aria-controls={tableId}
                    onClick={() => setAllColumns(shown => !shown)}
                    // the chevron turns, as Why? does, so the state shows on screen too
                    endIcon={<ExpandMoreIcon sx={{ transform: allColumns ? 'rotate(180deg)' : 'none' }} />}
                    sx={{ ml: 'auto' }}
                >
                    {/* the same name both ways: the state is in aria-expanded and the chevron */}
                    {COMPARE_COPY.showAll}
                </Button>
            </Box>
            <ScrollX label={CLOCK_TABLE_REGION}>
                <Table id={tableId} size="small" aria-label={CLOCK_TABLE_NAME} sx={allColumns ? FULL_CLOCK_TABLE_SX : undefined}>
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox">
                                <Box component="span" sx={VISUALLY_HIDDEN}>Select</Box>
                            </TableCell>
                            <TableCell>{COMPARE_COPY.clock}</TableCell>
                            {allColumns ? (
                                <>
                                    <TableCell align="right">{alternatives[0]?.counts === 'destroyed'
                                        ? <HelpHeader label={HANDS_TEXT.column} help={HANDS_TEXT.columnHelp} />
                                        : <HelpHeader label="Output swings" help={COMPARE_COPY.swingsHelp} />}</TableCell>
                                    <TableCell align="right">Window cycle time</TableCell>
                                    <TableCell align="right"><HelpHeader label="Enable windows" help={COMPARE_COPY.windowsHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={DECIDERS_HEADER} help={COMPARE_COPY.decidersHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={WAKE_UPS_HEADER} help={COMPARE_COPY.wakeUpsHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={SIGNALS_HEADER} help={COMPARE_COPY.signalsHelp} /></TableCell>
                                    <TableCell align="right">{rateHeader(copies)}</TableCell>
                                    <TableCell align="right">{OUTPUT_PER_WINDOW_CYCLE_HEADER}</TableCell>
                                    <TableCell><StatusHeader /></TableCell>
                                </>
                            ) : (
                                <>
                                    {fold === null && <TableCell align="right">{makesHeader(copies, alternatives[0]?.counts)}</TableCell>}
                                    <TableCell align="right"><TermsHeader label={WAKE_UPS_HEADER} focus={TERMS_FOCUS.wakeUps} /></TableCell>
                                    <TableCell align="right"><TermsHeader label={SIGNALS_HEADER} focus={TERMS_FOCUS.signals} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={DECIDERS_HEADER} help={COMPARE_COPY.decidersHelp} /></TableCell>
                                    <TableCell><StatusHeader /></TableCell>
                                </>
                            )}
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
                                <TableCell padding="checkbox">
                                    <CircularProgress size={16} sx={{ ml: 1.5 }} aria-hidden />
                                </TableCell>
                                <TableCell colSpan={columnCount - 1} sx={{ color: 'text.secondary' }}>
                                    {COMPARE_COPY.computing(label)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollX>
            {anyStable && (showUnstable ? unstableCount > 0 : hiddenCount > 0) && (
                <Box sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        onClick={() => {
                            // the unstable rows already on screen stay first in their group once the others are shown
                            if (!showUnstable) {
                                setPinnedIds(unstable.map(({ alternative }) => alternative.id));
                            }
                            setShowUnstable(!showUnstable);
                        }}
                    >
                        {showUnstable ? COMPARE_COPY.hideUnstable(unstableCount) : COMPARE_COPY.showUnstable(hiddenCount)}
                    </Button>
                </Box>
            )}
            {notice}
        </Panel>
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

/** What a chip means, by its text, for the chips whose words need a line: Fewest deciders */
function badgeMeanings(alternatives: ClockAlternativeView[], index: number): Record<string, string> {
    const meaning = pickNameMeaning(alternatives, index);
    return meaning ? { [SUMMARY_COPY.fewestDeciders]: meaning } : {};
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
