import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateClockAlternatives, generateClockForConfig, type BlueprintGenerationResult, type Config } from 'clock-generator';
import { ConfigPaths, isExpectedRefusal } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { GameNamesContext } from '../hooks/useGameNames';
import { installFactsOf, type ClockInstallFacts } from '../worker/installFacts';
import { firstLineOf, wiringRowKey } from '../utils/installSteps';
import { WiringList } from './InstallSteps';

const movesOf = () => ({ items: [], route: '' });
const render = (install: ClockInstallFacts) => renderToStaticMarkup(
    <GameNamesContext.Provider value={{ item: { car: 'Car', 'iron-ore': 'Iron ore', 'big-mining-drill': 'Big mining drill', 'iron-plate': 'Iron plate' }, recipe: { 'iron-plate': 'Iron plate' } }}>
        <WiringList install={install} movesOf={movesOf} />
    </GameNamesContext.Provider>,
);

describe('the wiring list\'s rows', () => {
    const drillLine = '[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)';
    const inserterLine = '[entity=car] → machine 1 [recipe=iron-plate] [item=iron-ore] (inserter 1)';
    const install: ClockInstallFacts = {
        book: false,
        wiring: [[1]],
        drills: [[1]],
        lines: { 'inserter:1': inserterLine, 'drill:1': drillLine },
    };

    it('shows each combinator\'s first line with its tags as the icons the game draws, drills included', () => {
        const html = render(install);
        expect(html.match(/data-wiring-line/g)).toHaveLength(2);
        for (const icon of ['car', 'iron-plate', 'iron-ore', 'big-mining-drill']) {
            expect(html).toContain(`src="/icons/${icon}.png"`);
        }
        expect(html).toContain('alt="Big mining drill"');
        expect(html).toContain('alt="Car"');
        expect(html).toContain('→ machine 1 ');
        expect(html).toContain('(drill 1)');
        expect(html).not.toMatch(/\[(entity|item|recipe)=/);
    });

    it('draws a quality as the game\'s pip on the icon', () => {
        const html = render({ ...install, wiring: [[1]], drills: [], lines: { 'inserter:1': '[entity=car,quality=legendary] → [item=iron-ore,quality=rare] (inserter 1)' } });
        expect(html).toContain('alt="Car (Legendary)"');
        expect(html).toContain('/images/inserter-preview/badge-legendary.png');
        expect(html).toContain('/images/inserter-preview/badge-rare.png');
        expect(html).not.toContain('quality=');
    });

    it('keeps the earlier rows for a clock whose combinators have no line', () => {
        const html = render({ ...install, lines: {} });
        expect(html).not.toContain('data-wiring-line');
        expect(html).toContain('Inserter 1');
        expect(html).toContain('Drill 1');
    });
});

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
