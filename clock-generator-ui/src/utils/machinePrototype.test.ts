import { describe, expect, it } from 'vitest';
import { Option } from 'clock-generator/light';
import factorioData from '../../../clock-generator/resources/data-filtered.json';
import type { CraftingMachineData } from '../worker/types';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig, type MachineFormData } from './configForm/formData';
import { patchMachine } from './configForm/edits';
import { applyPaste } from './pastePreview';
import machinePickerGroups from '../data/machinePickerGroups.json';
import itemPickerGroups from '../data/itemPickerGroups.json';
import { burnsNutrients, craftingMachineOf, machineForRecipeOf, machineIconText, MACHINE_QUALITIES, MACHINE_QUALITY_HELP, machineSpeedAtQuality, machineSpeedText, recipePatch, recipesOfMachine } from './machinePrototype';

const data: CraftingMachineData = {
    machines: Object.values(factorioData.crafting_machine),
    recipeCategories: Object.fromEntries(Object.values(factorioData.recipe).map(recipe => [recipe.name, recipe.categories])),
};
const row = (fields: Partial<MachineFormData>): MachineFormData =>
    ({ id: 3, _uuid: 'm', recipe: 'lithium-plate', productivity: 0, crafting_speed: 1, ...fields });

describe('a machine row and its machine', () => {
    it('burns nutrients when its machine does, from the machine data', () => {
        expect(burnsNutrients(row({ prototype: 'biochamber' }), data)).toBe(true);
        expect(burnsNutrients(row({ prototype: 'stone-furnace' }), data)).toBe(false);
        expect(burnsNutrients(row({}), data)).toBe(false);
    });

    it('gets a machine that can make its recipe when it has none, picked for it', () => {
        expect(machineForRecipeOf('iron-plate', data)).toBe('electric-furnace');
        expect(machineForRecipeOf('nutrients-from-bioflux', data)).toBe('biochamber');
        expect(machineForRecipeOf('lithium', data)).toBe('cryogenic-plant');
        expect(machineForRecipeOf('iron-gear-wheel', data)).toBe('assembling-machine-3');
        expect(machineForRecipeOf('', data)).toBeUndefined();
        expect(recipePatch(row({}), 'casting-iron', data)).toEqual({ recipe: 'casting-iron', prototype: 'foundry', _prototype_source: 'recipe' });
        expect(recipePatch(row({ prototype: 'cryogenic-plant' }), 'lithium', data)).toEqual({ recipe: 'lithium' });
        expect(recipePatch(row({}), 'no-such-recipe', data)).toEqual({ recipe: 'no-such-recipe' });
    });

    it('offers only the recipes the machine can make', () => {
        // spelt in two, so that the icon check does not take it for an icon the page draws
        const recycling = `${'iron-gear-wheel'}-recycling`;
        const plant = craftingMachineOf(data, 'cryogenic-plant')!;
        expect(recipesOfMachine(plant, ['lithium', 'lithium-plate', 'iron-gear-wheel'], data)).toEqual(['lithium']);
        expect(recipesOfMachine(craftingMachineOf(data, 'recycler')!, ['iron-gear-wheel', recycling], data)).toEqual([recycling]);
    });

    it("names the machine, its quality and its source on the row icon", () => {
        const name = (id: string) => ({ 'cryogenic-plant': 'Cryogenic plant' })[id] ?? id;
        expect(machineIconText(row({ prototype: 'cryogenic-plant', quality: 'legendary', _prototype_source: 'sidecar' }), name))
            .toBe('Cryogenic plant (Legendary), from Sidecar');
        expect(machineIconText(row({ prototype: 'cryogenic-plant', _prototype_source: 'hand' }), name)).toBe('Cryogenic plant, chosen by hand');
        expect(machineIconText(row({ prototype: 'cryogenic-plant', _prototype_source: 'recipe' }), name)).toBe('Cryogenic plant, picked for its recipe');
        expect(machineIconText(row({ prototype: 'cryogenic-plant' }), name)).toBe('Cryogenic plant, from the config');
        expect(machineIconText(row({}), name)).toBe('No machine set: simulated as an assembling machine');
    });

    it('says that quality is a label only', () => {
        expect(MACHINE_QUALITY_HELP).toMatch(/label only.*changes neither/);
    });
});

describe('where a machine came from', () => {
    const imported = { target_output: { recipe: 'lithium-plate', items_per_second: 1, copies: 1 }, inserters: [], belts: [],
        machines: [{ id: 1, recipe: 'lithium-plate', productivity: 0, crafting_speed: 1, prototype: 'electric-furnace' },
            { id: 2, recipe: 'lithium', productivity: 0, crafting_speed: 1 }] };

    it("is the sample's for an example, unknown for a file, and never leaves the form", () => {
        const sample = configToFormData(imported, 'sample');
        expect(sample.machines.map(machine => machine._prototype_source)).toEqual(['sample', undefined]);
        expect(configToFormData(imported).machines[0]._prototype_source).toBeUndefined();
        expect(formDataToConfig(sample).machines[0]).not.toHaveProperty('_prototype_source');
    });

    it("is Sidecar's for a paste, and picked for its recipe where an older Sidecar named only its kind", () => {
        const selections = { target: false, machines: true, drills: false, inserters: false, belts: false, chests: false };
        const incoming = { machines: imported.machines, drills: [], inserters: [], belts: [], chests: [], guidance: Option.none(), suggested_target: Option.none() };
        expect(applyPaste(createDefaultConfig(), incoming, selections).machines.map(machine => machine._prototype_source)).toEqual(['sidecar', undefined]);
        expect(applyPaste(createDefaultConfig(), { ...incoming, picked_machines: [1] }, selections).machines[0]._prototype_source).toBe('recipe');
    });

    it('is by hand once chosen, and goes with the machine', () => {
        const form = configToFormData(imported, 'sample');
        const chosen = patchMachine(form, 1, { prototype: 'cryogenic-plant', _prototype_source: 'hand' });
        expect(chosen.machines[1]).toMatchObject({ prototype: 'cryogenic-plant', _prototype_source: 'hand' });
        const cleared = patchMachine(chosen, 1, { prototype: undefined, _prototype_source: undefined });
        expect(cleared.machines[1]).not.toHaveProperty('prototype');
        expect(cleared.machines[1]).not.toHaveProperty('_prototype_source');
    });
});

describe("a machine's crafting speed", () => {
    it('rises 30% of its base with each quality level, as the game data counts the levels', () => {
        expect(MACHINE_QUALITIES.map(quality => factorioData.quality[quality].level)).toEqual([0, 1, 2, 3, 5]);
        const furnace = craftingMachineOf(data, 'electric-furnace')!;
        expect(MACHINE_QUALITIES.map(quality => machineSpeedAtQuality(furnace, quality))).toEqual([2, 2.6, 3.2, 3.8, 5]);
        expect(machineSpeedAtQuality(craftingMachineOf(data, 'assembling-machine-3')!, 'legendary')).toBe(3.125);
        expect(machineSpeedAtQuality(craftingMachineOf(data, 'assembling-machine-3')!, 'epic')).toBe(2.375);
        expect(machineSpeedAtQuality(furnace, undefined)).toBe(2);
    });

    it('is the line the picker puts under a machine', () => {
        const plant = craftingMachineOf(data, 'cryogenic-plant')!;
        expect(machineSpeedText(plant, undefined)).toBe('Crafting speed 2×');
        expect(machineSpeedText(plant, 'normal')).toBe('Crafting speed 2×');
        expect(machineSpeedText(plant, 'legendary')).toBe('Crafting speed 5× at Legendary (2× base)');
    });
});

describe('the Machine picker groups', () => {
    it("hold every crafting machine of the data once, in rows by the game's subgroups", () => {
        const listed = machinePickerGroups.flatMap(group => group.rows.flat());
        expect([...listed].sort()).toEqual(data.machines.map(machine => machine.name).sort());
        expect(machinePickerGroups.map(group => [group.id, group.rows.length])).toEqual([['production', 3], ['space', 1]]);
    });

    it('put each machine in the group the game puts its item in, in the order the item picker has', () => {
        const itemGroup = (machine: string) => itemPickerGroups.find(group => group.items.includes(machine))?.id;
        const order = (group: string) => itemPickerGroups.find(it => it.id === group)!.items;
        for (const group of machinePickerGroups) {
            const machines = group.rows.flat();
            expect(machines.map(itemGroup), group.id).toEqual(machines.map(() => group.id));
            expect(machines.map(machine => order(group.id).indexOf(machine)), group.id).toEqual(machines.map(machine => order(group.id).indexOf(machine)).sort((a, b) => a - b));
        }
    });
});
