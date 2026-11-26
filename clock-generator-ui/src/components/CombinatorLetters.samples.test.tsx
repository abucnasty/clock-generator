import { describe, expect, it } from 'vitest';
import { generateClockAlternatives, generateClockForConfig, type BlueprintGenerationResult, type Config } from 'clock-generator';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { installFactsOf } from '../worker/installFacts';
import { firstLineOf, wiringRowKey } from '../utils/installSteps';

// Generates the clock of every sample, which takes minutes: CI runs this file in a job of its own (`npm run test:samples`)
// and leaves it out of the others (`npm run test:fast`).
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
/** The clock the page selects. A build whose first plan runs to a window cycle too long to simulate is planned as the page plans it, in alternatives. */
function clockOf(config: Config): BlueprintGenerationResult {
    try {
        return generateClockForConfig(config, { logger: quiet });
    } catch (error) {
        if (!(error instanceof Error) || !/exceeds maximum allowed/.test(error.message)) throw error;
        const generated = generateClockAlternatives(config, { logger: quiet });
        return generated.alternatives[generated.selected_index].result;
    }
}

type Blueprint = BlueprintGenerationResult['blueprint'];
/** The first line of each combinator that switches inserters or drills on, by the entities its tags name: "inserter:5,14", "drill:2" */
function firstLinesOf(blueprint: Blueprint): Map<string, string> {
    const lines = new Map<string, string>();
    for (const entity of blueprint.entities) {
        const tags = entity.tags?.clock_generator;
        for (const [kind, ids] of [['inserter', tags?.inserters], ['drill', tags?.drills]] as const) {
            if (ids !== undefined && ids.length > 0) lines.set(wiringRowKey(kind, ids), firstLineOf(entity.player_description ?? ''));
        }
    }
    return lines;
}
/** "(E)" or "(AA)" at the end of a first line */
const letterOfLine = (line: string | undefined): string | undefined => /\(([A-Z]+)\)$/.exec(line ?? '')?.[1];

const samples = Object.entries(ConfigPaths);

// The letter a user matches in the game is the letter the page shows: the page's rows get it from the generator's rule, run on
// rows the page derives apart from the generator's own groups (`installFactsOf`); this holds the two equal on every sample
describe('the letters of the wiring list of every sample', () => {
    const noLine: string[] = [];
    const books: string[] = [];

    it.each(samples)('%s: the page\'s letter of each row is the letter its combinator\'s first line ends in', async (key, file) => {
        const result = clockOf(await loadConfigFromFile(file));
        const install = installFactsOf(result);
        const lines = firstLinesOf(result.blueprint);
        const rows = [...install.wiring.map(ids => wiringRowKey('inserter', ids)), ...install.drills.map(ids => wiringRowKey('drill', ids))];

        // every scheduled inserter is in exactly one row, and no combinator is in both an inserter row and a drill row
        const scheduled = result.schedule.inserter_combinators.flatMap(combinator => combinator.inserter_ids);
        const inserterIds = install.wiring.flat();
        expect(new Set(inserterIds).size, `${key}: an inserter in two rows`).toBe(inserterIds.length);
        expect([...inserterIds].sort((a, b) => a - b), key).toEqual([...scheduled].sort((a, b) => a - b));
        const entityKeys = result.blueprint.entities.flatMap(entity => {
            const tags = entity.tags?.clock_generator;
            return [...(tags?.inserters?.length ? ['inserter'] : []), ...(tags?.drills?.length ? ['drill'] : [])].map(kind => `${entity.entity_number}:${kind}`);
        });
        expect(new Set(entityKeys.map(it => it.split(':')[0])).size, `${key}: a combinator that switches inserters and drills on`).toBe(entityKeys.length);

        for (const row of rows) {
            if (!lines.has(row) || lines.get(row) === '') {
                // an untagged decider: the page gives its row no letter
                noLine.push(`${key} ${row}`);
                expect(install.letters?.[row], `${key} ${row}`).toBeUndefined();
                continue;
            }
            expect(install.letters?.[row]?.letter, `${key} ${row}: ${lines.get(row)}`).toBe(letterOfLine(lines.get(row)));
            expect(letterOfLine(lines.get(row)), `${key} ${row}: ${lines.get(row)}`).toBeDefined();
        }

        // the book's modulo blueprint says the same letter of the same row
        if (result.modulo_blueprint !== undefined) {
            books.push(key);
            const moduloLines = firstLinesOf(result.modulo_blueprint);
            for (const row of rows) {
                if (lines.has(row)) expect(letterOfLine(moduloLines.get(row)), `${key} ${row} in the modulo blueprint`).toBe(install.letters?.[row]?.letter);
            }
        }
    }, 300_000);

    it('lists the rows without a first line, and the samples whose selected clock is a book', () => {
        // a fresh clock leaves no row without a line; naming them is what a change of the generator would show
        expect(noLine).toEqual([]);
        expect(books.length).toBeGreaterThan(0);
    });
});
