import { useEffect, useMemo, useRef, useState } from 'react';
import type { Config } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';
import type { LiveCoverage } from '../worker/types';

/** Only routes, carried items, recipes and fuel can change connection coverage; an inserter's kind and filter mode can put it out of scope. */
function coverageKey(config: Config): string {
    return JSON.stringify({
        machines: config.machines.map(({ id, recipe, type, fuel }) => [id, recipe, type, fuel]),
        belts: config.belts.map(({ id, lanes }) => [id, lanes.map(lane => lane.ingredient)]),
        chests: config.chests?.map(chest => [chest.id, chest.type, chest.type === 'buffer-chest' ? chest.item_filter : [chest.remove_unfiltered_items ?? false, ...chest.item_filter.map(filter => [filter.item_name, filter.request_count > 0])]]),
        inserters: config.inserters.map(({ id, source, sink, filters, filter_mode, prototype, quality }) =>
            [id, source.type, source.id, sink.type, sink.id, filters, filter_mode, prototype, quality,
                source.type === 'belt' && source.pickup_capture?.status === 'unsupported' ? source.pickup_capture.reason : null]),
        drills: config.drills?.configs.map(({ target, mined_item_name }) => [target.id, mined_item_name]),
    });
}

/** Check connections after edits settle; never display results belonging to different routes/settings. */
export function useInserterValidation(
    config: Config,
    isInitialized: boolean,
): LiveCoverage | null {
    const key = useMemo(() => coverageKey(config), [config]);
    const latestConfig = useRef(config);
    const [result, setResult] = useState<{ key: string; coverage: LiveCoverage } | null>(null);
    useEffect(() => { latestConfig.current = config; }, [config]);

    useEffect(() => {
        if (!isInitialized) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'inserter-coverage', config: latestConfig.current }).then(
                found => {
                    if (current) setResult(previous => previous?.key === key && JSON.stringify(previous.coverage) === JSON.stringify(found) ? previous : { key, coverage: found });
                },
                error => { if (current) console.error('Failed to validate inserter coverage:', error); },
            );
        }, 200);
        return () => { current = false; clearTimeout(timer); };
    }, [isInitialized, key]);

    return result?.key === key ? result.coverage : null;
}
