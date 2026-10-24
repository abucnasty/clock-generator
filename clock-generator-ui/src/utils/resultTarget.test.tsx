import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigSchema, FactorioDataService } from 'clock-generator/browser';
import exact from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-exact-speed.json';
import { configToFormData } from './configForm/configMapping';
import { patchMachine, removeChest } from './configForm/edits';
import { machineChoicePatch, placesResults } from './machinePrototype';
import { RESULT_TARGET_TEXT, resultTargetName, resultTargetOptions } from './resultTarget';
import { ResultTargetField } from '../components/ResultTargetField';
import type { CraftingMachineData } from '../worker/types';

FactorioDataService.initialize(JSON.parse(data));

const factorioData = JSON.parse(data) as { crafting_machine: Record<string, CraftingMachineData['machines'][number]>; recipe: Record<string, { categories: string[] }> };
const craftingMachines: CraftingMachineData = {
    machines: Object.values(factorioData.crafting_machine),
    recipeCategories: Object.fromEntries(Object.entries(factorioData.recipe).map(([name, recipe]) => [name, recipe.categories])),
};

// one recycler voiding iron ore: four infinity-chest inserters in, a car for its results, two inserters from the car back in
const config = ConfigSchema.parse(exact);
const labels = { item: (id: string) => `<${id}>`, recipe: (id: string) => `[${id}]` };

describe('the machine a row is, and the container it puts its results into', () => {
    it('is a field of the machine the draft dialog saves, and a machine changed to one that places nothing loses it', () => {
        const form = configToFormData(config);
        expect(machineChoicePatch('assembling-machine-3', form.machines[0], craftingMachines)).toEqual({
            prototype: 'assembling-machine-3', _prototype_source: 'hand', result_target: undefined });
        expect(machineChoicePatch('recycler', form.machines[0], craftingMachines)).toEqual({ prototype: 'recycler', _prototype_source: 'hand' });
        expect(machineChoicePatch('assembling-machine-3', { }, craftingMachines)).toEqual({ prototype: 'assembling-machine-3', _prototype_source: 'hand' });
        const next = patchMachine(form, 0, machineChoicePatch('assembling-machine-3', form.machines[0], craftingMachines));
        expect('result_target' in next.machines[0]).toBe(false);
    });

    it('is told from the game data\'s vector_to_place_result, never from a name', () => {
        expect(placesResults({ prototype: 'recycler' }, craftingMachines)).toBe(true);
        for (const prototype of ['assembling-machine-3', 'electric-furnace', 'cryogenic-plant', 'no-such-machine', undefined]) {
            expect(placesResults({ prototype }, craftingMachines)).toBe(false);
        }
        // a machine of another name with the field places its results; the recycler without it does not
        const renamed: CraftingMachineData = { ...craftingMachines, machines: [{ name: 'voider', type: 'furnace', crafting_categories: ['recycling'], burner_fuel_categories: [], crafting_speed: 1, vector_to_place_result: [0, -2] },
            { name: 'recycler', type: 'furnace', crafting_categories: ['recycling'], burner_fuel_categories: [], crafting_speed: 1 }] };
        expect(placesResults({ prototype: 'voider' }, renamed)).toBe(true);
        expect(placesResults({ prototype: 'recycler' }, renamed)).toBe(false);
    });

    it('is carried by the data the page loads', () => {
        expect(craftingMachines.machines.filter(machine => machine.vector_to_place_result !== undefined).map(machine => machine.name)).toEqual(['recycler']);
    });
});


describe('the Results into picker', () => {
    const form = configToFormData(config);
    const build = { machines: form.machines, belts: form.belts, chests: form.chests, inserters: form.inserters, drills: [] };

    it('offers the build\'s containers with what they hold, and no machine or belt', () => {
        const options = resultTargetOptions(build, labels);
        expect(options.map(option => [option.type, option.id, option.icon])).toEqual([['chest', 1, 'car'], ['chest', 2, 'infinity-chest']]);
        expect(options[1]).toMatchObject({ label: 'Chest 2', sublabel: '<iron-ore>' });
    });

    it('names the car by what the recycler puts into it, as the engine counts the container\'s items', () => {
        const getRecipeInfo = (name: string) => name === config.machines[0].recipe ? { ingredients: ['iron-ore'], results: ['iron-ore'] } : null;
        const options = resultTargetOptions(build, labels, getRecipeInfo);
        expect(options[0]).toMatchObject({ label: 'Car 1', sublabel: '<iron-ore>', ingredientIcons: ['iron-ore'] });
        // a machine that puts its results elsewhere does not name this one
        const elsewhere = { ...build, machines: build.machines.map(machine => ({ ...machine, result_target: { type: 'chest' as const, id: 2 } })) };
        expect(resultTargetOptions(elsewhere, labels, getRecipeInfo)[0].sublabel).toBe('No items inferred');
    });

    it('is a select of its own, with the empty choice named Its own output', () => {
        const html = renderToStaticMarkup(<ResultTargetField machine={form.machines[0]} machineLabel="Machine 1" build={build} onChange={() => { }} />);
        expect(html).toContain('Results into');
        expect(html).toContain('aria-label="Results into, Machine 1"');
        expect(html).toContain('/icons/car.png');
        expect(html).not.toContain('aria-invalid="true"');
        expect(html).toContain('aria-label="About results into"');
        const none = renderToStaticMarkup(<ResultTargetField machine={{ id: 1 }} machineLabel="Machine 1" build={build} onChange={() => { }} />);
        expect(none).toContain('Its own output');
        expect(none).not.toContain('aria-invalid="true"');
    });

    it('is empty, and marked, once the container is deleted', () => {
        const unset = removeChest(form, 0);
        const html = renderToStaticMarkup(<ResultTargetField machine={unset.machines[0]} machineLabel="Machine 1"
            build={{ machines: unset.machines, belts: unset.belts, chests: unset.chests, inserters: unset.inserters, drills: [] }} onChange={() => { }} />);
        expect(html).toMatch(/aria-invalid="true"/);
        expect(html).not.toContain('Its own output');
    });

    it('says in the words it was given', () => {
        expect(RESULT_TARGET_TEXT.label).toBe('Results into');
        expect(RESULT_TARGET_TEXT.none).toBe('Its own output');
        expect(RESULT_TARGET_TEXT.helpLabel).toBe('About results into');
        expect(RESULT_TARGET_TEXT.help).toBe('A recycler puts its results straight into the container in front of its output side, if one stands there. '
            + 'Pick that container. With nothing there, the results stay in the recycler for inserters to take.');
        expect(resultTargetName('Machine 3')).toBe('Results into, Machine 3');
    });
});
