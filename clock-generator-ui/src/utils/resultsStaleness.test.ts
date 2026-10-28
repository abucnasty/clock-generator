import { describe, expect, it } from 'vitest';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { configKeyOf, generatedForOf, generatedForText, isStale, madeAtText, STALE_GENERATE_AGAIN, staleCopyMessage, staleResultsMessage, type GeneratedFor } from './resultsStaleness';

/** A build as the page holds it: a target, a machine, and two inserters that differ */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateTargetOutput(config, 'recipe', 'logistic-science-pack');
    config = edits.updateTargetOutput(config, 'items_per_second', 240);
    config = edits.updateMachine(config, 0, 'recipe', 'logistic-science-pack');
    config = edits.addInserter(edits.addInserter(config));
    return edits.updateInserter(config, 1, { stack_size: 12 });
}

const keyOf = (config: ConfigFormData) => configKeyOf(formDataToConfig(config));
/** What a Generate of the form keeps */
const generatedOf = (config: ConfigFormData) => generatedForOf(formDataToConfig(config));
type Edit = (config: ConfigFormData) => ConfigFormData;

describe('isStale', () => {
    it('is false when nothing is generated', () => {
        expect(isStale(null, keyOf(form()))).toBe(false);
        expect(isStale(null, '')).toBe(false);
    });

    it('is false for the same config in other objects', () => {
        const generated = form();
        const shown = structuredClone(generated);
        expect(shown).not.toBe(generated);
        expect(keyOf(shown)).toBe(keyOf(generated));
        expect(isStale(generatedOf(generated), keyOf(shown))).toBe(false);
    });

    it.each<[string, Edit]>([
        ['the target rate goes from 240 to 200', (config) => edits.updateTargetOutput(config, 'items_per_second', 200)],
        ['the recipe changes', (config) => edits.updateTargetOutput(config, 'recipe', 'automation-science-pack')],
        ['a machine is added', (config) => edits.addMachine(config)],
        ['the inserters are reordered', (config) => edits.reorderInserters(config, 0, 1)],
        ['an override changes', (config) => edits.updateOverrides(config, 'lcm', 120)],
    ])('is true once %s', (_, edit) => {
        expect(isStale(generatedOf(form()), keyOf(edit(form())))).toBe(true);
    });

    it.each<[string, Edit]>([
        ['an edit is put back', (config) => edits.updateTargetOutput(edits.updateTargetOutput(config, 'items_per_second', 200), 'items_per_second', 240)],
        ['a machine is added and removed again, since the form\'s own ids are not in the key', (config) => {
            const added = edits.addMachine(config);
            return edits.removeMachine(added, added.machines.length - 1);
        }],
    ])('is false again once %s', (_, edit) => {
        expect(isStale(generatedOf(form()), keyOf(edit(form())))).toBe(false);
    });
});

describe('generatedForOf', () => {
    it('keeps the recipe, rate and key of the config it was given, whatever the form does later', () => {
        let config = form();
        const generatedFor = generatedForOf(formDataToConfig(config), 1_000);
        const key = keyOf(config);
        config = edits.updateTargetOutput(config, 'items_per_second', 200);
        config = edits.updateTargetOutput(config, 'recipe', 'automation-science-pack');
        expect(generatedFor).toEqual({
            key,
            recipe: 'logistic-science-pack',
            itemsPerSecond: 240,
            beltQuestion: { ask: false, answer: 'moving' },
            generatedAt: 1_000,
        });
        expect(keyOf(config)).not.toBe(key);
    });

    it('is made now when not told when', () => {
        const before = Date.now();
        const { generatedAt } = generatedOf(form());
        expect(generatedAt).toBeGreaterThanOrEqual(before);
        expect(generatedAt).toBeLessThanOrEqual(Date.now());
    });
});

// 12 Oct 2026, 14:02 and 16:30 local time
const MADE = new Date(2026, 9, 12, 14, 2).getTime();
const LATER_THAT_DAY = new Date(2026, 9, 12, 16, 30).getTime();
const NEXT_DAY = new Date(2026, 9, 13, 9, 0).getTime();

/** Clocks made at 14:02 for 240 logistic science packs a second */
const madeFor = (fields: Partial<GeneratedFor> = {}): GeneratedFor =>
    ({ key: '', recipe: 'logistic-science-pack', itemsPerSecond: 240, beltQuestion: { ask: false, answer: 'moving' }, generatedAt: MADE, ...fields });

describe('madeAtText', () => {
    it.each([
        ['the time for clocks made today', LATER_THAT_DAY, 'made at 14:02'],
        ['the day for clocks made before today', NEXT_DAY, 'made on 12 Oct'],
    ])('says %s', (_, now, text) => {
        expect(madeAtText(MADE, now, 'en-GB')).toBe(text);
    });
});

describe('staleResultsMessage', () => {
    const options = { now: LATER_THAT_DAY, locale: 'en-GB' };
    const message = (itemsPerSecond: number, changes: string[] = []) => staleResultsMessage(madeFor({ itemsPerSecond }), changes, options);

    it.each<[string, string[], string]>([
        ['says what the clocks are for, when they were made, and that the build has changed', [], 'Your build has changed since.'],
        ['lists the one change since', ['Items per second (240 → 200)'], 'Since then you changed Items per second (240 → 200).'],
        ['joins two changes with and', ['Items per second (240 → 200)', 'Inserter 3'], 'Since then you changed Items per second (240 → 200) and Inserter 3.'],
        ['joins the last of three changes with and', ['Recipe', 'Copies (1 → 2)', 'Inserter 3'], 'Since then you changed Recipe, Copies (1 → 2) and Inserter 3.'],
        ['joins a list that ends in how many more changes with commas only', ['Recipe', 'Copies (1 → 2)', 'Inserter 3 and 2 more changes'],
            'Since then you changed Recipe, Copies (1 → 2), Inserter 3 and 2 more changes.'],
        ['joins a list that ends in one more change with commas only', ['Recipe', 'Copies (1 → 2)', 'Inserter 3 and 1 more change'],
            'Since then you changed Recipe, Copies (1 → 2), Inserter 3 and 1 more change.'],
    ])('%s', (_, changes, since) => {
        expect(message(240, changes)).toBe(`These clocks are for logistic-science-pack at 240/s, made at 14:02. ${since}`);
    });

    it('says the recipe by its game name when given a label function', () => {
        const label = (id: string) => (id === 'logistic-science-pack' ? 'Logistic science pack' : id);
        expect(staleResultsMessage(madeFor(), [], { ...options, recipeLabel: label })).toBe(
            'These clocks are for Logistic science pack at 240/s, made at 14:02. Your build has changed since.');
        expect(generatedForText(madeFor(), label)).toBe('Logistic science pack at 240/s');
    });

    it('prints the rate with at most two decimals', () => {
        expect(message(12.5)).toContain('at 12.5/s,');
        expect(message(0.333333)).toContain('at 0.33/s,');
    });

    it('has no "Generate again" sentence: the banner\'s button says it', () => {
        expect(message(240, ['Copies (1 → 2)'])).not.toContain(STALE_GENERATE_AGAIN);
    });
});

describe('staleCopyMessage', () => {
    it.each<[string, string[], number, string]>([
        ['lists the same changes as the banner', ['Items per second (240 → 200)'], NEXT_DAY, 'made on 12 Oct. Since then you changed Items per second (240 → 200), so'],
        ['says the build has changed when no change is listed', [], LATER_THAT_DAY, 'made at 14:02. Your build has changed since, so'],
    ])('%s', (_, changes, now, since) => {
        expect(staleCopyMessage(madeFor({ recipe: 'r' }), changes, { now, locale: 'en-GB' })).toBe(
            `This blueprint is for r at 240/s, ${since} this clock may not work in your build. Generate again to get a clock for the build you have now.`);
    });
});

describe('configKeyOf', () => {
    it.each<[string, Edit]>([
        ['for a form exported twice, so a build is not stale right after Generate', (config) => config],
        ['after the config goes back into a form and out again, as on Import', (config) => configToFormData(formDataToConfig(config))],
    ])('is the same %s', (_, again) => {
        const config = form();
        expect(keyOf(again(config))).toBe(keyOf(config));
    });
});

describe('fractional and metadata identity', () => {
    it('keeps omitted and explicit stack, type, quality and Copies distinct', () => {
        let original = edits.updateTargetOutput(form(), 'copies', 0.0625);
        original = edits.updateInserter(original, 0, { prototype: 'stack-inserter', quality: 'normal', stack_size: undefined });
        const generated = generatedOf(original);
        const variants = [
            edits.updateTargetOutput(original, 'copies', 0.5),
            edits.updateInserter(original, 0, { prototype: 'fast-inserter' }),
            edits.updateInserter(original, 0, { quality: 'legendary' }),
            edits.updateInserter(original, 0, { stack_size: 16 }),
        ];
        expect(new Set([keyOf(original), ...variants.map(keyOf)]).size).toBe(5);
        for (const variant of variants) expect(isStale(generated, keyOf(variant))).toBe(true);
        expect(keyOf(configToFormData(formDataToConfig(original)))).toBe(keyOf(original));
    });
});
