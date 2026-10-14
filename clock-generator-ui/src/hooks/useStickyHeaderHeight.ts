import { useEffect, type RefObject } from 'react';

/**
 * Keeps the CSS variable `--app-header-height` at the height in pixels of the sticky header, as it grows and shrinks
 * (a wrapped workflow bar, a resized window). Anything that scrolls or focuses to an element can leave this much
 * room above it with `scroll-margin-top`, instead of guessing how tall the header is.
 */
export function useStickyHeaderHeight(ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const header = ref.current;
        if (!header) {
            return;
        }
        const root = document.documentElement;
        const observer = new ResizeObserver(() => {
            root.style.setProperty('--app-header-height', `${header.getBoundingClientRect().height}px`);
        });
        observer.observe(header);
        return () => {
            observer.disconnect();
            root.style.removeProperty('--app-header-height');
        };
    }, [ref]);
}
