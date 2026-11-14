import { TableChartOutlined } from '@mui/icons-material';
import { alpha, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useId, type ReactNode } from 'react';
import type { ClockAlternativeView } from '../worker/types';
import { useHeldOrder } from '../hooks/useHeldOrder';
import { statusOf } from '../utils/clockSummary';
import { partitionClockRows, RECOMMENDED_COPY, type ClockRow } from '../utils/recommendedClock';
import { fullClockName, strategyNameOf } from '../utils/strategyNames';
import { HANDS_TEXT } from '../utils/targetCounts';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { ClockStatusMark } from './ClockStatusMark';
import { Panel } from './Panel';

const LIST_COPY = {
    heading: 'Clocks',
    compare: (count: number) => `Compare all ${count}`,
    rank: '#',
    clock: 'Clock',
    wakeUps: 'Wakeups /min',
    signals: 'Signals /min',
    computing: (label: string) => `${label}: computing…`,
};

/** Rank, the name over its swings, the wakeups and the signals of one copy, the status mark */
const ROW_COLUMNS = { display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) 48px 40px 20px', columnGap: 0.75, alignItems: 'center' } as const;

const swingsOf = (clock: ClockAlternativeView) => clock.counts === 'destroyed' ? HANDS_TEXT.clock(clock.terminalSwingCount)
    : `${clock.terminalSwingCount} ${clock.terminalSwingCount === 1 ? 'swing' : 'swings'}`;
const perMinute = (value: number | null | undefined) => value === null || value === undefined ? null : Math.round(value);

/**
 * What a row reads out: its rank, the clock's full name, its figures and its status, once. The status's words stand only
 * here and in the line under the name; the mark is drawn, not read
 */
function spokenName(clock: ClockAlternativeView, rank: number): string {
    const status = statusOf(clock);
    const wakeUps = perMinute(clock.assessment.wake_ups_per_minute);
    const signals = perMinute(clock.assessment.signals_per_minute);
    return [
        `Rank ${rank}: ${fullClockName(clock)}`,
        wakeUps === null ? 'wakeups not counted' : `${wakeUps} wakeups a minute`,
        signals === null ? 'signals not counted' : `${signals} signals a minute`,
        status.detail ? `${status.text}, ${status.detail}` : status.text,
    ].join('; ');
}

interface ClockListProps {
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** Opens the compare table over the page */
    onCompare: () => void;
    /** Labels of alternatives still being generated */
    pending?: string[];
    /** A run is adding clocks: the rows hold still, and are sorted by rank when it is false again (useHeldOrder) */
    running?: boolean;
    /** Under the rows: whether a deeper search is on offer */
    notice?: ReactNode;
}

/**
 * The clocks of the generation, one compact row each, to choose the clock the page shows: the Stable ones, then the
 * others under their divider, ranked in the engine's order. A radio group: one tab stop, the arrow keys move through the
 * clocks and select each, as the tabs of the workspace do, and a screen reader says which is selected and how many there
 * are. A list box would do the same, but its selection would need its own keys and announcements; native radios have them.
 */
export function ClockList({ alternatives, selectedIndex, onSelect, onCompare, pending = [], running = false, notice }: ClockListProps) {
    const name = useId();
    const held = useHeldOrder(alternatives, running);
    const isStable = (clock: ClockAlternativeView) => statusOf(clock).kind === 'stable';
    const { stable, unstable } = partitionClockRows(alternatives, { isStable, held });

    // the index is the one drawn in this render, so a press cannot land on a row that has since moved
    const renderRow = ({ alternative, index, rank }: ClockRow<ClockAlternativeView>) => {
        const status = statusOf(alternative);
        const selected = index === selectedIndex;
        // under the name, where the clock is not Stable: the rate it makes, or the status's word
        const statusLine = status.kind === 'stable' ? null
            : (status.kind === 'underproduces' || status.kind === 'overproduces') && status.detail ? status.detail : status.text;
        const wakeUps = perMinute(alternative.assessment.wake_ups_per_minute);
        const signals = perMinute(alternative.assessment.signals_per_minute);
        return (
            <Box component="label" key={alternative.id} data-clock-row={alternative.id} sx={theme => ({
                ...ROW_COLUMNS, minHeight: 44, px: 0.5, py: 0.5, cursor: 'pointer', borderBottom: 1, borderColor: 'divider',
                bgcolor: selected ? alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity) : undefined,
                '&:hover': { bgcolor: selected ? alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity + theme.palette.action.hoverOpacity) : 'action.hover' },
                '&:has(input:focus-visible)': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
            })}>
                <Box component="input" type="radio" name={name} value={index} checked={selected} onChange={() => onSelect(index)}
                    aria-label={spokenName(alternative, rank)} sx={VISUALLY_HIDDEN} />
                <Box component="span" aria-hidden data-rank="" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: rank === 1 ? 700 : undefined }}>{rank}</Box>
                <Box component="span" aria-hidden sx={{ minWidth: 0 }}>
                    <Box component="span" data-clock-name="" sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{strategyNameOf(alternative)}</Box>
                    <Typography component="span" variant="caption" color={selected ? 'text.primary' : 'text.secondary'} data-clock-swings=""
                        sx={{ display: 'block', lineHeight: 1.3 }}>
                        {swingsOf(alternative)}{statusLine && ` · ${statusLine}`}
                    </Typography>
                </Box>
                <Box component="span" aria-hidden data-wake-ups="" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{wakeUps ?? '—'}</Box>
                <Box component="span" aria-hidden data-signals="" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{signals ?? '—'}</Box>
                <Box component="span" aria-hidden sx={{ display: 'inline-flex' }}><ClockStatusMark kind={status.kind} /></Box>
            </Box>
        );
    };

    return (
        <Panel title={LIST_COPY.heading} sx={{ mb: 0, '& > :last-child': { p: 1 } }} data-clock-list="" data-build-anchor="comparison"
            actions={alternatives.length > 0 && (
                <Button size="small" variant="outlined" startIcon={<TableChartOutlined />} onClick={onCompare}>
                    {LIST_COPY.compare(alternatives.length)}
                </Button>
            )}>
            {/* the heads of the figures, for the eye; each row reads its own figures out with their names */}
            <Box aria-hidden sx={{ ...ROW_COLUMNS, px: 0.5, pb: 0.5, typography: 'caption', color: 'text.secondary', lineHeight: 1.2, borderBottom: 1, borderColor: 'divider' }}>
                <Box component="span" sx={{ textAlign: 'right' }}>{LIST_COPY.rank}</Box>
                <span>{LIST_COPY.clock}</span>
                <Box component="span" sx={{ textAlign: 'right' }}>{LIST_COPY.wakeUps}</Box>
                <Box component="span" sx={{ textAlign: 'right' }}>{LIST_COPY.signals}</Box>
                <span />
            </Box>
            {(stable.length > 0 || unstable.length > 0) && (
                <Box role="radiogroup" aria-label={LIST_COPY.heading}>
                    {stable.map(renderRow)}
                    {stable.length > 0 && unstable.length > 0 && (
                        <Typography variant="caption" color="text.secondary" component="div" data-clock-divider=""
                            sx={{ px: 0.5, pt: 1.25, pb: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                            {RECOMMENDED_COPY.unstableDivider}
                        </Typography>
                    )}
                    {unstable.map(renderRow)}
                </Box>
            )}
            {pending.map(label => (
                <Box key={`pending-${label}`} data-clock-pending="" sx={{ ...ROW_COLUMNS, minHeight: 36, px: 0.5, borderBottom: 1, borderColor: 'divider', color: 'text.secondary' }}>
                    <CircularProgress size={14} aria-hidden sx={{ justifySelf: 'end' }} />
                    <Typography variant="caption" sx={{ gridColumn: 'span 4' }}>{LIST_COPY.computing(label)}</Typography>
                </Box>
            ))}
            {notice}
        </Panel>
    );
}
