import { useEffect, useMemo, useState } from 'react';
import type { Config, TargetRateMax } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

interface Answer {
    /** The build the answer is for, whatever its rate */
    build: string;
    /** The build with its rate */
    key: string;
    max: TargetRateMax | null;
}

/** The result of `useTargetRateMax`: the maximum, and whether what it says of the target typed in is for that target */
interface TargetRateMaxResult {
    max: TargetRateMax | null;
    /** False while the answer is for another rate of the same build: the maximum is the same, what it says of the target is not */
    current: boolean;
}

/**
 * The most the target can be before the engine's feasibility pass refuses it (`targetRateMaxOf`), for the build as it is.
 * Asked after edits settle. While a new answer is on its way, the last one stays for the same build at another rate, whose
 * maximum does not move; for another build it is not shown, and the machines' own maximum stands.
 */
export function useTargetRateMax(config: Config, enabled: boolean): TargetRateMaxResult {
    const key = useMemo(() => JSON.stringify(config), [config]);
    // a rate of nothing yet, or not a number, is asked as 1: the maximum is the same, and the engine can work it out
    const build = useMemo(() => JSON.stringify({ ...config, target_output: { ...config.target_output, items_per_second: 0 } }), [config]);
    const [answer, setAnswer] = useState<Answer | null>(null);
    useEffect(() => {
        const asked = JSON.parse(key) as Config;
        if (!enabled || !asked.target_output.recipe) return;
        let current = true;
        const timer = setTimeout(() => {
            if (!(asked.target_output.items_per_second > 0)) asked.target_output.items_per_second = 1;
            askEngine({ kind: 'target-rate-max', config: asked }).then(
                max => { if (current) setAnswer({ build, key, max }); },
                // an answer that fails leaves the machines' maximum standing
                () => { if (current) setAnswer({ build, key, max: null }); },
            );
        }, 200);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, key, build]);
    const max = answer !== null && answer.build === build ? answer.max : null;
    const current = answer !== null && answer.build === build && answer.key === key;
    return useMemo(() => ({ max, current }), [max, current]);
}
