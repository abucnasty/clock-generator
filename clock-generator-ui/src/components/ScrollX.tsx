import { Box, type SxProps, type Theme } from '@mui/material';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { edgeMask, scrollEdges, type ScrollEdges } from '../utils/scrollEdges';

/** The narrowest a chart gets before it scrolls: a 200px label column and a 360px plot */
export const CHART_MIN_WIDTH = 560;
/** Room at the right of a chart for the half of its last time label that sticks out past the plot */
const TICK_ROOM = 12;

interface ScrollXProps {
    /** The box's accessible name: it is a region, so a screen reader can find it and say what scrolls */
    label: string;
    /** The width below which the content scrolls sideways instead of shrinking */
    minWidth?: number | string;
    /** A chart with a time axis: leaves room after the plot for the last label, so that the label alone does not make the box scroll */
    tickRoom?: boolean;
    sx?: SxProps<Theme>;
    children: ReactNode;
}

/**
 * Holds what can be wider than the window. It scrolls sideways inside itself and never moves the page, a keyboard can
 * reach it (Tab, then the arrows), and the edge that has more content fades, so that it shows that it scrolls.
 */
export function ScrollX({ label, minWidth, tickRoom = false, sx, children }: ScrollXProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

    const measure = useCallback(() => {
        const box = boxRef.current;
        if (!box) {
            return;
        }
        const next = scrollEdges(box.scrollLeft, box.clientWidth, box.scrollWidth);
        setEdges(previous => (previous.start === next.start && previous.end === next.end ? previous : next));
    }, []);

    useEffect(() => {
        measure();
        const box = boxRef.current;
        const inner = innerRef.current;
        if (!box || !inner || typeof ResizeObserver === 'undefined') {
            return;
        }
        // the content grows when rows come in, the box when the window does
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        observer.observe(inner);
        return () => observer.disconnect();
    }, [measure]);

    const mask = edgeMask(edges);
    return (
        <Box
            ref={boxRef}
            role="region"
            aria-label={label}
            tabIndex={0}
            onScroll={measure}
            sx={[
                {
                    overflowX: 'auto',
                    maxWidth: '100%',
                    maskImage: mask,
                    WebkitMaskImage: mask,
                    // inside the box, so that the mask does not cut the ring
                    '&:focus-visible': { outlineOffset: -2 },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <Box ref={innerRef} sx={{ minWidth: tickRoom && typeof minWidth === 'number' ? minWidth + TICK_ROOM : minWidth, pr: tickRoom ? `${TICK_ROOM}px` : undefined }}>
                {children}
            </Box>
        </Box>
    );
}
