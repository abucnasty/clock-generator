import { describe, expect, it } from 'vitest';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { configKeyOf, generatedForOf, isStale, staleResultsMessage } from './resultsStaleness';

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
        const generatedFor = generatedForOf(formDataToConfig(config));
        const key = keyOf(config);
        config = edits.updateTargetOutput(config, 'items_per_second', 200);
        config = edits.updateTargetOutput(config, 'recipe', 'automation-science-pack');
        expect(generatedFor).toEqual({ key, recipe: 'logistic-science-pack', itemsPerSecond: 240 });
        expect(keyOf(config)).not.toBe(key);
    });
});

describe('staleResultsMessage', () => {
    const message = (itemsPerSecond: number) => staleResultsMessage({ key: '', recipe: 'logistic-science-pack', itemsPerSecond });

    it('says what the clocks are for in the plan\'s sentence', () => {
        expect(message(240)).toBe('These clocks are for logistic-science-pack at 240/s. Your build has changed since. Generate again.');
    });

    it('prints the rate with at most two decimals', () => {
        expect(message(12.5)).toContain('at 12.5/s.');
        expect(message(0.333333)).toContain('at 0.33/s.');
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
