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
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import { useRef, useState, type ReactNode } from 'react';
import type { ClockVerdict } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import { CLOCK_TABLE_NAME, clockHelpName } from '../utils/a11yLabels';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { lossesOf } from '../utils/rateWarning';
import { BELT_COPY } from '../utils/beltQuestion';
import { HelpButton } from './HelpButton';
import { Panel } from './Panel';
import { RecommendedChip } from './RecommendedChip';
import { OUTPUT_PER_PERIOD_HEADER, WAKE_UPS_HEADER, rateHeader } from '../utils/numberText';
import {
    RECOMMENDED_COPY,
    disclosureRunLine,
    partitionClockRows,
    recommendationReason,
    type PickRule,
} from '../utils/recommendedClock';

// fractional (subtick) periods are shown to 3 decimals
const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

const VERDICT_LABEL: Record<ClockVerdict, string> = { stable: 'Stable', 'no recovery': 'No recovery', unstable: 'Unstable' };
const VERDICT_COLOR: Record<ClockVerdict, 'success' | 'warning' | 'error'> = { stable: 'success', 'no recovery': 'warning', unstable: 'error' };


function statusDetail(alternative: ClockAlternativeView): string {
    const check = alternative.asBuilt;
    if (!check) {
        return 'Not checked';
    }
    if (alternative.verdict === 'no recovery') {
        const losses = lossesOf(alternative);
        return 'Holds the target rate for as long as nothing runs out and nothing backs up. '
            + (losses ? `Does not get back to it after ${losses} for a while.` : 'It was off its rate in the run that starves and jams the build.');
    }
    const phases = `Checked from ${check.start_phases_checked} start point(s)`;
    if (check.repeat_periods === undefined || check.repeat_output_items === undefined) {
        return phases;
    }
    return `${phases}. The build repeats every ${check.repeat_periods} clock periods, moving ${check.repeat_output_items} of `
        + `${alternative.expectedOutputItems * check.repeat_periods} items over them`;
}

interface ClockAlternativesPanelProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** The clock the selection rule picks, which gets the "Recommended" chip; null while there are none */
    recommendedIndex: number | null;
    /** Selects the recommended clock and lets the selection follow it again */
    onSelectRecommended: () => void;
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

export function ClockAlternativesPanel({
    alternatives,
    selectedIndex,
    onSelect,
    recommendedIndex,
    onSelectRecommended,
    pickRule,
    isGenerating,
    pending = [],
    notice,
    holdNotice = false,
}: ClockAlternativesPanelProps) {
    const [showUnstable, setShowUnstable] = useState(false);
    // the unstable rows that were on screen when the others were shown
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    // where "Back to recommended" leaves the keyboard focus, as the link itself goes away
    const recommendedRadioRef = useRef<HTMLInputElement>(null);

    if (alternatives.length === 0 && pending.length === 0 && !holdNotice) {
        return null;
    }

    const { stable, unstable, unstableCount, hiddenCount, anyStable } = partitionClockRows(
        alternatives,
        { selectedIndex, recommendedIndex, showUnstable, pinnedIds },
    );
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const anyHolds = alternatives.some(alternative => alternative.verdict !== 'unstable');
    // of the build, so every clock has the same
    const deadlockRisk = alternatives.find(alternative => alternative.deadlockRisk !== null)?.deadlockRisk ?? null;
    const copies = alternatives[0]?.copies ?? 1; // of the generation, so a stale table keeps its own number

    // the index is the one drawn in this render, so a click cannot land on a row that has since moved
    const renderRow = ({ alternative, index }: { alternative: ClockAlternativeView; index: number }) => (
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
                    slotProps={{ input: { 'aria-label': alternative.label } }}
                    size="small"
                    inputRef={index === recommendedIndex ? recommendedRadioRef : undefined}
                />
            </TableCell>
            <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                    {alternative.label}
                    <HelpButton label={clockHelpName(alternative.label)}>
                        <Typography variant="body2">{alternative.description}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            Status: {statusDetail(alternative)}
                        </Typography>
                    </HelpButton>
                    {index === recommendedIndex && (
                        <RecommendedChip isGenerating={isGenerating} />
                    )}
                </Box>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {alternative.beltLabel}
                {/* made without belt slack in a run for moving belts: ranked after those made for them */}
                {!alternative.ranking.matches_belt_choice && (
                    <Typography variant="caption" component="div" color="text.secondary" sx={{ whiteSpace: 'normal', maxWidth: '16ch' }}>
                        {BELT_COPY.onlyIfStanding}
                    </Typography>
                )}
            </TableCell>
            <TableCell align="right">
                {alternative.terminalSwingCount} per {formatTicks(alternative.cycleTicks)} ticks
            </TableCell>
            <TableCell align="right">{formatTicks(alternative.simulationDurationTicks)} ticks</TableCell>
            <TableCell align="right">{alternative.inserterWindowCount}</TableCell>
            <TableCell align="right">
                {alternative.assessment.wake_ups_per_minute !== null
                    ? Math.round(alternative.assessment.wake_ups_per_minute)
                    : '—'}
            </TableCell>
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
                        label={VERDICT_LABEL[alternative.verdict]}
                        color={VERDICT_COLOR[alternative.verdict]}
                        variant="outlined"
                        // on the card colour of its own: the selected row's orange tint, hovered, takes green and red
                        // words under 4.5:1
                        sx={{ bgcolor: 'background.paper' }}
                    />
                </Tooltip>
            </TableCell>
        </TableRow>
    );

    return (
        <Panel title="Clocks" sx={{ mt: 2, mb: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: '72ch' }}>
                {RECOMMENDED_COPY.intro}
            </Typography>
            {recommended && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, mb: 1, maxWidth: '72ch' }}>
                    <Typography variant="body2">
                        <strong>
                            {isGenerating ? RECOMMENDED_COPY.leadWhileGenerating(recommended.label) : RECOMMENDED_COPY.lead(recommended.label)}
                        </strong>{' '}
                        {recommendationReason(alternatives, recommendedIndex, pickRule, !isGenerating)}
                    </Typography>
                    {selectedIndex !== recommendedIndex && (
                        <Button
                            size="small"
                            onClick={() => {
                                onSelectRecommended();
                                recommendedRadioRef.current?.focus();
                            }}
                        >
                            {isGenerating ? RECOMMENDED_COPY.backWhileGenerating : RECOMMENDED_COPY.backToRecommended}
                        </Button>
                    )}
                </Box>
            )}
            {!anyStable && alternatives.length > 0 && pending.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: '72ch' }}>
                    {anyHolds ? (
                        <>None of the clocks tried recovers when the build is starved or jammed, which can be a limit of
                            the build and not of its clocks. They are listed for what they are: a clock that holds the
                            target rate has to be restarted after the build is starved or jammed.</>
                    ) : (
                        <>None of the clocks tried holds the target rate, so they are all listed.</>
                    )}
                </Typography>
            )}
            <Accordion
                disableGutters
                elevation={0}
                slotProps={{ heading: { component: 'h3' } }}
                sx={{ mb: 1, maxWidth: '72ch' }}
            >
                <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    id="how-clocks-are-chosen-summary"
                    aria-controls="how-clocks-are-chosen-details"
                    sx={{ px: 1.5 }}
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
                    {deadlockRisk} The tests that starve and jam the build do not see this, so on this build they do not decide
                    which clock is selected for you: the clocks that hold the target rate are ranked by their wake-ups.
                </Alert>
            )}
            <TableContainer>
                <Table size="small" aria-label={CLOCK_TABLE_NAME}>
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox">
                                <Box component="span" sx={VISUALLY_HIDDEN}>Select</Box>
                            </TableCell>
                            <TableCell>Clock</TableCell>
                            <TableCell>
                                <Tooltip
                                    title="The belt the clock is made for. Moving: each wake window of an inserter that picks up from a belt stays open the ticks shown longer (belt slack), so a pickup that comes late on a moving belt can finish; a rule of thumb, not a simulated belt. Non-moving belt: the wake windows fit a belt that is full and does not move, which is what the simulator models; on a moving belt an inserter can be switched off holding a partial hand. A subtick clock is always made for a non-moving belt, and is not ranked behind other clocks for it. Blank when no clocked inserter picks up from a belt."
                                    arrow
                                    describeChild
                                >
                                    <span tabIndex={0}>Belt</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">
                                <Tooltip
                                    title="Swings each output inserter makes per crafting cycle. The clock repeats after a whole number of crafting cycles (the clock period)."
                                    arrow
                                    describeChild
                                >
                                    <span tabIndex={0}>Output swings</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">Clock period</TableCell>
                            <TableCell align="right">
                                <Tooltip
                                    title="How many wake windows the clock has in all: stretches of ticks during which it switches an inserter on."
                                    arrow
                                    describeChild
                                >
                                    <span tabIndex={0}>Wake windows</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">
                                <Tooltip
                                    title="How many times a minute a machine that finishes a craft wakes an inserter that is switched on and waiting for it, summed over the inserters of one copy of the build in a long run of this clock. Each wake-up is a small check that moves little or nothing, so fewer wake-ups cost less UPS. Shown for clocks that were run long enough to count them. It is the count from one start point; a clock can settle into another steady state from another start point, with another count."
                                    arrow
                                    describeChild
                                >
                                    <span tabIndex={0}>{WAKE_UPS_HEADER}</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="right">{rateHeader(copies)}</TableCell>
                            <TableCell align="right">{OUTPUT_PER_PERIOD_HEADER}</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>{stable.map(renderRow)}</TableBody>
                    {/* the unstable clocks and the ones still being computed: a group of rows of their own, under their header */}
                    <TableBody>
                        {stable.length > 0 && unstable.length > 0 && (
                            <TableRow>
                                <TableCell
                                    // a heading for the rows below it, not a cell of data
                                    component="th"
                                    scope="rowgroup"
                                    colSpan={10}
                                    sx={{ color: 'text.secondary', borderTop: 1, borderColor: 'divider', fontWeight: 'bold' }}
                                >
                                    {RECOMMENDED_COPY.unstableDivider}
                                </TableCell>
                            </TableRow>
                        )}
                        {unstable.map(renderRow)}
                        {pending.map(label => (
                            <TableRow key={`pending-${label}`}>
                                <TableCell padding="checkbox">
                                    <CircularProgress size={16} sx={{ ml: 1.5 }} aria-hidden />
                                </TableCell>
                                <TableCell colSpan={9} sx={{ color: 'text.secondary' }}>
                                    {label}: computing…
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            {anyStable && (showUnstable ? unstableCount > 0 : hiddenCount > 0) && (
                <Box sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        onClick={() => {
                            // the unstable rows already on screen stay first in their group once the others are shown
                            if (!showUnstable) {
                                setPinnedIds(unstable.map(({ alternative }) => alternative.id));
                            }
                            setShowUnstable(shown => !shown);
                        }}
                    >
                        {showUnstable
                            ? `Hide ${unstableCount} unstable clock${unstableCount === 1 ? '' : 's'}`
                            : `Show ${hiddenCount} unstable clock${hiddenCount === 1 ? '' : 's'} that ${hiddenCount === 1 ? 'was' : 'were'} tried`}
                    </Button>
                </Box>
            )}
            {notice}
        </Panel>
    );
}
