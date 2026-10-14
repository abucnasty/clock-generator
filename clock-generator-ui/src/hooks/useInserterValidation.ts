import { useEffect, useState } from 'react';
import type { Config, InserterCoverageIssue } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

/**
 * Reactively validates inserter coverage for the current config, in the engine's worker.
 *
 * Re-runs whenever `exportConfig` changes (i.e., whenever the form config
 * changes, since `exportConfig` is memoized with `config` as a dependency).
 * The issues found for the config before stay until those of the new one arrive.
 *
 * Returns null until the first config is checked, which waits for `isInitialized`.
 */
export function useInserterValidation(
    exportConfig: () => Config,
    isInitialized: boolean,
): InserterCoverageIssue[] | null {
    const [issues, setIssues] = useState<InserterCoverageIssue[] | null>(null);

    useEffect(() => {
        if (!isInitialized) {
            return;
        }
        let current = true;
        askEngine({ kind: 'inserter-coverage', config: exportConfig() }).then(
            (found) => {
                if (current) setIssues(found);
            },
            (error) => console.error('Failed to validate inserter coverage:', error),
        );
        return () => {
            current = false;
        };
    }, [isInitialized, exportConfig]);

    return issues;
}
