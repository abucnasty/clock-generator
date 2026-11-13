import { Cancel, CheckCircle, RemoveCircleOutline } from '@mui/icons-material';
import { Alert, AlertTitle, Box, Button, Link, Typography } from '@mui/material';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { WhyNotStable } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { rateVerbs, type TargetCounts } from '../utils/targetCounts';
import {
    clockBadges,
    differenceFromRecommended,
    lossLimitText,
    makesText,
    pickNameMeaning,
    recoversOf,
    signalsText,
    statusOf,
    SUMMARY_COPY,
    wakeUpsText,
} from '../utils/clockSummary';
import { familyCopyOf, strategyNameOf } from '../utils/strategyNames';
import { BadgeChips, ClockChips } from './StrategyChips';
import { RECOMMENDED_COPY, recommendationReason } from '../utils/recommendedClock';
import { Panel } from './Panel';
import { Disclosure } from './Disclosure';
import { RecommendedChip } from './RecommendedChip';
import { WHY_NOT_STABLE_TITLE } from '../utils/whyNotStable';
import { useGameNames } from '../hooks/useGameNames';
import { whyNotStableShowsCause } from '../utils/checkedLanes';
import { DIAGNOSTICS_COPY, hasDiagnostics } from '../utils/diagnostics';
import { CauseHeadline } from './CheckedLanesView';

/** Every string of the card that is not the clock's own, in one place */
const CARD_COPY = {
    heading: 'Selected clock',
    makingFirst: 'Making the first clock…',
    wakeUps: 'Wakeups',
    signals: 'Signals',
    recovers: 'Recovery',
    detailsHeading: 'Simulation results',
    staleLine: 'These clocks are for an earlier build. Generate again for a clock for the build you have now.',
    // the hold sentence of a clock with a loss on a shared lane: the clock-only check, which runs one copy
    holdsOneCopyAlone: 'At steady state one copy alone keeps its rate: yes.',
};

interface ResultSummaryCardProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    /** The clock the selection rule picks; null while there are none */
    recommendedIndex: number | null;
    /** Selects the recommended clock and lets the selection follow it again */
    onSelectRecommended: () => void;
    /** Opens the Diagnostics tab of the selected clock and moves the focus there */
    onShowDiagnostics?: () => void;
    /** More clocks may still arrive, so the recommendation is the best so far */
    isGenerating: boolean;
    /** The player stopped the run, so not every clock was tried and the recommendation is not final */
    stoppedEarly?: boolean;
    /** What to warn of for the selected clock; null when nothing */
    rateWarning: string | null;
    /** Why the recommended clock does not meet goal 1 (the engine's `why_not_stable`); null when it does */
    whyNotStable?: WhyNotStable | null;
    /** The clocks are for an earlier build */
    stale: boolean;
    /** Saved build and inserter assumptions, shown inside the details disclosure. */
    runAssumptions?: ReactNode;
    comparisonAction?: ReactNode;
}

/** A small, readable fact; context stays next to its value instead of filling a tile. */
function Fact({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: ReactNode }) {
    return (
        <Box sx={{ minWidth: 0 }} data-summary-tile={label}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 0.75 }}>
                <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }} data-tile-value>
                    {icon}{value}
                </Typography>
                {sub && <Typography component="span" variant="caption" color="text.secondary" data-tile-sub>{sub}</Typography>}
            </Box>
        </Box>
    );
}

const RECOVERS_ICON = {
    'yes': <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} />,
    'no': <Cancel fontSize="small" aria-hidden sx={{ color: 'warning.main' }} />,
    // not a "?": that is the help control's icon
    'not-tested': <RemoveCircleOutline fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />,
} as const;

type SelectedProps = ResultSummaryCardProps & { selected: ClockAlternativeView };

/** The link to the Diagnostics tab of the selected clock */
function SeeDiagnostics({ onClick }: { onClick: () => void }) {
    return <Link component="button" variant="body2" onClick={onClick} sx={{ verticalAlign: 'baseline' }} data-see-diagnostics="">{DIAGNOSTICS_COPY.see}</Link>;
}

/** The selected clock's name, why it is the one, and its four facts */
function ClockFacts(props: SelectedProps & { nameRef: RefObject<HTMLHeadingElement | null> }) {
    const { alternatives, selectedIndex, recommendedIndex, isGenerating, selected, nameRef } = props;
    const isRecommended = selectedIndex === recommendedIndex;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const makes = makesText(selected, selected.copies);
    const wakeUps = wakeUpsText(selected);
    const signals = signalsText(selected);
    const recovers = recoversOf(selected);
    const { itemLabel } = useGameNames();
    const lossLimit = lossLimitText(selected, itemLabel);
    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, mt: 0.5, minHeight: 32 }}>
                <Typography
                    ref={nameRef}
                    component="h3"
                    variant="h6"
                    tabIndex={-1}
                    // the theme's focus ring marks it when Back to recommended or a finished run puts the focus here
                    sx={{ fontWeight: 600 }}
                    data-clock-name
                >
                    {strategyNameOf(selected)}
                </Typography>
                {/* how the windows were made is said in the compare table's rows, the clock selector and the install dialog */}
                <ClockChips clock={selected} settingsOnly />
                <BadgeChips badges={clockBadges(alternatives, selectedIndex)} meanings={fewestDecidersMeaning(alternatives, selectedIndex)} />
                {isRecommended && (
                    <RecommendedChip isGenerating={isGenerating} data-card-chip="" />
                )}
                {!isRecommended && recommended && (
                    <Button size="small" onClick={() => {
                        props.onSelectRecommended();
                        nameRef.current?.focus({ preventScroll: true });
                    }}>
                        {isGenerating ? RECOMMENDED_COPY.backWhileGenerating : RECOMMENDED_COPY.backToRecommended}
                    </Button>
                )}
                {/* why the clock is not stable stands on the workspace's Diagnostics tab */}
                {props.onShowDiagnostics && hasDiagnostics(selected) && (
                    <SeeDiagnostics onClick={props.onShowDiagnostics} />
                )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }} data-strategy-line>
                {familyCopyOf(selected)?.line ?? selected.label}
            </Typography>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
                    columnGap: 2,
                    rowGap: 1,
                    mt: 1.5,
                }}
            >
                <Fact label={rateVerbs(selected.counts).title} value={makes.value} sub={makes.sub} />
                <Fact label={CARD_COPY.wakeUps} value={wakeUps.value.replace(' a minute', '/min')} sub={wakeUps.sub} />
                <Fact label={CARD_COPY.signals} value={signals.value.replace(' a minute', '/min')} sub={signals.sub} />
                <Fact label={CARD_COPY.recovers} value={recovers.value} icon={RECOVERS_ICON[recovers.kind]} />
            </Box>
            {/* on an Error card the reason beside the chip says it */}
            {recovers.kind !== 'yes' && !props.rateWarning && statusOf(selected).kind !== 'error' && <Typography variant="body2" sx={{ mt: 1 }} data-recovery-detail="">{recovers.detail}</Typography>}
            {lossLimit && <Typography variant="body2" sx={{ mt: 1 }} data-loss-limit>{lossLimit}</Typography>}
        </>
    );
}

/** What the chip Fewest deciders means, by the chip's text; nothing for any other clock */
function fewestDecidersMeaning(alternatives: ClockAlternativeView[], index: number): Record<string, string> {
    const meaning = pickNameMeaning(alternatives, index);
    return meaning ? { [SUMMARY_COPY.fewestDeciders]: meaning } : {};
}

/** Whether the clock keeps its rate at steady state, as a sentence */
function holdStatusText(rate: string, holds: boolean | null | undefined, counts?: TargetCounts, sharedLaneLoss = false): string {
    // on a loss on a shared lane the rate is of all the copies, and the yes of the clock-only check: one copy alone, no number
    if (holds === true && sharedLaneLoss) return CARD_COPY.holdsOneCopyAlone;
    if (holds === true) return `At steady state it keeps ${rateVerbs(counts).ing} ${rate}: yes.`;
    if (holds === false) return 'At steady state it does not keep its rate.';
    return 'Whether it keeps its rate at steady state is unavailable.';
}

function ClockExplanation(props: SelectedProps) {
    const { alternatives, selectedIndex, recommendedIndex, isGenerating, selected } = props;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const reason = selectedIndex === recommendedIndex
        ? recommendationReason(alternatives, recommendedIndex, !isGenerating && !props.stoppedEarly, props.stoppedEarly && !isGenerating)
        : recommended ? [pickNameMeaning(alternatives, selectedIndex), differenceFromRecommended(selected, recommended)].filter(Boolean).join(' ') : '';
    const recovers = recoversOf(selected);
    return <Box sx={{ display: 'grid', gap: 1 }}>
        {reason && <Typography variant="body2" data-card-reason>{reason}</Typography>}
        <Typography variant="body2" data-hold-status>
            {holdStatusText(makesText(selected, selected.copies).value, selected.assessment.holds, selected.counts,
                (selected.assessment.shared_lane_losses?.length ?? 0) > 0)}
        </Typography>
        {recovers.kind === 'yes' && <Typography variant="body2">{recovers.detail}</Typography>}
        {props.runAssumptions}
    </Box>;
}

/**
 * The answer at the top of Results: the selected clock, its facts, and expandable context.
 * Copy stays in the sticky toolbar. While a run has no clock yet, the card says so.
 */
export function ResultSummaryCard(props: ResultSummaryCardProps) {
    const { alternatives, selectedIndex, isGenerating } = props;
    const nameRef = useRef<HTMLHeadingElement>(null);
    const selected = alternatives[selectedIndex];

    // a generation that ends with the focus on nothing (Generate was off while it ran) leaves it on the answer
    const wasGenerating = useRef(isGenerating);
    useEffect(() => {
        const finished = wasGenerating.current && !isGenerating;
        wasGenerating.current = isGenerating;
        const name = nameRef.current;
        const lost = document.activeElement === null || document.activeElement === document.body;
        if (finished && lost && name && name.offsetParent !== null) {
            name.focus();
        }
    }, [isGenerating]);

    if (!selected && !isGenerating) {
        return null;
    }

    const recommended = props.recommendedIndex === null ? undefined : alternatives[props.recommendedIndex];
    const causeAbove = whyNotStableShowsCause(props.whyNotStable, recommended);
    return (
        <Panel title={CARD_COPY.heading} actions={selected ? props.comparisonAction : undefined} sx={{ '& > :last-child': { p: 1.5 } }} data-result-card="" data-build-anchor="selected-clock">
            {props.rateWarning && <Alert severity="warning" sx={{ mb: 1 }}>{props.rateWarning}</Alert>}
            {props.whyNotStable && <Alert severity="warning" sx={{ mb: 1, '& .MuiAlert-message': { minWidth: 0, flex: 1 } }} data-why-not-stable={props.whyNotStable.cause}>
                <AlertTitle>{WHY_NOT_STABLE_TITLE[props.whyNotStable.cause]}</AlertTitle>
                {/* the recommended clock's loss on a shared lane: its count line in place of the note's sentences on the same loss; the rest is on Diagnostics */}
                {causeAbove && recommended?.checkedLanes?.cause
                    ? <CauseHeadline cause={recommended.checkedLanes.cause} />
                    : props.whyNotStable.message}
            </Alert>}
            {props.stale && <Typography variant="body2" sx={{ mb: 1 }} data-card-stale>{CARD_COPY.staleLine}</Typography>}
            {selected ? (
                <ClockFacts {...props} selected={selected} nameRef={nameRef} />
            ) : (
                <Typography variant="body2" color="text.secondary">{CARD_COPY.makingFirst}</Typography>
            )}
            <Disclosure summary={CARD_COPY.detailsHeading} sx={{ mt: 1.5 }}>
                <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
                    {selected && <ClockExplanation {...props} selected={selected} />}
                    {/* only where no clocked inserter picks up from a belt: the card's Belt fact says the rest */}
                    {selected && selected.beltLabel === '' && (
                        <Typography variant="body2" data-belt-line>{SUMMARY_COPY.beltLineNone}</Typography>
                    )}
                </Box>
            </Disclosure>
        </Panel>
    );
}
