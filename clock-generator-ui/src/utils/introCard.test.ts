import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './configForm/formData';
import { INTRO_STORAGE_KEY, isBlankBuild, readIntroDismissed, shouldShowIntro, writeIntroDismissed } from './introCard';

describe('isBlankBuild', () => {
    it('is true for the default build', () => {
        expect(isBlankBuild(createDefaultConfig())).toBe(true);
    });

    it('is false once a target recipe or a machine recipe is set', () => {
        const config = createDefaultConfig();
        expect(isBlankBuild({ ...config, target_output: { ...config.target_output, recipe: 'iron-gear-wheel' } })).toBe(false);
        expect(isBlankBuild({ ...config, machines: [{ ...config.machines[0], recipe: 'iron-gear-wheel' }] })).toBe(false);
    });

    it('is false with an inserter, a belt, a chest or drills', () => {
        const config = createDefaultConfig();
        const something = [{}] as never[];
        expect(isBlankBuild({ ...config, inserters: something })).toBe(false);
        expect(isBlankBuild({ ...config, belts: something })).toBe(false);
        expect(isBlankBuild({ ...config, chests: something })).toBe(false);
        expect(isBlankBuild({ ...config, drills: { mining_productivity_level: 0, configs: [] } })).toBe(false);
    });
});

describe('shouldShowIntro', () => {
    it('shows only when brought back, or on a blank build neither closed nor built by hand', () => {
        for (const dismissed of [false, true]) {
            for (const builtByHand of [false, true]) {
                for (const forced of [false, true]) {
                    for (const blank of [false, true]) {
                        expect(shouldShowIntro({ dismissed, builtByHand, forced, blank }), JSON.stringify({ dismissed, builtByHand, forced, blank }))
                            .toBe(forced || (!dismissed && !builtByHand && blank));
                    }
                }
            }
        }
    });
});

describe('readIntroDismissed and writeIntroDismissed', () => {
    const fakeStorage = () => {
        const items = new Map<string, string>();
        return {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, value); },
        };
    };
    const throwing = {
        getItem: (): string | null => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
    };

    it('reads a missing key as not closed, and a written one as closed', () => {
        const storage = fakeStorage();
        expect(readIntroDismissed(storage)).toBe(false);
        writeIntroDismissed(storage);
        expect(storage.getItem(INTRO_STORAGE_KEY)).not.toBeNull();
        expect(readIntroDismissed(storage)).toBe(true);
    });

    it('reads a storage that throws as not closed, and writes nothing to it without throwing', () => {
        expect(readIntroDismissed(throwing)).toBe(false);
        expect(() => writeIntroDismissed(throwing)).not.toThrow();
    });
});
