import { describe, it, expect, beforeAll } from 'vitest';
import { loadConfigFromFile } from './loader';
import { ConfigPaths } from './config-paths';
import { validateInserterCoverage } from './inserter-coverage-validator';
import { FactorioDataService } from '../data/factorio-data-service';

// Trigger auto-initialization from resources/data-filtered.json before any test runs
beforeAll(() => {
    FactorioDataService.findRecipeOrThrow('accumulator');
});

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
});
