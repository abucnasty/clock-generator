import { useEffect, useState } from 'react';
import type { DisplayScheme } from '../utils/displayPreferences';
import type { ResolvedColorScheme } from '../theme/tokens';
import { useDisplayPreferences } from './useDisplayPreferences';

export function resolveColorScheme(scheme: DisplayScheme, systemDark: boolean): ResolvedColorScheme {
    return scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme;
}

function systemMedia(): MediaQueryList | null {
    try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; }
}

/** One listener for the mounted theme adapter, cleaned up on teardown. */
export function useResolvedColorScheme(): ResolvedColorScheme {
    const { scheme } = useDisplayPreferences();
    const [media] = useState(systemMedia);
    const [systemDark, setSystemDark] = useState(() => media?.matches ?? false);
    useEffect(() => {
        if (!media) return;
        const update = () => setSystemDark(media.matches);
        update();
        try {
            media.addEventListener('change', update);
            return () => media.removeEventListener('change', update);
        } catch {
            // Older or restricted browsers can lack the modern media-event API.
            try { media.addListener(update); return () => media.removeListener(update); } catch { return; }
        }
    }, [media]);
    return resolveColorScheme(scheme, systemDark);
}
