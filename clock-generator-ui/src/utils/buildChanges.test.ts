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

type Edit = (config: ConfigFormData) => ConfigFormData;

/** The changes from the build `base` (by default `form()`) to the build `edit` makes of it */
const changes = (edit: Edit, base = form(), recipeLabel?: (id: string) => string) =>
    buildChangesOf(formDataToConfig(base), formDataToConfig(edit(base)), recipeLabel);

/** The same changes from `form()`, as the stale banner lists them */
const text = (edit: Edit) => buildChangesText(formDataToConfig(form()), formDataToConfig(edit(form())));

describe('buildChangesOf', () => {
    const toAutomation: Edit = (config) => edits.updateTargetOutput(config, 'recipe', 'automation-science-pack');

    // what it lists, the edit made to the build (`form()`, or the build given last), and the changes listed
    it.each<[string, Edit, string[], ConfigFormData?]>([
        ['is nothing for the same build', (config) => config, []],
        ['names the rate with its values', (config) => edits.updateTargetOutput(config, 'items_per_second', 200), ['Items per second (240 → 200)']],
        ['names the recipe', toAutomation, ['Recipe (logistic-science-pack → automation-science-pack)']],
        ['names the copies', (config) => edits.updateTargetOutput(config, 'copies', 2), ['Copies (1 → 2)']],
        ['counts the inserters when one was added', (config) => edits.addInserter(config), ['Inserters (3 → 4)']],
        ['names one edited inserter by its label', (config) => edits.updateInserter(config, 2, { stack_size: 12 }), ['Inserter 3']],
        ['names two edited inserters together',
            (config) => edits.updateInserter(edits.updateInserter(config, 0, { stack_size: 7 }), 2, { stack_size: 12 }), ['Inserters 1, 3']],
        ['names the belt answer', (config) => edits.updateOverrides(config, 'backed_up_belts', true), ['Input belts (moving → backed up)']],
        ['names the deeper-search switch', (config) => edits.updateOverrides(config, 'search_for_fewer_wake_ups', true), ['Search for fewer wake-ups (off → on)']],
        ['calls any other override "Advanced Overrides"', (config) => edits.updateOverrides(config, 'lcm', 120), ['Advanced Overrides']],
        ['names the drill whose productivity changed', (config) => edits.updateDrill(config, 0, { productivity: 30 }), ['Drill 1'], edits.addDrill(form())],
    ])('%s', (_, edit, expected, base) => {
        expect(changes(edit, base)).toEqual(expected);
    });

    it('names the recipe by its game name when given one', () => {
        const gameName = (id: string) => (id === 'automation-science-pack' ? 'Automation science pack' : 'Logistic science pack');
        expect(changes(toAutomation, form(), gameName)).toEqual(['Recipe (Logistic science pack → Automation science pack)']);
    });

    it('lists the changes in the form\'s order, the same each time', () => {
        const edit = (config: ConfigFormData) => edits.updateOverrides(
            edits.updateInserter(edits.updateTargetOutput(edits.addBelt(config), 'items_per_second', 200), 1, { stack_size: 3 }),
            'backed_up_belts',
            true,
        );
        const expected = ['Items per second (240 → 200)', 'Inserter 2', 'Belts (1 → 2)', 'Input belts (moving → backed up)'];
        expect(changes(edit)).toEqual(expected);
        expect(changes(edit)).toEqual(expected);
    });
});

describe('buildChangesText', () => {
    const five: Edit = (config) => edits.updateOverrides(
        edits.updateOverrides(
            edits.updateTargetOutput(edits.updateTargetOutput(edits.addInserter(config), 'items_per_second', 200), 'copies', 2),
            'lcm',
            120,
        ),
        'search_for_fewer_wake_ups',
        true,
    );

    // what it lists, the edit made to `form()`, and the lines listed
    it.each<[string, Edit, string[]]>([
        ['lists five changes as three, the last with "and 2 more"', five, ['Items per second (240 → 200)', 'Copies (1 → 2)', 'Inserters (3 → 4) and 2 more changes']],
        ['lists one change as it is', (config) => edits.updateTargetOutput(config, 'copies', 2), ['Copies (1 → 2)']],
        ['lists nothing for the same build', (config) => config, []],
    ])('%s', (_, edit, expected) => {
        expect(text(edit)).toEqual(expected);
    });
});
