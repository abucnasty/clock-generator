/** The narrowest a mark is drawn, in CSS px (WCAG 1.4.11 needs the mark to be seen; the review asked for 3) */
export const MIN_MARK_PX = 3;

interface MarkSpan { x: number; width: number; narrow: boolean }

/** Where a mark that starts at `tick` and lasts `durationTicks` goes on a track `trackWidth` px wide */
export function markSpan(tick: number, durationTicks: number, totalDuration: number, trackWidth: number): MarkSpan {
    if (totalDuration <= 0 || trackWidth <= 0) {
        return { x: 0, width: 0, narrow: false };
    }
    const natural = (durationTicks / totalDuration) * trackWidth;
    const width = Math.min(Math.max(natural, MIN_MARK_PX), trackWidth);
    const x = Math.min(Math.max((tick / totalDuration) * trackWidth, 0), trackWidth - width);
    return { x, width, narrow: natural < MIN_MARK_PX };
}

/** Paint order: 0 wide marks, 1 narrow marks, 2 narrow marks of a state that must not be hidden. Paint 0 first. */
export function paintLayer(span: MarkSpan, priority: boolean): 0 | 1 | 2 {
    if (!span.narrow) {
        return 0;
    }
    return priority ? 2 : 1;
}
