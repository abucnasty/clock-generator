import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/config/loader';
import type { ParsedConfig } from '../../src/config/schema';

/**
 * The kept configs that still state a lane in the words it had before the infinite end and the words shared and per
 * copy: `"kind": "outlet"`, `"sharing": "shared_by_copies"` or `"one_per_copy"`. The schema refuses those words, and
 * these files stay as they were: the tests read them with each such lane in today's words, the same facts.
 */
const STATING_OLD_LANE_WORDS = new Set([
    path.resolve(__dirname, '../../src/crafting/fixtures/inserter-crafting-240-3-copies-ore-lines.json'),
    path.resolve(__dirname, '../../src/crafting/fixtures/agricultural-science-250-egg-biochambers-at-80.json'),
    path.resolve(__dirname, 'agricultural-science-250-bioflux-on-near-lane.json'),
    path.resolve(__dirname, 'military-science-120-coal-lane-per-copy.json'),
]);

const SHARING_IN_TODAYS_WORDS: Record<string, string> = { shared_by_copies: 'shared', one_per_copy: 'per_copy' };

type RawLane = { lane_end?: { kind?: string }; sharing?: string };

/** The config of a kept file with its lane ends and lane sharing in today's words */
function inTodaysWords(config: { belts?: { lanes?: RawLane[] }[] }): unknown {
    for (const lane of (config.belts ?? []).flatMap(belt => belt.lanes ?? [])) {
        if (lane.lane_end?.kind === 'outlet') lane.lane_end = { kind: 'infinite' };
        if (lane.sharing !== undefined && lane.sharing in SHARING_IN_TODAYS_WORDS) lane.sharing = SHARING_IN_TODAYS_WORDS[lane.sharing];
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
