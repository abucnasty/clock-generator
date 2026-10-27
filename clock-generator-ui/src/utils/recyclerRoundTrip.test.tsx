import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, FactorioDataService, type Config } from 'clock-generator/browser';
import exact from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-exact-speed.json';
import overbeaconed from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-overbeaconed.json';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { removeChest, removeMachine, reorderChests, reorderMachines, updateMachine, updateTargetOutput, patchMachine } from './configForm/edits';
import { describeConfigEdit, removalMessage } from './undoSnapshot';
import { buildChangesOf } from './buildChanges';

FactorioDataService.initialize(JSON.parse(data));

// one recycler voiding iron ore: four infinity-chest inserters in, a car for its results, two inserters from the car back in
const config = ConfigSchema.parse(exact);

describe('a target that counts the item destroyed, and a recycler\'s result target', () => {
    it('are read from the sample as they are written', () => {
        const form = configToFormData(config);
        expect(form.target_output).toEqual({ recipe: 'iron-ore', items_per_second: 400, copies: 1, counts: 'destroyed' });
        expect(form.machines[0].result_target).toEqual({ type: 'chest', id: 1 });
        expect(form.chests.map(chest => [chest.id, chest.type])).toEqual([[1, 'car'], [2, 'infinity-chest']]);
    });

    it.each([['exact speed', exact], ['overbeaconed', overbeaconed]])('survive import, a saved build and export unchanged, the %s sample', (_name, sample) => {
        const parsed = ConfigSchema.parse(sample);
        const form = configToFormData(parsed);
        expect(formDataToConfig(form)).toEqual(parsed);
        expect(formDataToConfig(readSavedConfig(serializeConfig(form))!)).toEqual(parsed);
        expect(ConfigSchema.parse(formDataToConfig(form))).toEqual(parsed);
        expect(formDataToConfig(form).target_output.counts).toBe('destroyed');
        expect(formDataToConfig(form).machines[0].result_target).toEqual({ type: 'chest', id: 1 });
    });

    it('leave a config without them as it was: it counts the item made, and its machines have no result target', () => {
        const plain: Config = { target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, prototype: 'electric-furnace' }], belts: [], inserters: [], chests: [] };
        const form = configToFormData(plain);
        expect('counts' in form.target_output).toBe(false);
        expect('result_target' in form.machines[0]).toBe(false);
        expect(formDataToConfig(form)).toEqual(plain);
    });

    it('are edited as other fields are: Counts set, and cleared back to the default', () => {
        const form = configToFormData(config);
        const made = updateTargetOutput(form, 'counts', undefined);
        expect('counts' in made.target_output).toBe(false);
        expect(updateTargetOutput(made, 'counts', 'destroyed').target_output.counts).toBe('destroyed');
        const own = patchMachine(form, 0, { result_target: undefined });
        expect('result_target' in own.machines[0]).toBe(false);
        expect(patchMachine(own, 0, { result_target: { type: 'chest', id: 2 } }).machines[0].result_target).toEqual({ type: 'chest', id: 2 });
        expect(updateMachine(form, 0, 'crafting_speed', 20).machines[0].result_target).toEqual({ type: 'chest', id: 1 });
    });
});

describe('the container a machine puts its results into', () => {
    it('is unset, as a drill\'s target is, when the container is deleted, and kept when another is', () => {
        const form = configToFormData(config);
        expect(removeChest(form, 0).machines[0].result_target).toEqual({ type: 'chest', id: 0 });
        expect(removeChest(form, 1).machines[0].result_target).toEqual({ type: 'chest', id: 1 });
        expect(removeMachine(configToFormData({ ...config, machines: [...config.machines, { ...config.machines[0], id: 2, result_target: undefined }] }), 1)
            .machines[0].result_target).toEqual({ type: 'chest', id: 1 });
    });

    it('follows the container when the containers are put in another order', () => {
        const form = configToFormData(config);
        const moved = reorderChests(form, 0, 1);
        expect(moved.chests.map(chest => chest.type)).toEqual(['infinity-chest', 'car']);
        expect(moved.machines[0].result_target).toEqual({ type: 'chest', id: 2 });
    });

    it('is named in the message that says what deleting its container did', () => {
        const form = configToFormData(config);
        expect(removalMessage(form, 'chests', 0)).toBe('Deleted Car 1. Chest 2 is now 1. Inserters 1–2 have no Source now. Machine 1 has no Direct output target now.');
        expect(removalMessage(form, 'chests', 1)).toBe('Deleted Chest 2. Inserters 3–6 have no Source now.');
    });
});

describe('Counts in the messages of an edit and of the changes since the clocks were made', () => {
    const form = configToFormData(config);
    it('is named when it is the field that changed', () => {
        expect(describeConfigEdit(form, updateTargetOutput(form, 'counts', undefined)).message).toBe('Updated Counts.');
        expect(describeConfigEdit(form, updateTargetOutput(form, 'counts', undefined)).key).toBe('target:counts');
    });

    it('is listed with the words of its choices', () => {
        const made = formDataToConfig(updateTargetOutput(form, 'counts', undefined));
        expect(buildChangesOf(config, made)).toEqual(['Counts (Items destroyed → Items made)']);
        expect(buildChangesOf(made, config)).toEqual(['Counts (Items made → Items destroyed)']);
        expect(buildChangesOf(config, config)).toEqual([]);
    });

    it('lists a result target that changed as the machine', () => {
        const other = formDataToConfig(patchMachine(form, 0, { result_target: { type: 'chest', id: 2 } }));
        expect(buildChangesOf(config, other)).toEqual(['Machine 1']);
    });
});

describe('a recycler putting its results into another machine', () => {
    const direct = ConfigSchema.parse({...exact, machines: [
        {...exact.machines[0], recipe: 'processing-unit-recycling', result_target: {type: 'machine', id: 2}},
        {id: 2, recipe: 'supercapacitor', crafting_speed: 1, productivity: 50, prototype: 'electromagnetic-plant'},
    ]});
    it('round trips through editing, save, reload and export with the endpoint type intact', () => {
        const form = configToFormData(direct);
        expect(formDataToConfig(form)).toEqual(direct);
        expect(formDataToConfig(readSavedConfig(serializeConfig(form))!)).toEqual(direct);
        expect(ConfigSchema.parse(formDataToConfig(form))).toEqual(direct);
        expect(removeChest(form, 0).machines[0].result_target).toEqual({type: 'machine', id: 2});
        expect(reorderMachines(form, 0, 1).machines[1].result_target).toEqual({type: 'machine', id: 1});
        expect(removeMachine(form, 1).machines[0].result_target).toEqual({type: 'machine', id: 0});
    });
});
