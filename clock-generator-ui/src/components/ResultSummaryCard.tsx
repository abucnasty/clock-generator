import { Cancel, Check, CheckCircle, ContentCopy, RemoveCircleOutline, Warning } from '@mui/icons-material';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { ClockAlternativeView } from '../worker/types';
import {
    beltLine,
    beltValue,
    clockTechnicalName,
    differenceFromRecommended,
    makesText,
    plainClockName,
    recoversOf,
    wakeUpsText,
} from '../utils/clockSummary';
import { REQUIRES_FACTORIO, needsNoClock } from '../utils/installSteps';
import { RECOMMENDED_COPY, recommendationReason, type PickRule } from '../utils/recommendedClock';
import { Panel } from './Panel';
import { RecommendedChip } from './RecommendedChip';
import { CopyLabel } from './WorkflowBar';
import type { GenerationAssumptions } from '../worker/types';
import { startCheckSummary } from '../utils/modelAssumptions';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';

/** Every string of the card that is not the clock's own, in one place */
const CARD_COPY = {
    heading: 'Your clock',
    makingFirst: 'Making the first clock…',
    makes: 'Makes',
    wakeUps: 'Wake-ups',
    recovers: 'Recovers',
    belt: 'Belt',
    copied: 'Copied',
    staleLine: 'These clocks are for an earlier build. Generate again for a clock for the build you have now.',
};

interface ResultSummaryCardProps {
    generationAssumptions?: GenerationAssumptions | null;
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    /** The clock the selection rule picks; null while there are none */
    recommendedIndex: number | null;
    /** Selects the recommended clock and lets the selection follow it again */
    onSelectRecommended: () => void;
    /** What the selection rule was given by the latest generation's config; null before one */
    pickRule: PickRule | null;
    /** More clocks may still arrive, so the recommendation is the best so far */
    isGenerating: boolean;
    /** The player stopped the run, so not every clock was tried and the recommendation is not final */
    stoppedEarly?: boolean;
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** The copy every Copy button shares */
    onCopy: () => void;
    /** "Copy blueprint", "Copy blueprint (192/s, below target)" or "Copy old clock…" */
    copyLabel: string;
    /** The Copy is the page's one filled button: the clocks are fresh and nothing runs */
    copyIsNextStep: boolean;
    /** What to warn of for the selected clock; null when nothing */
    rateWarning: string | null;
    /** The clocks are for an earlier build */
    stale: boolean;
    /**
     * What the clocks assume of the belts, with the action for the other answer (2.4), in place of the card's own belt
     * line; shown also before the first clock arrives
     */
    beltAction?: ReactNode;
    /** Saved build and inserter assumptions, shown inside the details disclosure. */
    runAssumptions?: ReactNode;
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

/** The selected clock's name, why it is the one, and its four facts */
function ClockFacts(props: SelectedProps & { nameRef: RefObject<HTMLHeadingElement | null> }) {
    const { alternatives, selectedIndex, recommendedIndex, isGenerating, selected, nameRef } = props;
    const isRecommended = selectedIndex === recommendedIndex;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const makes = makesText(selected, selected.copies);
    const wakeUps = wakeUpsText(selected);
    const recovers = recoversOf(selected);
    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, mt: 0.5 }}>
                <Typography
                    ref={nameRef}
                    component="h3"
                    variant="h6"
                    tabIndex={-1}
                    // the theme's focus ring marks it when Back to recommended or a finished run puts the focus here
                    sx={{ fontWeight: 600 }}
                    data-clock-name
                >
                    {plainClockName(alternatives, selectedIndex)}
                </Typography>
                {isRecommended && (
                    <RecommendedChip isGenerating={isGenerating} data-card-chip="" />
                )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }} data-engine-name>
                {clockTechnicalName(selected)}
            </Typography>
            {!isRecommended && recommended && (
                <Button size="small" onClick={() => {
                    props.onSelectRecommended();
                    nameRef.current?.focus();
                }}>
                    {isGenerating ? RECOMMENDED_COPY.backWhileGenerating : RECOMMENDED_COPY.backToRecommended}
                </Button>
            )}

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
                    columnGap: 2,
                    rowGap: 1,
                    mt: 1.5,
                }}
            >
                <Fact label={CARD_COPY.makes} value={makes.value} sub={makes.sub} />
                <Fact label={CARD_COPY.wakeUps} value={wakeUps.value.replace(' a minute', '/min')} sub={wakeUps.sub} />
                <Fact label={CARD_COPY.recovers} value={recovers.value} icon={RECOVERS_ICON[recovers.kind]} />
                <Fact label={CARD_COPY.belt} value={beltValue(props.pickRule, selected.beltLabel)} sub={selected.ranking.matches_belt_choice ? undefined : 'Different setting'} />
            </Box>
            {recovers.kind !== 'yes' && !props.rateWarning && <Typography variant="body2" sx={{ mt: 1 }}>{recovers.detail}</Typography>}
        </>
    );
}

function ClockExplanation(props: SelectedProps) {
    const { alternatives, selectedIndex, recommendedIndex, isGenerating, selected } = props;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const reason = selectedIndex === recommendedIndex
        ? recommendationReason(alternatives, recommendedIndex, props.pickRule, !isGenerating && !props.stoppedEarly, props.stoppedEarly && !isGenerating)
        : recommended ? differenceFromRecommended(selected, recommended) : '';
    const recovers = recoversOf(selected);
    return <Box sx={{ display: 'grid', gap: 1 }}>
        {reason && <Typography variant="body2" data-card-reason>{reason}</Typography>}
        <Typography variant="body2" data-start-assumption>
            Full input supplies; empty modeled machines, buffers and hands; phase 0. Rates follow model warm-up. {startCheckSummary([selected], props.generationAssumptions ?? null)}
        </Typography>
        <Typography variant="body2" data-hold-status>
            Modeled output holds: {selected.assessment.holds === true ? 'Yes' : selected.assessment.holds === false ? 'No' : 'unavailable'}.
        </Typography>
        {recovers.kind === 'yes' && <Typography variant="body2">{recovers.detail}</Typography>}
        {props.runAssumptions}
    </Box>;
}

/** The Copy action stays visible in the title bar while explanations are collapsed. */
function ClockCopy(props: SelectedProps) {
    const warns = props.rateWarning !== null || props.stale;
    const { selected } = props;
    return (
        <>
            {/* a build that needs no clock has nothing to copy: the steps say so (a stale one keeps "Copy old clock…") */}
            {(props.stale || !needsNoClock(selected.install)) && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5 }}>
                <Button
                    // the one filled green button of the page while the clocks are fresh; yellow with the warning icon
                    // when there is something to warn of. Outlined while Generate is the next step (a run, or a changed
                    // build, whose old clock is the copy to think twice about)
                    variant={props.copyIsNextStep && !props.stale ? 'contained' : 'outlined'}
                    color={warns ? 'warning' : props.copyIsNextStep ? 'secondary' : 'inherit'}
                    onClick={props.onCopy}
                    startIcon={props.copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                    data-card-copy
                >
                    {props.copied ? CARD_COPY.copied : <CopyLabel label={props.copyLabel} />}
                </Button>
                <Typography variant="caption" color="text.secondary">{REQUIRES_FACTORIO}</Typography>
            </Box>}

        </>
    );
}

/**
 * The answer at the top of Results: the selected clock by name, why it was picked, its facts, the button that copies
 * it. While a run has no clock yet, it says so.
 */
export function ResultSummaryCard(props: ResultSummaryCardProps) {
    const { alternatives, selectedIndex, isGenerating } = props;
    const { density } = useDisplayPreferences();
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

    // one tree for a run's start and for its clocks, so the belt action (2.4) stays mounted, and keeps the keyboard
    // focus, when the run it starts empties the list of clocks
    const showBeltAction = Boolean(props.beltAction) && (!selected || selected.beltLabel !== '');
    return (
        <Panel title={CARD_COPY.heading} actions={selected ? <ClockCopy {...props} selected={selected} /> : undefined} sx={{ '& > :last-child': { p: density === 'compact' ? 1.5 : 2 } }} data-result-card="" data-build-anchor="selected-clock">
            {props.rateWarning && <Alert severity="warning" sx={{ mb: 1 }}>{props.rateWarning}</Alert>}
            {props.stale && <Typography variant="body2" sx={{ mb: 1 }} data-card-stale>{CARD_COPY.staleLine}</Typography>}
            {selected ? <ClockFacts {...props} selected={selected} nameRef={nameRef} /> : (
                <Typography variant="body2" color="text.secondary">{CARD_COPY.makingFirst}</Typography>
            )}
            <Box component="details" sx={{ mt: 1.5, '& > summary': { cursor: 'pointer', width: 'fit-content', typography: 'body2', color: 'text.secondary' } }}>
                <Box component="summary">Details &amp; assumptions</Box>
                <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
                    {selected && <ClockExplanation {...props} selected={selected} />}
                    {/* Keep this action mounted when its run temporarily empties the clock list. */}
                    {selected && !showBeltAction && (
                        <Typography variant="body2" data-belt-line>{beltLine(props.pickRule, selected.beltLabel)}</Typography>
                    )}
                    {showBeltAction && props.beltAction}
                </Box>
            </Box>
        </Panel>
    );
}
