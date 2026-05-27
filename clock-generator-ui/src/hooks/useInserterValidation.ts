import { useEffect, useState } from 'react';
import type { Config, InserterCoverageIssue } from 'clock-generator/browser';
import { validateInserterCoverage } from 'clock-generator/browser';

/**
 * Reactively validates inserter coverage for the current config.
 *
 * Re-runs whenever `exportConfig` changes (i.e., whenever the form config
 * changes, since `exportConfig` is memoized with `config` as a dependency).
 *
 * Returns an empty array until `isInitialized` is true (FactorioDataService
 * must be loaded before recipes can be looked up).
 */
export function useInserterValidation(
    exportConfig: () => Config,
    isInitialized: boolean,
): InserterCoverageIssue[] {
    const [issues, setIssues] = useState<InserterCoverageIssue[]>([]);

    useEffect(() => {
        if (!isInitialized) {
            setIssues([]);
            return;
        }
        setIssues(validateInserterCoverage(exportConfig()));
    }, [isInitialized, exportConfig]);

    return issues;
}
