import { Cancel, CheckCircle, Warning } from '@mui/icons-material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
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
import type { ClockVerdict } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import { CLOCK_TABLE_NAME, CLOCK_TABLE_REGION, clockHelpName, termsHelpName } from '../utils/a11yLabels';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { BELT_COPY } from '../utils/beltQuestion';
import { SUMMARY_COPY, beltCellText, clockTechnicalName, foldedMakes, isStartDependent, plainClockName, recoversOf, worksOf } from '../utils/clockSummary';
import { PROVISIONAL_WAKE_UP_DEFINITION, TERMS_FOCUS, type GlossaryId } from '../utils/glossary';
import { HelpButton } from './HelpButton';
import { ScrollX } from './ScrollX';
import { Panel } from './Panel';
import { RecommendedChip } from './RecommendedChip';
import { TermsList } from './TermsPopover';
import { OUTPUT_PER_PERIOD_HEADER, WAKE_UPS_HEADER, formatNumberText, makesHeader, rateHeader } from '../utils/numberText';
import { RECOMMENDED_COPY, disclosureRunLine, groupClockRowsByBelt, partitionClockRows, type BeltClockGroups, type ClockRow, type PickRule } from '../utils/recommendedClock';

// fractional (subtick) periods are shown to 3 decimals
/** The header of the column that counts a clock's decider combinators */
const DECIDERS_HEADER = 'Deciders';

const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

/** Every string of the panel that is not the clocks' own or the pick's */
const COMPARE_COPY = {
    heading: 'Compare other clocks',
    terms: 'About comparing clocks',
    showAll: 'Show all columns',
    clock: 'Clock',
    works: 'Works?',
    status: 'Status',
    howMadeHeading: 'How it is made',
    worksHeading: 'Does it work?',
    beltHelp: 'The belt the clock is made for. Moving: each wake window of an inserter that picks up from a belt stays '
        + 'open the ticks shown longer (belt slack), so a pickup that comes late on a moving belt can finish; a rule of '
        + 'thumb for late pickups. Pickup geometry models which moving stacks are within reach; straight belt is the default. Backed up: items '
        + 'stop between pickups and the belt refills the gaps; on a moving belt an inserter can be switched off holding a partial hand. A '
        + 'subtick clock is always made for a backed-up belt, and is not ranked behind other clocks for it. Blank '
        + 'when no clocked inserter picks up from a belt.',
    swingsHelp: 'Total output swings per crafting cycle of each output machine, shared equally across its output inserters. '
        + 'Per-inserter counts may be fractional. The clock repeats after a whole number of crafting cycles (the clock period).',
    decidersHelp: 'How many decider combinators the clock\'s blueprint has to switch inserters and drills on and off, not counting the clock itself. Each one is wired to the inserters and drills its description names, so fewer deciders is less wiring to do by hand.',
    windowsHelp: 'How many wake windows the clock has in all: stretches of ticks during which it switches an inserter on.',
    wakeUpsHelp: PROVISIONAL_WAKE_UP_DEFINITION + ' Counted per minute, summed over the inserters of one copy of the build '
        + 'in a long run of this clock. Shown for clocks that were run long enough to count them. It is the count from '
        + 'one start point; a clock can settle into another steady state from another start point, with another count.',
    noneRecover: 'No clock qualifies as stable across its completed checks. Compare its modeled rate, recovery and sampled starts separately.',
    noneHold: 'None of the clocks tried holds the target rate, so they are all listed.',
    deadlock: 'The tests that starve and jam the build do not see this, so on this build they do not decide which clock '
        + 'is selected for you: the clocks that hold the target rate are ranked by their wake-ups.',
    computing: (label: string) => `${label}: computing…`,
    showUnstable: (hidden: number) => `Show ${hidden} unstable clock${hidden === 1 ? '' : 's'} that ${hidden === 1 ? 'was' : 'were'} tried`,
    hideUnstable: (count: number) => `Hide ${count} unstable clock${count === 1 ? '' : 's'}`,
};

/** The full table's Status: the glossary's words for the verdict */
const VERDICT_LABEL: Record<ClockVerdict, string> = { stable: 'Recovers', 'no recovery': 'Does not recover', unstable: 'Unstable' };
const VERDICT_COLOR: Record<ClockVerdict, 'success' | 'warning' | 'error'> = { stable: 'success', 'no recovery': 'warning', unstable: 'error' };

/** The icon beside the words of Works?: never the colour alone */
const WORKS_ICON = {
    yes: <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} />,
    caution: <Warning fontSize="small" aria-hidden sx={{ color: 'warning.main' }} />,
    no: <Cancel fontSize="small" aria-hidden sx={{ color: 'error.light' }} />,
} as const;

function statusDetail(alternative: ClockAlternativeView): string {
    const starts = alternative.assessment.start_dependence;
    const startup = starts ? `${starts.starts.filter(start => start.reaches_target).length} of ${starts.starts.length} sampled starts reached the target. ` : '';
    const recovery = recoversOf(alternative).detail;
    const check = alternative.asBuilt;
    if (!check) {
        return `${startup}Clock-phase check unavailable. ${recovery}`;
    }
    const phases = `${startup}${recovery} Checked from ${check.start_phases_checked} clock phase${check.start_phases_checked === 1 ? '' : 's'}`;
    if (check.repeat_periods === undefined || check.repeat_output_items === undefined) {
        return phases;
    }
    return `${phases}. The build repeats every ${check.repeat_periods} clock periods, moving ${check.repeat_output_items} of `
        + `${alternative.expectedOutputItems * check.repeat_periods} items over them`;
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
    const stableBelts: BeltClockGroups<ClockAlternativeView> = groupClockRowsByBelt(stable);
    const otherBelts: BeltClockGroups<ClockAlternativeView> = groupClockRowsByBelt(unstable);
    const anyHolds = alternatives.some(alternative => alternative.assessment.holds);
    // of the build, so every clock has the same
    const deadlockRisk = alternatives.find(alternative => alternative.deadlockRisk !== null)?.deadlockRisk ?? null;
    const copies = alternatives[0]?.copies ?? 1; // of the generation, so a stale table keeps its own number
    // a Makes column that says the same on every row is one line above the table instead
    const fold = allColumns ? null : foldedMakes([...stable, ...unstable].map(({ alternative }) => alternative));
    const columnCount = allColumns ? 11 : fold === null ? 6 : 5;

    // the index is the one drawn in this render, so a click cannot land on a row that has since moved
    const renderRow = ({ alternative, index }: ClockRow<ClockAlternativeView>) => {
        const works = worksOf(alternative);
        const recovery = recoversOf(alternative);
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
                        slotProps={{ input: { 'aria-label': `${plainClockName(alternatives, index)}: ${alternative.label}` } }}
                        size="small"
                    />
                </TableCell>
                <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}>
                        <Box component="span" sx={{ fontWeight: 600 }}>{plainClockName(alternatives, index)}</Box>
                        {index === recommendedIndex && <RecommendedChip isGenerating={isGenerating} />}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', typography: 'body2' }}>
                        <span data-engine-name="">{clockTechnicalName(alternative)}</span>
                        <HelpButton label={clockHelpName(alternative.label)}>
                            <Typography variant="subtitle2" component="p" sx={{ mb: 0.5 }}>{COMPARE_COPY.howMadeHeading}</Typography>
                            {sentencesOf(alternative.description).map(sentence => (
                                <Typography key={sentence} variant="body2" sx={{ mb: 0.75 }}>{sentence}</Typography>
                            ))}
                            <Typography variant="subtitle2" component="p" sx={{ mt: 1.5, mb: 0.5 }}>{COMPARE_COPY.worksHeading}</Typography>
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                                {WORKS_ICON[works.kind]}{works.text}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">{statusDetail(alternative)}</Typography>
                        </HelpButton>
                    </Box>
                </TableCell>
                {allColumns ? (
                    <>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {beltCellText(alternative.beltLabel)}
                            {/* made without belt slack in a run for moving belts: ranked after those made for them */}
                            {!alternative.ranking.matches_belt_choice && (
                                <Typography variant="caption" component="div" color="text.secondary" sx={{ whiteSpace: 'normal', maxWidth: '16ch' }}>
                                    {BELT_COPY.onlyIfBackedUp}
                                </Typography>
                            )}
                        </TableCell>
                        <TableCell align="right">
                            {alternative.terminalSwingCount} per {formatTicks(alternative.cycleTicks)} ticks
                        </TableCell>
                        <TableCell align="right">{formatTicks(alternative.simulationDurationTicks)} ticks</TableCell>
                        <TableCell align="right">{alternative.inserterWindowCount}</TableCell>
                        <TableCell align="right">{alternative.deciders}</TableCell>
                        <TableCell align="right">{wakeUpsCell(alternative)}</TableCell>
                        <TableCell align="right">{alternative.assessment.items_per_second.toFixed(2)}</TableCell>
                        <TableCell align="right">
                            {alternative.asBuilt
                                ? `${alternative.asBuilt.actual_output_items} / ${alternative.expectedOutputItems}`
                                : '—'}
                        </TableCell>
                        <TableCell>
                            <Tooltip title={statusDetail(alternative)} arrow describeChild>
                                <Chip
                                    tabIndex={0}
                                    size="small"
                                    label={isStartDependent(alternative) ? 'Start-dependent'
                                        : alternative.verdict === 'no recovery' && recovery.kind !== 'no' ? SUMMARY_COPY.recoveryUnavailable
                                            : alternative.verdict === 'stable' ? `Recovery: ${recovery.value}` : VERDICT_LABEL[alternative.verdict]}
                                    color={isStartDependent(alternative) || (alternative.verdict === 'stable' && recovery.kind === 'not-tested') ? 'warning' : VERDICT_COLOR[alternative.verdict]}
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
                            <TableCell align="right">{formatNumberText(alternative.assessment.items_per_second)}</TableCell>
                        )}
                        <TableCell align="right">{wakeUpsCell(alternative)}</TableCell>
                        <TableCell align="right">{alternative.deciders}</TableCell>
                        <TableCell>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                {WORKS_ICON[works.kind]}
                                {works.text}
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
                    Select a clock to compare its rate, recovery and wake-ups. Belt compatibility is a separate condition.
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
            {deadlockRisk !== null && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                    {deadlockRisk} {COMPARE_COPY.deadlock}
                </Alert>
            )}
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
                                    <TableCell><HelpHeader label="Belt" help={COMPARE_COPY.beltHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label="Output swings" help={COMPARE_COPY.swingsHelp} /></TableCell>
                                    <TableCell align="right">Clock period</TableCell>
                                    <TableCell align="right"><HelpHeader label="Wake windows" help={COMPARE_COPY.windowsHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={DECIDERS_HEADER} help={COMPARE_COPY.decidersHelp} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={WAKE_UPS_HEADER} help={COMPARE_COPY.wakeUpsHelp} /></TableCell>
                                    <TableCell align="right">{rateHeader(copies)}</TableCell>
                                    <TableCell align="right">{OUTPUT_PER_PERIOD_HEADER}</TableCell>
                                    <TableCell><TermsHeader label={COMPARE_COPY.status} focus={TERMS_FOCUS.works} /></TableCell>
                                </>
                            ) : (
                                <>
                                    {fold === null && <TableCell align="right">{makesHeader(copies)}</TableCell>}
                                    <TableCell align="right"><TermsHeader label={WAKE_UPS_HEADER} focus={TERMS_FOCUS.wakeUps} /></TableCell>
                                    <TableCell align="right"><HelpHeader label={DECIDERS_HEADER} help={COMPARE_COPY.decidersHelp} /></TableCell>
                                    <TableCell><TermsHeader label={COMPARE_COPY.works} focus={TERMS_FOCUS.works} /></TableCell>
                                </>
                            )}
                        </TableRow>
                    </TableHead>
                    {(['matches', 'requiresChange'] as const).map(group => {
                        const stableRows = stableBelts[group];
                        const otherRows = otherBelts[group];
                        if (!stableRows.length && !otherRows.length) return null;
                        const headingId = `${tableId}-belt-${group}`;
                        return <TableBody key={group} aria-labelledby={headingId}>
                            <TableRow><TableCell id={headingId} component="th" role="rowheader" scope="rowgroup" colSpan={columnCount}
                                sx={{ fontWeight: 700, bgcolor: 'background.default' }}>
                                {group === 'matches' ? 'Matches your belt setting' : 'Requires a different belt setting'}
                            </TableCell></TableRow>
                            {stableRows.map(renderRow)}
                            {stableRows.length > 0 && otherRows.length > 0 && <TableRow><TableCell colSpan={columnCount} sx={{ color: 'text.secondary' }}>{RECOMMENDED_COPY.unstableDivider}</TableCell></TableRow>}
                            {otherRows.map(renderRow)}
                        </TableBody>;
                    })}
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

/** The wake-ups of one copy, rounded; a dash when they were not counted */
function wakeUpsCell(alternative: ClockAlternativeView): string {
    const perMinute = alternative.assessment.wake_ups_per_minute;
    return perMinute !== null ? `${Math.round(perMinute)}` : '—';
}
