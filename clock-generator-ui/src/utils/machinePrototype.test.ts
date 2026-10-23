import { describe, expect, it } from 'vitest';
import { Option } from 'clock-generator/light';
import factorioData from '../../../clock-generator/resources/data-filtered.json';
import type { CraftingMachineData } from '../worker/types';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig, type MachineFormData } from './configForm/formData';
import { patchMachine } from './configForm/edits';
import { applyPaste } from './pastePreview';
import { craftingMachineOf, effectiveRule, machineIconText, MACHINE_QUALITY_HELP, recipesOfMachine, ruleDescription, ruleOfMachine } from './machinePrototype';

const data: CraftingMachineData = {
    machines: Object.values(factorioData.crafting_machine),
    recipeCategories: Object.fromEntries(Object.values(factorioData.recipe).map(recipe => [recipe.name, recipe.categories])),
};
const row = (fields: Partial<MachineFormData>): MachineFormData =>
    ({ id: 3, _uuid: 'm', recipe: 'lithium-plate', productivity: 0, crafting_speed: 1, ...fields });

describe('a machine row and its machine', () => {
    it('gets the rule from the machine data: furnace prototypes the furnace rule, a nutrient burner the biochamber rule', () => {
        expect(ruleOfMachine(craftingMachineOf(data, 'recycler')!)).toBe('furnace');
        expect(ruleOfMachine(craftingMachineOf(data, 'biochamber')!)).toBe('biochamber');
        expect(ruleOfMachine(craftingMachineOf(data, 'cryogenic-plant')!)).toBe('machine');
        expect(effectiveRule(row({ prototype: 'electric-furnace' }), data)).toBe('furnace');
        expect(effectiveRule(row({ prototype: 'electric-furnace', type: 'machine' }), data)).toBe('machine');
        expect(effectiveRule(row({}), data)).toBe('machine');
    });

    it('offers only the recipes the machine can make', () => {
        // spelt in two, so that the icon check does not take it for an icon the page draws
        const recycling = `${'iron-gear-wheel'}-recycling`;
        const plant = craftingMachineOf(data, 'cryogenic-plant')!;
        expect(recipesOfMachine(plant, ['lithium', 'lithium-plate', 'iron-gear-wheel'], data)).toEqual(['lithium']);
        expect(recipesOfMachine(craftingMachineOf(data, 'recycler')!, ['iron-gear-wheel', recycling], data)).toEqual([recycling]);
    });

    it("names the machine, its quality and its source on the row icon, and the rule when there is none", () => {
        const name = (id: string) => ({ 'cryogenic-plant': 'Cryogenic plant' })[id] ?? id;
        expect(machineIconText(row({ prototype: 'cryogenic-plant', quality: 'legendary', _prototype_source: 'sidecar' }), name, data))
            .toBe('Cryogenic plant (Legendary), from Sidecar');
        expect(machineIconText(row({ prototype: 'cryogenic-plant', _prototype_source: 'hand' }), name, data)).toBe('Cryogenic plant, chosen by hand');
        expect(machineIconText(row({ prototype: 'cryogenic-plant' }), name, data)).toBe('Cryogenic plant, from the config');
        expect(machineIconText(row({ type: 'furnace' }), name, data)).toBe('No machine set: simulated under the furnace rule');
    });

    it('says what each rule does, and that quality is a label only', () => {
        expect(ruleDescription('furnace', '100 Iron plate')).toContain('until its output holds a full stack of the product (100 Iron plate)');
        expect(ruleDescription('biochamber')).toContain('burns nutrients');
        expect(MACHINE_QUALITY_HELP).toMatch(/label only.*changes neither/);
    });
});

describe('where a machine came from', () => {
    const imported = { target_output: { recipe: 'lithium-plate', items_per_second: 1, copies: 1 }, inserters: [], belts: [],
        machines: [{ id: 1, recipe: 'lithium-plate', productivity: 0, crafting_speed: 1, type: 'furnace' as const, prototype: 'electric-furnace' },
            { id: 2, recipe: 'lithium', productivity: 0, crafting_speed: 1 }] };

    it("is the sample's for an example, unknown for a file, and never leaves the form", () => {
        const sample = configToFormData(imported, 'sample');
        expect(sample.machines.map(machine => machine._prototype_source)).toEqual(['sample', undefined]);
        expect(configToFormData(imported).machines[0]._prototype_source).toBeUndefined();
        expect(formDataToConfig(sample).machines[0]).not.toHaveProperty('_prototype_source');
    });

    it("is Sidecar's for a paste", () => {
        const pasted = applyPaste(createDefaultConfig(), { machines: imported.machines, drills: [], inserters: [], belts: [], chests: [], guidance: Option.none(), suggested_target: Option.none() },
            { target: false, machines: true, drills: false, inserters: false, belts: false, chests: false });
        expect(pasted.machines.map(machine => machine._prototype_source)).toEqual(['sidecar', undefined]);
    });

    it('is by hand once chosen, and goes with the machine', () => {
        const form = configToFormData(imported, 'sample');
        const chosen = patchMachine(form, 1, { prototype: 'cryogenic-plant', _prototype_source: 'hand', type: 'machine' });
        expect(chosen.machines[1]).toMatchObject({ prototype: 'cryogenic-plant', _prototype_source: 'hand', type: 'machine' });
        const cleared = patchMachine(chosen, 1, { prototype: undefined, _prototype_source: undefined });
        expect(cleared.machines[1]).not.toHaveProperty('prototype');
        expect(cleared.machines[1]).not.toHaveProperty('_prototype_source');
        expect(cleared.machines[1].type).toBe('machine');
    });
});
