/** Which edges of a box that scrolls sideways have more content beyond them */
export interface ScrollEdges {
    start: boolean;
    end: boolean;
}

/** How wide the fade at an edge is, in pixels */
const FADE_WIDTH = 48;

/** Is there more content before (`start`) and after (`end`) what the box shows? A pixel of slack absorbs subpixel rounding. */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): ScrollEdges {
    return {
        start: scrollLeft > 1,
        end: scrollLeft + clientWidth < scrollWidth - 1,
    };
}

/** A `mask-image` that fades the edges that have more content, or `undefined` when the whole content shows */
export function edgeMask({ start, end }: ScrollEdges): string | undefined {
    if (!start && !end) {
        return undefined;
    }
    const left = start ? 'transparent' : 'black';
    const right = end ? 'transparent' : 'black';
    return `linear-gradient(to right, ${left} 0, black ${FADE_WIDTH}px, black calc(100% - ${FADE_WIDTH}px), ${right} 100%)`;
}
