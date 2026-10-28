// @vitest-environment happy-dom
import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService } from 'clock-generator/browser';
import exact from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-exact-speed.json';
import { show } from '../test/fixtures';
import { configToFormData } from './configForm/configMapping';
import { patchMachine, removeChest } from './configForm/edits';
import type { ConfigFormData, MachineFormData } from './configForm/formData';
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


describe('the direct output target picker', () => {
    const form = configToFormData(config);
    const buildOf = ({ machines, belts, chests, inserters }: ConfigFormData) => ({ machines, belts, chests, inserters, drills: [] });
    const build = buildOf(form);

    it('offers the build\'s machines and containers with what they hold', () => {
        const options = resultTargetOptions(build, labels);
        expect(options.map(option => [option.type, option.id, option.icon])).toEqual([['machine', 1, 'recycler'], ['chest', 1, 'car'], ['chest', 2, 'infinity-chest']]);
        expect(options[2]).toMatchObject({ label: 'Chest 2', sublabel: '<iron-ore>' });
    });

    it('names the car by what the recycler puts into it, as the engine counts the container\'s items', () => {
        const getRecipeInfo = (name: string) => name === config.machines[0].recipe ? { ingredients: ['iron-ore'], results: ['iron-ore'] } : null;
        const options = resultTargetOptions(build, labels, getRecipeInfo);
        expect(options[1]).toMatchObject({ label: 'Car 1', sublabel: '<iron-ore>', ingredientIcons: ['iron-ore'] });
        // a machine that puts its results elsewhere does not name this one
        const elsewhere = { ...build, machines: build.machines.map(machine => ({ ...machine, result_target: { type: 'chest' as const, id: 2 } })) };
        expect(resultTargetOptions(elsewhere, labels, getRecipeInfo)[1].sublabel).toBe('No items inferred');
    });

    const showField = (machine: Pick<MachineFormData, 'id' | 'result_target'>, of = build, onChange = vi.fn()) =>
        ({ ...show(<ResultTargetField machine={machine} machineLabel="Machine 1" build={of} onChange={onChange} />), onChange });
    const field = () => screen.getByRole('combobox', { name: resultTargetName('Machine 1') });

    it('is a select of its own, with an explicit no-receiver ground choice', async () => {
        const { user, onChange, unmount } = showField(form.machines[0]);
        expect(screen.getAllByText(RESULT_TARGET_TEXT.label)).not.toHaveLength(0);
        expect(within(field()).getByText('Car 1 - No items inferred')).toBeDefined();
        // the icons are drawn for the eye; the field says what they show
        expect(screen.queryAllByRole('presentation', { hidden: true }).map(picture => picture.getAttribute('src'))).toContain('/icons/car.png');
        expect(field().getAttribute('aria-invalid')).toBeNull();
        await user.click(field());
        // the machine itself is no target of its own
        expect(screen.queryByRole('option', { name: /^Machine 1/ })).toBeNull();
        await user.click(screen.getByRole('option', { name: RESULT_TARGET_TEXT.none }));
        expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
        await user.click(screen.getByRole('button', { name: RESULT_TARGET_TEXT.helpLabel }));
        expect(screen.getByRole('dialog', { name: RESULT_TARGET_TEXT.helpLabel }).textContent).toContain(RESULT_TARGET_TEXT.help);
        unmount();

        const none = showField({ id: 1 });
        expect(field().textContent).toBe(RESULT_TARGET_TEXT.none);
        expect(field().getAttribute('aria-invalid')).toBeNull();
        await none.user.click(field());
        await none.user.click(screen.getByRole('option', { name: /^Car 1/ }));
        expect(none.onChange).toHaveBeenCalledExactlyOnceWith({ type: 'chest', id: 1 });
    });

    it('is empty, and marked, once the container is deleted', () => {
        const unset = removeChest(form, 0);
        showField(unset.machines[0], buildOf(unset));
        expect(field().getAttribute('aria-invalid')).toBe('true');
        expect(field().textContent).not.toMatch(/\w/);
    });

    it('says in the words it was given', () => {
        expect(RESULT_TARGET_TEXT.label).toBe('Direct output target');
        expect(RESULT_TARGET_TEXT.none).toBe('No direct receiver (ground)');
        expect(RESULT_TARGET_TEXT.helpLabel).toBe('About direct output targets');
        expect(RESULT_TARGET_TEXT.help).toBe('Select the machine or container that aligns with the output arrow of the recycler. When selecting another machine, it will receive the results its recipe uses. Other results remain inside the recycler’s inventory and must be removed by inserters. Choose "No direct receiver (ground)" when no machine or container is at the output arrow.');
        expect(resultTargetName('Machine 3')).toBe('Direct output target, Machine 3');
    });
});
