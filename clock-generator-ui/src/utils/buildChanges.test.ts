import { describe, expect, it } from 'vitest';
import { formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { buildChangesOf, buildChangesText } from './buildChanges';

/** A build as the page holds it: a target, a machine, three inserters and a belt */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateSetpoint(config, 'recipe', 'logistic-science-pack');
    config = edits.updateSetpoint(config, 'items_per_second', 240);
    config = edits.updateMachine(config, 0, 'recipe', 'logistic-science-pack');
    config = edits.addInserter(edits.addInserter(edits.addInserter(config)));
    return edits.addBelt(config);
}

type Edit = (config: ConfigFormData) => ConfigFormData;

type Lanes = ConfigFormData['belts'][number]['lanes'];
/** A build of `form()` whose belt carries iron gear wheels on one lane and iron plates on the other */
const twoLanes: Edit = (config) => edits.updateBelt(config, 0, { lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] as Lanes });
/** The edit that states `kind` as the end of lane `lane` of belt `belt` (undefined: states none) */
const endOf = (belt: number, lane: number, kind?: 'dead_end' | 'infinite'): Edit => (config) => edits.updateBelt(config, belt, {
    lanes: config.belts[belt].lanes.map((it, index) => index !== lane ? it
        : kind === undefined ? { ingredient: it.ingredient, stack_size: it.stack_size } : { ...it, lane_end: { kind } }) as Lanes });
const gameItems = (id: string) => ({ 'iron-gear-wheel': 'Iron gear wheel', 'iron-plate': 'Iron plate' }[id] ?? id);

/** The changes from the build `base` (by default `form()`) to the build `edit` makes of it */
const changes = (edit: Edit, base = form(), recipeLabel?: (id: string) => string, itemLabel?: (id: string) => string) =>
    buildChangesOf(formDataToConfig(base), formDataToConfig(edit(base)), recipeLabel, itemLabel);

/** The same changes from `form()`, as the stale banner lists them */
const text = (edit: Edit) => buildChangesText(formDataToConfig(form()), formDataToConfig(edit(form())));

describe('buildChangesOf', () => {
    const toAutomation: Edit = (config) => edits.updateSetpoint(config, 'recipe', 'automation-science-pack');

    // what it lists, the edit made to the build (`form()`, or the build given last), and the changes listed
    it.each<[string, Edit, string[], ConfigFormData?]>([
        ['is nothing for the same build', (config) => config, []],
        ['names the rate with its values', (config) => edits.updateSetpoint(config, 'items_per_second', 200), ['Items per second (240 → 200)']],
        ['names the recipe', toAutomation, ['Recipe (logistic-science-pack → automation-science-pack)']],
        ['names the copies', (config) => edits.updateSetpoint(config, 'copies', 2), ['Copies (1 → 2)']],
        ['counts the inserters when one was added', (config) => edits.addInserter(config), ['Inserters (3 → 4)']],
        ['names one edited inserter by its label', (config) => edits.updateInserter(config, 2, { stack_size: 12 }), ['Inserter 3']],
        ['names two edited inserters together',
            (config) => edits.updateInserter(edits.updateInserter(config, 0, { stack_size: 7 }), 2, { stack_size: 12 }), ['Inserters 1, 3']],
        ['calls the former belt setting an override like any other', (config) => edits.updateOverrides(config, 'backed_up_belts', false), ['Advanced Overrides']],
        ['names the deeper-search switch', (config) => edits.updateOverrides(config, 'search_for_fewer_wake_ups', true), ['Search for fewer wakeups (off → on)']],
        ['calls any other override "Advanced Overrides"', (config) => edits.updateOverrides(config, 'lcm', 120), ['Advanced Overrides']],
        ['names the drill whose productivity changed', (config) => edits.updateDrill(config, 0, { productivity: 30 }), ['Drill 1'], edits.addDrill(form())],
    ])('%s', (_, edit, expected, base) => {
        expect(changes(edit, base)).toEqual(expected);
    });

    it.each<[string, Edit, ConfigFormData, string[]]>([
        ['names a lane end stated where none was, by the lane\'s item, and not the belt again', endOf(0, 0, 'infinite'), twoLanes(form()),
            ['Lane end of the iron gear wheel lane (not stated → Infinite)']],
        ['names a lane end that changed', endOf(0, 1, 'infinite'), endOf(0, 1, 'dead_end')(twoLanes(form())),
            ['Lane end of the iron plate lane (Dead end → Infinite)']],
        ['names a lane end taken back', endOf(0, 1), endOf(0, 1, 'dead_end')(twoLanes(form())),
            ['Lane end of the iron plate lane (Dead end → not stated)']],
        ['names the belt as well where something else of it changed', (config) => endOf(0, 0, 'dead_end')(edits.updateBelt(config, 0, { type: 'fast-transport-belt' })),
            twoLanes(form()), ['Belt 1', 'Lane end of the iron gear wheel lane (not stated → Dead end)']],
        ['names the belt of a lane whose item is on another lane too', endOf(1, 0, 'dead_end'),
            edits.updateBelt(edits.addBelt(twoLanes(form())), 1, { lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] as Lanes }),
            ['Lane end of the iron plate lane of Belt 2 (not stated → Dead end)']],
    ])('%s', (_, edit, base, expected) => {
        expect(changes(edit, base, undefined, gameItems)).toEqual(expected);
    });

    it('names the recipe by its game name when given one', () => {
        const gameName = (id: string) => (id === 'automation-science-pack' ? 'Automation science pack' : 'Logistic science pack');
        expect(changes(toAutomation, form(), gameName)).toEqual(['Recipe (logistic science pack → automation science pack)']);
    });

    it('lists the changes in the form\'s order, the same each time', () => {
        const edit = (config: ConfigFormData) => edits.updateOverrides(
            edits.updateInserter(edits.updateSetpoint(edits.addBelt(config), 'items_per_second', 200), 1, { stack_size: 3 }),
            'lcm',
            120,
        );
        const expected = ['Items per second (240 → 200)', 'Inserter 2', 'Belts (1 → 2)', 'Advanced Overrides'];
        expect(changes(edit)).toEqual(expected);
        expect(changes(edit)).toEqual(expected);
    });
});

describe('buildChangesText', () => {
    const five: Edit = (config) => edits.updateOverrides(
        edits.updateOverrides(
            edits.updateSetpoint(edits.updateSetpoint(edits.addInserter(config), 'items_per_second', 200), 'copies', 2),
            'lcm',
            120,
        ),
        'search_for_fewer_wake_ups',
        true,
    );

    // what it lists, the edit made to `form()`, and the lines listed
    it.each<[string, Edit, string[]]>([
        ['lists five changes as three, the last with "and 2 more"', five, ['Items per second (240 → 200)', 'Copies (1 → 2)', 'Inserters (3 → 4) and 2 more changes']],
        ['lists one change as it is', (config) => edits.updateSetpoint(config, 'copies', 2), ['Copies (1 → 2)']],
        ['lists nothing for the same build', (config) => config, []],
    ])('%s', (_, edit, expected) => {
        expect(text(edit)).toEqual(expected);
    });
});
