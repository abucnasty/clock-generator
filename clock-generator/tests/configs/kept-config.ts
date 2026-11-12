import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/config/loader';
import type { ParsedConfig } from '../../src/config/schema';

/**
 * The kept configs that still state a lane end in the words it had before the infinite end (`"kind": "outlet"`). The
 * schema refuses those words, and these files stay as they were: the tests read them with each such lane end stated as
 * an infinite end, the same end.
 */
const STATING_OLD_LANE_WORDS = new Set([
    path.resolve(__dirname, '../../src/crafting/fixtures/inserter-crafting-240-3-copies-ore-lines.json'),
]);

type RawLane = { lane_end?: { kind?: string } };

/** The config of a kept file with its lane ends in today's words */
function inTodaysWords(config: { belts?: { lanes?: RawLane[] }[] }): unknown {
    for (const lane of (config.belts ?? []).flatMap(belt => belt.lanes ?? [])) {
        if (lane.lane_end?.kind === 'outlet') lane.lane_end = { kind: 'infinite' };
    }
    return config;
}

/**
 * The text of a config file that a test reads: a sample, a config of tests/configs or a fixture config of the source.
 * The tests that read the configs kept for them read them through here. A file of STATING_OLD_LANE_WORDS is given in
 * today's words; every other file is given as it is.
 */
export function keptConfigText(file: string): string {
    const text = fs.readFileSync(file, 'utf8');
    return STATING_OLD_LANE_WORDS.has(path.resolve(file)) ? JSON.stringify(inTodaysWords(JSON.parse(text))) : text;
}

/** A config file that a test reads, parsed as the loader parses it (see keptConfigText) */
export function loadKeptConfig(file: string): Promise<ParsedConfig> {
    return parseConfig(keptConfigText(file));
}
