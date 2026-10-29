import { useEffect, useState, type RefObject } from 'react';

/** The width of the element `ref` holds in whole pixels, kept up to date as it resizes: 0 until it is measured */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        setWidth(Math.floor(element.getBoundingClientRect().width));
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}
