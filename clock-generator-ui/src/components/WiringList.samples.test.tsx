import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateClockAlternatives, generateClockForConfig, type BlueprintGenerationResult, type Config } from 'clock-generator';
import { ConfigPaths, isExpectedRefusal } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { GameNamesContext } from '../hooks/useGameNames';
import { installFactsOf, type ClockInstallFacts } from '../worker/installFacts';
import { firstLineOf, wiringRowKey } from '../utils/installSteps';
import { WiringList } from './InstallSteps';

// Generates the clock of every sample, which takes minutes (the original pink science sample alone about a minute): CI runs
// this file in a job of its own (`npm run test:samples`) and leaves it out of the others (`npm run test:fast`).
const movesOf = () => ({ items: [], route: '' });
const render = (install: ClockInstallFacts) => renderToStaticMarkup(
    <GameNamesContext.Provider value={{ item: { car: 'Car', 'iron-ore': 'Iron ore', 'big-mining-drill': 'Big mining drill', 'iron-plate': 'Iron plate' }, recipe: { 'iron-plate': 'Iron plate' } }}>
        <WiringList install={install} movesOf={movesOf} />
    </GameNamesContext.Provider>,
);

// every sample's clock, made as the page makes it: each combinator that switches an inserter or a drill on is a row of
// the wiring list with the first line of its description
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
/** The clock the page selects. A build whose first plan runs to a period too long to simulate is planned as the page plans it, in alternatives. */
function clockOf(config: Config): BlueprintGenerationResult {
    try {
        return generateClockForConfig(config, { logger: quiet });
    } catch (error) {
        if (!(error instanceof Error) || !/exceeds maximum allowed/.test(error.message)) throw error;
        const generated = generateClockAlternatives(config, { logger: quiet });
        return generated.alternatives[generated.selected_index].result;
    }
}
const samples = Object.entries(ConfigPaths).filter(([key]) => !isExpectedRefusal(key));

describe('the wiring list of every sample', () => {
    it.each(samples)('%s: every combinator has its line', async (_key, file) => {
        const result = clockOf(await loadConfigFromFile(file));
        const install = installFactsOf(result);
        const combinators = result.blueprint.entities.flatMap(entity => {
            const tags = entity.tags?.clock_generator;
            return [
                ...(tags?.inserters?.length ? [{ key: wiringRowKey('inserter', tags.inserters), description: entity.player_description }] : []),
                ...(tags?.drills?.length ? [{ key: wiringRowKey('drill', tags.drills), description: entity.player_description }] : []),
            ];
        });
        for (const { key, description } of combinators) {
            expect(description, key).toBeTruthy();
            expect(install.lines[key], key).toBe(firstLineOf(description!));
        }
        expect(Object.keys(install.lines).sort()).toEqual(combinators.map(it => it.key).sort());
        // the schedule and the tags name the same rows
        expect(install.wiring.length + install.drills.length).toBe(combinators.length);
        const html = render(install);
        expect(html.match(/data-wiring-line/g) ?? []).toHaveLength(combinators.length);
        expect(html).not.toMatch(/\[(entity|item|recipe|fluid|quality)=/);
    }, 120_000);
});
