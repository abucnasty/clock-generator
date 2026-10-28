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
    if (priority) {
        return 2;
    }
    return span.narrow ? 1 : 0;
}

/** A mark's edges on whole device pixels (`ratio` device px per CSS px), never narrower than MIN_MARK_PX */
export function snapSpan(span: MarkSpan, ratio: number): { x: number; width: number } {
    const left = Math.round(span.x * ratio) / ratio;
    const right = Math.round((span.x + span.width) * ratio) / ratio;
    return { x: left, width: Math.max(right - left, MIN_MARK_PX) };
}

/**
 * Sizes `canvas` for drawing `width` × `height` CSS pixels sharply on this screen, at most `maxRatio` device pixels to
 * one, cleared, with the context drawing in CSS pixels. Null when it cannot be drawn on yet (not measured, no context).
 */
export function paintableCanvas(canvas: HTMLCanvasElement | null, width: number, height: number, maxRatio = Infinity) {
    const context = canvas?.getContext('2d');
    if (!canvas || !context || width <= 0) return null;
    const ratio = Math.min(maxRatio, window.devicePixelRatio || 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, ratio };
}
