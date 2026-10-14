import { useEffect, type RefObject } from 'react';

/**
 * Keeps the CSS variable `--app-header-height` at the height in pixels of the sticky header, as it grows and shrinks
 * (a wrapped workflow bar, a resized window), and the page's `scroll-padding-top` at that height plus 8px, so that
 * focus moved by the keyboard and an element scrolled to are never left under the header (WCAG 2.4.11). The variable is
 * for anything else that needs the header's height, instead of guessing it.
 */
export function useStickyHeaderHeight(ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const header = ref.current;
        if (!header) {
            return;
        }
        const root = document.documentElement;
        const observer = new ResizeObserver(() => {
            const height = header.getBoundingClientRect().height;
            root.style.setProperty('--app-header-height', `${height}px`);
            // what is scrolled to by the keyboard or by script stops short of the header, instead of ending up under it
            root.style.scrollPaddingTop = `calc(${height}px + 8px)`;
        });
        observer.observe(header);
        return () => {
            observer.disconnect();
            root.style.removeProperty('--app-header-height');
            root.style.removeProperty('scroll-padding-top');
        };
    }, [ref]);
}
