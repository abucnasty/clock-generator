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
import { burnsNutrients, craftingMachineOf, craftingSpeedHint, machineForRecipeOf, machineIconText, MACHINE_QUALITIES, MACHINE_QUALITY_HELP, machineSpeedAtQuality, machineSpeedText, recipeNotMadeText, recipePatch, recipesOfMachine } from './machinePrototype';

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

const name = (id: string) => id.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase());

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

    it('is hinted under the field as the machine alone, with modules and beacons said to change it', () => {
        expect(craftingSpeedHint(row({ prototype: 'electric-furnace' }), data, name))
            .toBe('Electric furnace: 2× before modules and beacons, which change it. The clock uses the speed in this field.');
        expect(craftingSpeedHint(row({ prototype: 'electric-furnace', quality: 'legendary' }), data, name))
            .toBe('Electric furnace (Legendary): 5× before modules and beacons, which change it. The clock uses the speed in this field.');
        expect(craftingSpeedHint(row({ prototype: 'assembling-machine-3', quality: 'rare' }), data, name)).toMatch(/^Assembling machine 3 \(Rare\): 2× before/);
        // no machine, or one the data does not hold (a mod's): no number to give
        for (const prototype of [undefined, 'modded-machine']) {
            expect(craftingSpeedHint(row({ prototype }), data, name))
                .toBe("Modules, beacons and the machine's quality change a machine's speed. The clock uses the speed in this field.");
        }
    });
});

describe('a recipe the row\'s machine cannot make', () => {
    const recipeName = (id: string) => id.replace(/-/g, ' ');
    it('is said on the row in the words of the game, with the machines that can', () => {
        expect(recipeNotMadeText(row({ prototype: 'assembling-machine-1', recipe: 'lithium' }), data, name, recipeName))
            .toBe("Assembling machine 1 can't craft lithium. Machines that can: Chemical plant, Cryogenic plant.");
        expect(recipeNotMadeText(row({ prototype: 'cryogenic-plant', recipe: 'iron-gear-wheel' }), data, name, recipeName))
            .toMatch(/^Cryogenic plant can't craft iron gear wheel\. Machines that can: Assembling machine 1, /);
    });

    it('is not said when the machine can, or when the machine or the recipe is not in the data', () => {
        expect(recipeNotMadeText(row({ prototype: 'cryogenic-plant', recipe: 'lithium' }), data, name, recipeName)).toBeUndefined();
        expect(recipeNotMadeText(row({ recipe: 'lithium' }), data, name, recipeName)).toBeUndefined();
        expect(recipeNotMadeText(row({ prototype: 'modded-machine', recipe: 'lithium' }), data, name, recipeName)).toBeUndefined();
        expect(recipeNotMadeText(row({ prototype: 'cryogenic-plant', recipe: 'modded-recipe' }), data, name, recipeName)).toBeUndefined();
        expect(recipeNotMadeText(row({ prototype: 'cryogenic-plant', recipe: '' }), data, name, recipeName)).toBeUndefined();
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

describe('the speed hint on the samples', () => {
    const samples = import.meta.glob('../../../clock-generator/resources/config-samples/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
    const rows = Object.entries(samples).flatMap(([file, text]) => {
        const config = JSON.parse(text) as { machines?: { id: number; prototype?: string; quality?: MachineFormData['quality']; crafting_speed: number }[] };
        return (config.machines ?? []).filter(machine => machine.prototype !== undefined).map(machine => ({ file, ...machine }));
    });

    it('names a machine of the data in every row that has one, and gives its speed alone at the quality', () => {
        expect(rows.length).toBeGreaterThan(100);
        for (const sample of rows) {
            const machine = craftingMachineOf(data, sample.prototype)!;
            expect(machine, `${sample.file} machine ${sample.id}`).toBeDefined();
            const alone = machineSpeedAtQuality(machine, sample.quality);
            expect(craftingSpeedHint(sample, data, name), `${sample.file} machine ${sample.id}`).toContain(`: ${alone}× before modules and beacons`);
            // what Sidecar exports counts modules and beacons on top of the machine: never below it in the samples
            expect(sample.crafting_speed, `${sample.file} machine ${sample.id}`).toBeGreaterThanOrEqual(alone);
        }
    });

    it('is the whole speed where a row has no modules or beacons', () => {
        const bare = rows.filter(sample => sample.crafting_speed === machineSpeedAtQuality(craftingMachineOf(data, sample.prototype)!, sample.quality));
        expect(bare.length).toBeGreaterThan(0);
    });

    it('never makes a sample row a machine that cannot make its recipe (the samples are builds that work)', () => {
        for (const [file, text] of Object.entries(samples)) {
            const config = JSON.parse(text) as { machines?: { id: number; prototype?: string; recipe: string }[] };
            for (const machine of config.machines ?? []) {
                if (machine.prototype === undefined) continue;
                expect(recipeNotMadeText(machine, data, name, name), `${file} machine ${machine.id}`).toBeUndefined();
            }
        }
    });
});
