import { Cancel, Check, CheckCircle, ContentCopy, HelpOutline, Warning } from '@mui/icons-material';
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material';
import { useEffect, useId, useRef, type ReactNode } from 'react';
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
import { REQUIRES_FACTORIO } from '../utils/installSteps';
import { RECOMMENDED_COPY, recommendationReason, type PickRule } from '../utils/recommendedClock';
import { InstallSteps } from './InstallSteps';
import { CopyLabel } from './WorkflowBar';

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
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** The copy every Copy button shares */
    onCopy: () => void;
    /** "Copy blueprint", "Copy blueprint (192/s, below target)" or "Copy old clock…" */
    copyLabel: string;
    /** What to warn of for the selected clock; null when nothing */
    rateWarning: string | null;
    /** The clocks are for an earlier build */
    stale: boolean;
    /** The build has mining drills on the clock */
    hasDrills: boolean;
    /** Shown right after the belt line: the belt question (2.4) */
    beltAction?: ReactNode;
}

/** One fact of the clock in an inset tile: its name, the value, and a line under it */
function Tile({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: ReactNode }) {
    return (
        <Box sx={{ bgcolor: 'background.default', p: 1.5, minWidth: 0 }} data-summary-tile={label}>
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
    'not-tested': <HelpOutline fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />,
} as const;

/**
 * The answer at the top of Results: the selected clock by name, why it was picked, its facts, the button that copies
 * it and the steps that put it into the game.
 */
export function ResultSummaryCard(props: ResultSummaryCardProps) {
    const { alternatives, selectedIndex, recommendedIndex, isGenerating } = props;
    const headingId = useId();
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

    if (!selected) {
        if (!isGenerating) {
            return null;
        }
        return (
            <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: 2, mb: 2 }} data-result-card>
                <Typography id={headingId} component="h2" variant="h6">{CARD_COPY.heading}</Typography>
                <Typography variant="body2" color="text.secondary">{CARD_COPY.makingFirst}</Typography>
            </Paper>
        );
    }

    const isRecommended = selectedIndex === recommendedIndex;
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    const reason = isRecommended
        ? recommendationReason(alternatives, recommendedIndex, props.pickRule, !isGenerating)
        : recommended ? differenceFromRecommended(selected, recommended) : '';
    const makes = makesText(selected, selected.copies);
    const wakeUps = wakeUpsText(selected);
    const recovers = recoversOf(selected);
    const warns = props.rateWarning !== null || props.stale;

    return (
        <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: 2, mb: 2 }} data-result-card>
            <Typography id={headingId} component="h2" variant="h6">{CARD_COPY.heading}</Typography>

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
                    <Chip
                        size="small"
                        color="primary"
                        label={isGenerating ? RECOMMENDED_COPY.chipWhileGenerating : RECOMMENDED_COPY.chip}
                        data-card-chip
                    />
                )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }} data-engine-name>
                {clockTechnicalName(selected)}
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
                    mt: 2,
                }}
            >
                <Tile label={CARD_COPY.makes} value={makes.value} sub={makes.sub} />
                <Tile label={CARD_COPY.wakeUps} value={wakeUps.value} sub={wakeUps.sub} />
                <Tile label={CARD_COPY.recovers} value={recovers.value} sub={recovers.detail} icon={RECOVERS_ICON[recovers.kind]} />
                <Tile label={CARD_COPY.belt} value={beltValue(props.pickRule, selected.beltLabel)} sub="" />
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1, mt: 1 }}>
                <Typography variant="body2" data-belt-line>{beltLine(props.pickRule, selected.beltLabel)}</Typography>
                {props.beltAction}
            </Box>

            {props.rateWarning && (
                <Alert severity="warning" sx={{ mt: 2 }}>{props.rateWarning}</Alert>
            )}
            {props.stale && (
                <Typography variant="body2" sx={{ mt: 2 }} data-card-stale>{CARD_COPY.staleLine}</Typography>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1, mt: 2 }}>
                <Button
                    // the one filled green button of the page; yellow with the warning icon when there is something to
                    // warn of, and outlined for an earlier build's clock, the copy to think twice about
                    variant={props.stale ? 'outlined' : 'contained'}
                    color={warns ? 'warning' : 'secondary'}
                    onClick={props.onCopy}
                    startIcon={props.copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                    data-card-copy
                >
                    {props.copied ? CARD_COPY.copied : <CopyLabel label={props.copyLabel} />}
                </Button>
                <Typography variant="body2" color="text.secondary">{REQUIRES_FACTORIO}</Typography>
            </Box>

            <InstallSteps install={selected.install} hasDrills={props.hasDrills} stale={props.stale} />
        </Paper>
    );
}
