import { useEffect, useMemo, useState } from 'react';
import type { Config, MachineTargetRate } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

interface Result {
    key: string;
    rates: MachineTargetRate[] | null;
    error: string | null;
}

/** Query only while the optional target view is open; never show another config's rates. */
export function useMachineTargetRates(exportConfig: () => Config, enabled: boolean) {
    const config = useMemo(() => exportConfig(), [exportConfig]);
    const key = JSON.stringify(config);
    const [result, setResult] = useState<Result | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let current = true;
        // Coalesce edits while typing a target or machine setting.
        const timer = setTimeout(() => {
            askEngine({ kind: 'machine-target-rates', config: JSON.parse(key) as Config }).then(
                rates => { if (current) setResult({ key, rates, error: null }); },
                error => { if (current) setResult({ key, rates: null, error: error instanceof Error ? error.message : 'Could not calculate target rates.' }); },
            );
        }, 180);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, key]);
    const current = result?.key === key ? result : null;
    return {
        rates: current?.rates ?? null,
        error: current?.error ?? null,
        updating: enabled && current === null,
    };
}
