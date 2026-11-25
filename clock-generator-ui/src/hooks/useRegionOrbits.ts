import { useEffect, useMemo, useState } from 'react';
import type { Config, FoundOrbit } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

interface Result {
    key: string;
    orbits: FoundOrbit[] | null;
}

/**
 * A read-only worker query for the copied regions of the build, which the Layout view tints. `orbits` is null while the
 * answer is loading, where the build has none and where the engine could not answer: the view draws no region then.
 */
export function useRegionOrbits(config: Config, enabled = true): FoundOrbit[] | null {
    const key = useMemo(() => JSON.stringify(config), [config]);
    const [result, setResult] = useState<Result | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'region-orbits', config: JSON.parse(key) as Config }).then(
                orbits => { if (current) setResult({ key, orbits }); },
                () => { if (current) setResult({ key, orbits: null }); },
            );
        }, 180);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, key]);

    return result?.key === key ? result.orbits : null;
}
