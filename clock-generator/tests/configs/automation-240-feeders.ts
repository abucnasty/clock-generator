import fs from 'node:fs';
import { ConfigPaths } from '../../src/config/config-paths';
import { parseConfig } from '../../src/config/loader';
import type { ParsedConfig } from '../../src/config/schema';

/** The infinity chest and the drop spot on belt 1 of each of the scaffold's feeders, upstream first on each lane */
const FEEDERS = [
    { chest: 1, lane: 2, position: 0 },
    { chest: 1, lane: 2, position: 1 },
    { chest: 2, lane: 1, position: 0 },
    { chest: 2, lane: 1, position: 1 },
] as const;

/**
 * AUTOMATION_SCIENCE_240 with the four feeders of its scaffold (automation-240.scaffold) stated as outside supply: a
 * legendary stack inserter (the defaults) with a hand of 16 from an infinity chest onto belt 1, two a lane on the first
 * two tiles of the row, copper on lane 2 and gears on lane 1. Their inserters come after the copy's own, so inserter 1
 * and inserter 2 keep their numbers.
 */
export async function automation240WithFeeders(): Promise<ParsedConfig> {
    const raw = JSON.parse(fs.readFileSync(ConfigPaths.AUTOMATION_SCIENCE_240, 'utf8'));
    raw.inserters = [...raw.inserters, ...FEEDERS.map(({ chest, lane, position }) => ({
        source: { type: 'chest', id: chest },
        sink: { type: 'belt', id: 1, drop: { lane, position } },
        stack_size: 16,
    }))];
    raw.chests = [...(raw.chests ?? []),
        { type: 'infinity-chest', id: 1, item_filter: [{ item_name: 'copper-plate', request_count: 100 }] },
        { type: 'infinity-chest', id: 2, item_filter: [{ item_name: 'iron-gear-wheel', request_count: 100 }] }];
    return parseConfig(JSON.stringify(raw));
}
