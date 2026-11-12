import * as fs from 'fs';
import { parseConfig } from '../../src/config/loader';
import type { ParsedConfig } from '../../src/config/schema';

/**
 * The text of a config file that a test reads: a sample, a config of tests/configs or a fixture config of the source.
 * The tests that read the configs kept for them read them through here.
 */
export function keptConfigText(file: string): string {
    return fs.readFileSync(file, 'utf8');
}

/** A config file that a test reads, parsed as the loader parses it (see keptConfigText) */
export function loadKeptConfig(file: string): Promise<ParsedConfig> {
    return parseConfig(keptConfigText(file));
}
