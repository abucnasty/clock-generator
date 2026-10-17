import { useEffect, type RefObject } from 'react';
import { isUnderHeader } from '../utils/headerOverlap';

/**
 * Keeps the CSS variable `--app-header-height` at the height in pixels of the sticky header, as it grows and shrinks
 * (a wrapped workflow bar, a message, a resized window), and the page's `scroll-padding-top` at that height plus 8px and the measured `--sticky-under-header` bulk bar, so
 * that focus moved by the keyboard and an element scrolled to are never left under the header (WCAG 2.4.11); and when
 * the header grows over the focused element, brings that element back below it. The variable is for anything else that
 * needs the header's height, instead of guessing it.
 */
export function useStickyHeaderHeight(ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const header = ref.current;
        if (!header) {
            return;
        }
        const root = document.documentElement;
        let previousHeight = 0;
        const observer = new ResizeObserver(() => {
            const box = header.getBoundingClientRect();
            const height = box.height;
            root.style.setProperty('--app-header-height', `${height}px`);
            // what is scrolled to by the keyboard or by script stops short of the header, instead of ending up under it
            root.style.scrollPaddingTop = `calc(${height}px + 8px + var(--sticky-under-header, 0px))`;
            const grew = height > previousHeight;
            previousHeight = height;
            const active = document.activeElement;
            if (grew && active instanceof HTMLElement && active.closest('main') && isUnderHeader(active.getBoundingClientRect(), box.bottom)) {
                // honours the scroll padding just set
                active.scrollIntoView({ block: 'nearest' });
            }
        });
        observer.observe(header);
        return () => {
            observer.disconnect();
            root.style.removeProperty('--app-header-height');
            root.style.removeProperty('scroll-padding-top');
        };
    }, [ref]);
}
