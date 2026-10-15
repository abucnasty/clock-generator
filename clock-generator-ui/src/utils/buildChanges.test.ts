import { describe, expect, it } from 'vitest';
import { formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { buildChangesOf, buildChangesText } from './buildChanges';

/** A build as the page holds it: a target, a machine, three inserters and a belt */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateTargetOutput(config, 'recipe', 'logistic-science-pack');
    config = edits.updateTargetOutput(config, 'items_per_second', 240);
    config = edits.updateMachine(config, 0, 'recipe', 'logistic-science-pack');
    config = edits.addInserter(edits.addInserter(edits.addInserter(config)));
    return edits.addBelt(config);
}

/** The changes from the build of `form()` to the build `edit` makes of it */
const changes = (edit: (config: ConfigFormData) => ConfigFormData) => buildChangesOf(formDataToConfig(form()), formDataToConfig(edit(form())));

describe('buildChangesOf', () => {
    it('is nothing for the same build', () => {
        expect(changes((config) => config)).toEqual([]);
    });

    it('names the rate with its values', () => {
        expect(changes((config) => edits.updateTargetOutput(config, 'items_per_second', 200))).toEqual(['Items per second (240 → 200)']);
    });

    it('names the recipe, by its game name when given one', () => {
        const generated = formDataToConfig(form());
        const current = formDataToConfig(edits.updateTargetOutput(form(), 'recipe', 'automation-science-pack'));
        expect(buildChangesOf(generated, current)).toEqual(['Recipe (logistic-science-pack → automation-science-pack)']);
        const label = (id: string) => (id === 'automation-science-pack' ? 'Automation science pack' : 'Logistic science pack');
        expect(buildChangesOf(generated, current, label)).toEqual(['Recipe (Logistic science pack → Automation science pack)']);
    });

    it('names the copies', () => {
        expect(changes((config) => edits.updateTargetOutput(config, 'copies', 2))).toEqual(['Copies (1 → 2)']);
    });

    it('counts the inserters when one was added', () => {
        expect(changes((config) => edits.addInserter(config))).toEqual(['Inserters (3 → 4)']);
    });

    it('names one edited inserter by its label', () => {
        expect(changes((config) => edits.updateInserter(config, 2, { stack_size: 12 }))).toEqual(['Inserter 3']);
    });

    it('names two edited inserters together', () => {
        expect(changes((config) => edits.updateInserter(edits.updateInserter(config, 0, { stack_size: 7 }), 2, { stack_size: 12 })))
            .toEqual(['Inserters 1, 3']);
    });

    it('names the belt answer', () => {
        expect(changes((config) => edits.updateOverrides(config, 'non_moving_belts', true))).toEqual(['Input belts (moving → standing still)']);
    });

    it('names the deeper-search switch', () => {
        expect(changes((config) => edits.updateOverrides(config, 'search_for_fewer_wake_ups', true))).toEqual(['Search for fewer wake-ups (off → on)']);
    });

    it('calls any other override "Advanced Overrides"', () => {
        expect(changes((config) => edits.updateOverrides(config, 'lcm', 120))).toEqual(['Advanced Overrides']);
    });

    it('names the mining productivity level', () => {
        const generated = edits.enableDrills(form());
        expect(buildChangesOf(formDataToConfig(generated), formDataToConfig(edits.updateDrillsConfig(generated, 'mining_productivity_level', 3))))
            .toEqual(['Mining productivity level (0 → 3)']);
    });

    it('lists the changes in the form\'s order, the same each time', () => {
        const edit = (config: ConfigFormData) => edits.updateOverrides(
            edits.updateInserter(edits.updateTargetOutput(edits.addBelt(config), 'items_per_second', 200), 1, { stack_size: 3 }),
            'non_moving_belts',
            true,
        );
        const expected = ['Items per second (240 → 200)', 'Inserter 2', 'Belts (1 → 2)', 'Input belts (moving → standing still)'];
        expect(changes(edit)).toEqual(expected);
        expect(changes(edit)).toEqual(expected);
    });
});

describe('buildChangesText', () => {
    const five = (config: ConfigFormData) => edits.updateOverrides(
        edits.updateOverrides(
            edits.updateTargetOutput(edits.updateTargetOutput(edits.addInserter(config), 'items_per_second', 200), 'copies', 2),
            'lcm',
            120,
        ),
        'search_for_fewer_wake_ups',
        true,
    );

    it('lists five changes as three, the last with "and 2 more"', () => {
        expect(buildChangesText(formDataToConfig(form()), formDataToConfig(five(form())))).toEqual([
            'Items per second (240 → 200)',
            'Copies (1 → 2)',
            'Inserters (3 → 4) and 2 more changes',
        ]);
    });

    it('lists three changes or fewer as they are', () => {
        const edit = (config: ConfigFormData) => edits.updateTargetOutput(config, 'copies', 2);
        expect(buildChangesText(formDataToConfig(form()), formDataToConfig(edit(form())))).toEqual(['Copies (1 → 2)']);
        expect(buildChangesText(formDataToConfig(form()), formDataToConfig(form()))).toEqual([]);
    });
});
