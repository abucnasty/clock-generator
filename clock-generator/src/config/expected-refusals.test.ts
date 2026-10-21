import { describe, it, expect } from 'vitest';
import { loadConfigFromFile } from './loader';
import { ConfigPaths, ExpectedRefusals, isExpectedRefusal } from './config-paths';
import { generateClockAlternatives } from '../crafting/generate-blueprint';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

describe('the samples that exist to be refused', () => {
    it.each(Object.entries(ExpectedRefusals))('%s fails with its error, as it is and with backed-up belts', async (key, refusal) => {
        expect(refusal.reason).not.toBe('');
        const config = await loadConfigFromFile(ConfigPaths[key as keyof typeof ConfigPaths]);
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow(refusal.error);
        const backed_up = { ...config, overrides: { ...config.overrides, backed_up_belts: true } };
        expect(() => generateClockAlternatives(backed_up, { logger: quiet })).toThrow(refusal.error);
    });

    it('are told apart from the samples to generate a clock from by their key', () => {
        expect(Object.keys(ConfigPaths).filter(isExpectedRefusal)).toEqual(['BAD_ACCUMULATOR_CONFIG', 'REAL_STUPIDFATHOBBIT_CELL02']);
    });
});
