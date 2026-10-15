import { describe, expect, it } from 'vitest';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { configKeyOf, generatedForOf, generatedForText, isStale, madeAtText, staleCopyMessage, staleResultsMessage, type GeneratedFor } from './resultsStaleness';

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
        expect(isStale(generatedForOf(formDataToConfig(generated)), keyOf(shown))).toBe(false);
    });

    it.each<[string, (config: ConfigFormData) => ConfigFormData]>([
        ['the target rate goes from 240 to 200', (config) => edits.updateTargetOutput(config, 'items_per_second', 200)],
        ['the recipe changes', (config) => edits.updateTargetOutput(config, 'recipe', 'automation-science-pack')],
        ['a machine is added', (config) => edits.addMachine(config)],
        ['the inserters are reordered', (config) => edits.reorderInserters(config, 0, 1)],
        ['an override changes', (config) => edits.updateOverrides(config, 'lcm', 120)],
    ])('is true once %s', (_, edit) => {
        const generatedFor = generatedForOf(formDataToConfig(form()));
        expect(isStale(generatedFor, keyOf(edit(form())))).toBe(true);
    });

    it('is false again once an edit is put back', () => {
        const generated = form();
        const generatedFor = generatedForOf(formDataToConfig(generated));
        const edited = edits.updateTargetOutput(generated, 'items_per_second', 200);
        expect(isStale(generatedFor, keyOf(edited))).toBe(true);
        expect(isStale(generatedFor, keyOf(edits.updateTargetOutput(edited, 'items_per_second', 240)))).toBe(false);
    });

    it('is false after a machine is added and removed again, since the form\'s own ids are not in the key', () => {
        const generated = form();
        const generatedFor = generatedForOf(formDataToConfig(generated));
        const added = edits.addMachine(generated);
        const removed = edits.removeMachine(added, added.machines.length - 1);
        expect(isStale(generatedFor, keyOf(removed))).toBe(false);
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
        const { generatedAt } = generatedForOf(formDataToConfig(form()));
        expect(generatedAt).toBeGreaterThanOrEqual(before);
        expect(generatedAt).toBeLessThanOrEqual(Date.now());
    });
});

// 12 Oct 2026, 14:02 and 16:30 local time
const MADE = new Date(2026, 9, 12, 14, 2).getTime();
const LATER_THAT_DAY = new Date(2026, 9, 12, 16, 30).getTime();
const NEXT_DAY = new Date(2026, 9, 13, 9, 0).getTime();

describe('madeAtText', () => {
    it('says the time for clocks made today', () => {
        expect(madeAtText(MADE, LATER_THAT_DAY, 'en-GB')).toBe('made at 14:02');
    });

    it('says the day for clocks made before today', () => {
        expect(madeAtText(MADE, NEXT_DAY, 'en-GB')).toBe('made on 12 Oct');
    });
});

describe('staleResultsMessage', () => {
    const generatedFor = (itemsPerSecond: number): GeneratedFor => ({
        key: '',
        recipe: 'logistic-science-pack',
        itemsPerSecond,
        beltQuestion: { ask: false, answer: 'moving' },
        generatedAt: MADE,
    });
    const options = { now: LATER_THAT_DAY, locale: 'en-GB' };
    const message = (itemsPerSecond: number, changes: string[] = []) => staleResultsMessage(generatedFor(itemsPerSecond), changes, options);

    it('says what the clocks are for, when they were made, and that the build has changed', () => {
        expect(message(240)).toBe('These clocks are for logistic-science-pack at 240/s, made at 14:02. Your build has changed since.');
    });

    it('lists the changes since', () => {
        expect(message(240, ['Items per second (240 → 200)'])).toBe(
            'These clocks are for logistic-science-pack at 240/s, made at 14:02. Since then you changed Items per second (240 → 200).');
        expect(message(240, ['Items per second (240 → 200)', 'Inserter 3'])).toContain('you changed Items per second (240 → 200) and Inserter 3.');
        expect(message(240, ['Recipe', 'Copies (1 → 2)', 'Inserter 3'])).toContain('you changed Recipe, Copies (1 → 2) and Inserter 3.');
        expect(message(240, ['Recipe', 'Copies (1 → 2)', 'Inserter 3 and 2 more changes'])).toContain('you changed Recipe, Copies (1 → 2), Inserter 3 and 2 more changes.');
        expect(message(240, ['Recipe', 'Copies (1 → 2)', 'Inserter 3 and 1 more change'])).toContain('Inserter 3 and 1 more change.');
    });

    it('says the recipe by its game name when given a label function', () => {
        const label = (id: string) => (id === 'logistic-science-pack' ? 'Logistic science pack' : id);
        expect(staleResultsMessage(generatedFor(240), [], { ...options, recipeLabel: label })).toBe(
            'These clocks are for Logistic science pack at 240/s, made at 14:02. Your build has changed since.');
        expect(generatedForText(generatedFor(240), label)).toBe('Logistic science pack at 240/s');
    });

    it('prints the rate with at most two decimals', () => {
        expect(message(12.5)).toContain('at 12.5/s,');
        expect(message(0.333333)).toContain('at 0.33/s,');
    });

    it('has no "Generate again" sentence: the banner\'s button says it', () => {
        expect(message(240, ['Copies (1 → 2)'])).not.toContain('Generate again');
    });
});

describe('staleCopyMessage', () => {
    const generatedFor: GeneratedFor = { key: '', recipe: 'r', itemsPerSecond: 240, beltQuestion: { ask: false, answer: 'moving' }, generatedAt: MADE };

    it('lists the same changes as the banner', () => {
        expect(staleCopyMessage(generatedFor, ['Items per second (240 → 200)'], { now: NEXT_DAY, locale: 'en-GB' })).toBe(
            'This blueprint is for r at 240/s, made on 12 Oct. Since then you changed Items per second (240 → 200), so this clock may '
            + 'not work in your build. Generate again to get a clock for the build you have now.');
    });

    it('says the build has changed when no change is listed', () => {
        expect(staleCopyMessage(generatedFor, [], { now: LATER_THAT_DAY, locale: 'en-GB' })).toContain('made at 14:02. Your build has changed since, so this clock');
    });
});

describe('configKeyOf', () => {
    it('is the same for a form exported twice, so a build is not stale right after Generate', () => {
        const config = form();
        expect(configKeyOf(formDataToConfig(config))).toBe(configKeyOf(formDataToConfig(config)));
    });

    it('is the same after the config goes back into a form and out again, as on Import', () => {
        const key = configKeyOf(formDataToConfig(form()));
        expect(configKeyOf(formDataToConfig(configToFormData(formDataToConfig(form()))))).toBe(key);
    });
});
