import { useEffect, useMemo, useState } from 'react';
import type { Config, OutputTransferGenerationIssue, OutputTransferSummary } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

interface Result {
    key: string;
    transfers: OutputTransferSummary[];
    generationIssues: OutputTransferGenerationIssue[];
    error: string | null;
}

const EMPTY_ISSUES: OutputTransferGenerationIssue[] = [];

/** A read-only worker query for output-route evidence and explicit generation refusals. */
export function useOutputTransfers(config: Config, enabled = true) {
    const key = useMemo(() => JSON.stringify(config), [config]);
    const [result, setResult] = useState<Result | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'output-transfers', config: JSON.parse(key) as Config }).then(
                answer => {
                    if (current) setResult({ key, transfers: answer.transfers, generationIssues: answer.generation_issues, error: null });
                },
                error => {
                    if (current) setResult({ key, transfers: [], generationIssues: [], error: error instanceof Error ? error.message : 'Could not check output routes.' });
                },
            );
        }, 180);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, key]);

    const current = result?.key === key ? result : null;
    return {
        transfers: current?.transfers ?? null,
        generationIssues: current?.generationIssues ?? EMPTY_ISSUES,
        error: current?.error ?? null,
        updating: current === null,
    };
}
