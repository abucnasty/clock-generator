import { useEffect, useMemo, useRef, useState } from 'react';
import type { Config, InserterCoverageIssue } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

/** Only routes, carried items, recipes and fuel can change connection coverage. */
function coverageKey(config: Config): string {
    return JSON.stringify({
        machines: config.machines.map(({ id, recipe, type, fuel }) => [id, recipe, type, fuel]),
        belts: config.belts.map(({ id, lanes }) => [id, lanes.map(lane => lane.ingredient)]),
        chests: config.chests?.map(chest => [chest.id, chest.type, chest.type === 'buffer-chest' ? chest.item_filter : [chest.remove_unfiltered_items ?? false, ...chest.item_filter.map(filter => [filter.item_name, filter.request_count > 0])]]),
        inserters: config.inserters.map(({ id, source, sink, filters }) => [id, source.type, source.id, sink.type, sink.id, filters]),
        drills: config.drills?.configs.map(({ target, mined_item_name }) => [target.id, mined_item_name]),
    });
}

/** Check connections after edits settle; never display results belonging to different routes/settings. */
export function useInserterValidation(
    exportConfig: () => Config,
    isInitialized: boolean,
): InserterCoverageIssue[] | null {
    const config = useMemo(() => exportConfig(), [exportConfig]);
    const key = useMemo(() => coverageKey(config), [config]);
    const latestConfig = useRef(config);
    const [result, setResult] = useState<{ key: string; issues: InserterCoverageIssue[] } | null>(null);
    useEffect(() => { latestConfig.current = config; }, [config]);

    useEffect(() => {
        if (!isInitialized) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'inserter-coverage', config: latestConfig.current }).then(
                found => {
                    if (current) setResult(previous => previous?.key === key && JSON.stringify(previous.issues) === JSON.stringify(found) ? previous : { key, issues: found });
                },
                error => { if (current) console.error('Failed to validate inserter coverage:', error); },
            );
        }, 200);
        return () => { current = false; clearTimeout(timer); };
    }, [isInitialized, key]);

    return result?.key === key ? result.issues : null;
}
