import { Box, Typography } from '@mui/material';
import { FORCED_COLORS, WAKE_BAR_COLOR, WAKE_TRACK_COLOR } from './WakeWindowsChart';

interface Span {
    start: number;
    end: number;
}

interface RulePeriodStripProps {
    /** The rule's period: positions 0 to `periodTicks - 1` */
    periodTicks: number;
    /** The rule's valid wake windows, inclusive ticks */
    windows: Span[];
    /** The clock's wake windows for the same entity, on Results; null when there are none to compare */
    reference: Span[] | null;
}

const TRACK_HEIGHT = 16;
/** A 1-tick window is still drawn this wide; the sentence gives its true length */
const MIN_BAR_PX = 2;

const percent = (ticks: number, period: number) => `${(ticks / period) * 100}%`;

const trackSx = {
    position: 'relative',
    height: TRACK_HEIGHT,
    border: `1px solid ${WAKE_TRACK_COLOR}`,
    boxSizing: 'border-box',
    forcedColorAdjust: 'none',
    [FORCED_COLORS]: { borderColor: 'CanvasText' },
} as const;

const barSx = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    minWidth: MIN_BAR_PX,
    boxSizing: 'border-box',
} as const;

const solidSx = { ...barSx, bgcolor: WAKE_BAR_COLOR, [FORCED_COLORS]: { bgcolor: 'CanvasText' } } as const;
const outlinedSx = { ...barSx, border: `1px solid ${WAKE_BAR_COLOR}`, [FORCED_COLORS]: { borderColor: 'CanvasText' } } as const;

function Track({ label, spans, periodTicks, outlined }: { label: string; spans: Span[]; periodTicks: number; outlined: boolean }) {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary" component="div">{label}</Typography>
            <Box sx={trackSx} data-rule-strip-track={outlined ? 'clock' : 'rule'}>
                {spans.map((span, index) => (
                    <Box
                        key={index}
                        data-rule-strip-bar={outlined ? 'clock' : 'rule'}
                        sx={outlined ? outlinedSx : solidSx}
                        style={{ left: percent(span.start, periodTicks), width: percent(span.end - span.start + 1, periodTicks) }}
                    />
                ))}
            </Box>
        </Box>
    );
}

/**
 * The rule's wake windows drawn over one period, and the clock's under them when Results has some: yours solid, the
 * clock's outlined, so the shape and the label tell them apart, not the colour. Hidden from screen readers: the
 * sentence and the caption above say the same in words.
 */
export function RulePeriodStrip({ periodTicks, windows, reference }: RulePeriodStripProps) {
    const inPeriod = (spans: Span[]) => spans.filter((span) => span.start <= span.end && span.end < periodTicks);
    return (
        <Box aria-hidden data-rule-strip="" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 2, maxWidth: 560 }}>
            <Track label="Your wake windows" spans={inPeriod(windows)} periodTicks={periodTicks} outlined={false} />
            {reference && <Track label="The clock's wake windows" spans={inPeriod(reference)} periodTicks={periodTicks} outlined />}
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">0</Typography>
                <Typography variant="caption" color="text.secondary">{periodTicks - 1}</Typography>
            </Box>
        </Box>
    );
}
