import { describe, it, expect, vi } from 'vitest';
import { loadConfigFromFile } from './loader';
import { ConfigPaths } from './config-paths';
import { Config } from './schema';
import { validateInserterCoverage } from './inserter-coverage-validator';

describe('validateInserterCoverage', () => {
    describe('bad-accumulator-config', () => {
        it('reports exactly 2 issues', async () => {
            const config = await loadConfigFromFile(ConfigPaths.BAD_ACCUMULATOR_CONFIG);
            const issues = validateInserterCoverage(config);
            expect(issues).toHaveLength(2);
        });

        it('reports a missing input inserter for iron-plate on machine 1', async () => {
            const config = await loadConfigFromFile(ConfigPaths.BAD_ACCUMULATOR_CONFIG);
            const issues = validateInserterCoverage(config);
            const issue = issues.find(
                (i) =>
                    i.kind === 'missing_input_inserter' &&
                    i.machine_id === 1 &&
                    i.item_name === 'iron-plate',
            );
            expect(issue).toBeDefined();
            expect(issue?.recipe).toBe('accumulator');
        });

        it('reports a missing output inserter for accumulator on machine 1', async () => {
            const config = await loadConfigFromFile(ConfigPaths.BAD_ACCUMULATOR_CONFIG);
            const issues = validateInserterCoverage(config);
            const issue = issues.find(
                (i) =>
                    i.kind === 'missing_output_inserter' &&
                    i.machine_id === 1 &&
                    i.item_name === 'accumulator',
            );
            expect(issue).toBeDefined();
            expect(issue?.recipe).toBe('accumulator');
        });
    });

    describe('metallurgic-science-pack (machine-to-machine inserters)', () => {
        it('reports no issues when all inserters are valid machine-to-machine connections', async () => {
            const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
            const issues = validateInserterCoverage(config);
            expect(issues).toHaveLength(0);
        });
    });

    describe('burner fuel', () => {
        const biochamberConfig = (extraInserters: object[]) => ({
            target_output: { recipe: 'nutrients-from-yumako-mash', items_per_second: 1, copies: 1 },
            machines: [
                { id: 1, recipe: 'nutrients-from-yumako-mash', productivity: 0, crafting_speed: 2, type: 'biochamber' },
            ],
            inserters: [
                { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 2 },
                { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 2 },
                ...extraInserters,
            ],
            belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'yumako-mash', stack_size: 2 }] }],
            chests: [{ id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'nutrients', request_count: 100 }] }],
        }) as unknown as Config;

        it('reports a missing fuel inserter for a biochamber that is only fed its ingredients', () => {
            const issues = validateInserterCoverage(biochamberConfig([]));
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({ kind: 'missing_input_inserter', machine_id: 1, item_name: 'nutrients' });
        });

        it('accepts an inserter that carries the fuel', () => {
            const fuelInserter = { source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 2 };
            expect(validateInserterCoverage(biochamberConfig([fuelInserter]))).toHaveLength(0);
        });
    });
});

/**
 * The engine as a script loads it, with nothing of the game data read yet: in Node the data is read on first use, and
 * the coverage check reads it too, where before it skipped itself and the generation ran to its tick cap
 */
describe('a coverage check that comes before anything read the game data', () => {
    const quiet = { log() { }, warn() { }, error() { }, debug() { } };

    it('refuses a config missing an inserter in Node, before any simulation', async () => {
        vi.resetModules();
        await import('../data/factorio-data-file');
        const { FactorioDataService: data } = await import('../data/factorio-data-service');
        const { loadConfigFromFile: load } = await import('./loader');
        const { ConfigPaths: paths } = await import('./config-paths');
        const { generateClockAlternatives } = await import('../crafting/generate-blueprint');
        const config = await load(paths.BAD_ACCUMULATOR_CONFIG);
        expect(data.isInitialized()).toBe(false);
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow(
            "Missing inserter coverage (2 issues):\n  - Machine 1 (accumulator): missing input inserter for 'iron-plate'\n"
            + "  - Machine 1 (accumulator): missing output inserter for 'accumulator'");
    });

    it('is still skipped where the data has no source yet, as in the browser before it is fetched', async () => {
        vi.resetModules();
        const { FactorioDataService: data } = await import('../data/factorio-data-service');
        const { validateInserterCoverage: validate, createInserterCoverageValidator: live } = await import('./inserter-coverage-validator');
        const config = JSON.parse(JSON.stringify(await loadConfigFromFile(ConfigPaths.BAD_ACCUMULATOR_CONFIG))) as Config;
        expect(data.isAvailable()).toBe(false);
        expect(validate(config)).toEqual([]);
        expect(live()(config)).toEqual([]);
        expect(data.isInitialized()).toBe(false);
    });
});
