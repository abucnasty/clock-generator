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
import { SURFACE } from '../theme/tokens';
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
}

/** One fact of the clock in an inset tile: its name, the value, and a line under it */
function Tile({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: ReactNode }) {
    const { density } = useDisplayPreferences();
    return (
        // a row of the card, as an entity row is on Configure
        <Box sx={{ bgcolor: SURFACE.row, p: density === 'compact' ? 1 : 1.5, minWidth: 0 }} data-summary-tile={label}>
            <Typography variant="body2" color="text.secondary" component="p">{label}</Typography>
            <Typography variant="h6" component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }} data-tile-value>
                {icon}
                {value}
            </Typography>
            {sub && <Typography variant="body2" color="text.secondary" component="p" data-tile-sub>{sub}</Typography>}
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
    const { density } = useDisplayPreferences();
    const { alternatives, selectedIndex, recommendedIndex, isGenerating, selected, nameRef } = props;
    const isRecommended = selectedIndex === recommendedIndex;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const reason = isRecommended
        ? recommendationReason(alternatives, recommendedIndex, props.pickRule, !isGenerating && !props.stoppedEarly, props.stoppedEarly && !isGenerating)
        : recommended ? differenceFromRecommended(selected, recommended) : '';
    const makes = makesText(selected, selected.copies);
    const wakeUps = wakeUpsText(selected);
    const recovers = recoversOf(selected);
    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, mt: 0.5 }}>
                <Typography
                    ref={nameRef}
                    component="h3"
                    variant="h5"
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
            <Typography variant="body2" sx={{ mt: 1 }} data-start-assumption>
                Full input supplies; empty modeled machines, buffers and hands; phase 0. Rates follow model warm-up. {startCheckSummary([selected], props.generationAssumptions ?? null)}
            </Typography>

            <Typography variant="body2" sx={{ mt: 0.5 }} data-hold-status>
                Modeled output holds: {selected.assessment.holds === true ? 'Yes' : selected.assessment.holds === false ? 'No' : 'unavailable'}.
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, mt: 1, maxWidth: '80ch' }}>
                {reason && <Typography variant="body2" data-card-reason>{reason}</Typography>}
                {!isRecommended && recommended && (
                    <Button
                        size="small"
                        onClick={() => {
                            props.onSelectRecommended();
                            // the button goes away with the press; the name it changed is where the focus lands
                            nameRef.current?.focus();
                        }}
                    >
                        {isGenerating ? RECOMMENDED_COPY.backWhileGenerating : RECOMMENDED_COPY.backToRecommended}
                    </Button>
                )}
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
                    gap: 1,
                    mt: density === 'compact' ? 1 : 2,
                }}
            >
                <Tile label={CARD_COPY.makes} value={makes.value} sub={makes.sub} />
                <Tile label={CARD_COPY.wakeUps} value={wakeUps.value} sub={wakeUps.sub} />
                <Tile label={CARD_COPY.recovers} value={recovers.value} sub={density === 'compact' ? 'Simulator loss trials' : recovers.detail} icon={RECOVERS_ICON[recovers.kind]} />
                <Tile label={CARD_COPY.belt} value={beltValue(props.pickRule, selected.beltLabel)} sub={selected.ranking.matches_belt_choice ? 'Matches the saved belt setting in the selection rule' : 'Requires a different belt setting'} />
            </Box>
        </>
    );
}

/** The warnings and the Copy action, visible whichever context is open */
function ClockCopy(props: SelectedProps) {
    const warns = props.rateWarning !== null || props.stale;
    const { selected } = props;
    return (
        <>
            {props.rateWarning && (
                <Alert severity="warning" sx={{ mt: 2 }}>{props.rateWarning}</Alert>
            )}
            {props.stale && (
                <Typography variant="body2" sx={{ mt: 2 }} data-card-stale>{CARD_COPY.staleLine}</Typography>
            )}

            {/* a build that needs no clock has nothing to copy: the steps say so (a stale one keeps "Copy old clock…") */}
            {(props.stale || !needsNoClock(selected.install)) && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1, mt: 2 }}>
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
                <Typography variant="body2" color="text.secondary">{REQUIRES_FACTORIO}</Typography>
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
        <Panel title={CARD_COPY.heading} sx={{ '& > :last-child': { p: density === 'compact' ? 1.5 : 2 } }} data-result-card="" data-build-anchor="selected-clock">
            {selected ? <ClockFacts {...props} selected={selected} nameRef={nameRef} /> : (
                <Typography variant="body2" color="text.secondary">{CARD_COPY.makingFirst}</Typography>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1, mt: 1 }}>
                {/* 2.4's line says what the clocks assume of the belts when the run asked, and the clock picks up from a
                    belt (while a run has no clock yet too, so its action keeps the focus); otherwise the card says it */}
                {selected && !showBeltAction && (
                    <Typography variant="body2" data-belt-line>{beltLine(props.pickRule, selected.beltLabel)}</Typography>
                )}
                {showBeltAction && props.beltAction}
            </Box>
            {selected ? <ClockCopy {...props} selected={selected} /> : null}
        </Panel>
    );
}
