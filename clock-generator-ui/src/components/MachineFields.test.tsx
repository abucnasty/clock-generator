import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import factorioData from '../../../clock-generator/resources/data-filtered.json';
import { CraftingMachinesContext } from '../hooks/useCraftingMachines';
import type { CraftingMachineData } from '../worker/types';
import type { MachineFormData } from '../utils/configForm/formData';
import { CraftingSpeedHint, MachineIconPicker, MachinePrototypeField, RecipeNotMadeNote } from './MachineFields';
import { MachineSettingsFields } from './EntityFields';

const data: CraftingMachineData = {
    machines: Object.values(factorioData.crafting_machine),
    recipeCategories: Object.fromEntries(Object.values(factorioData.recipe).map(recipe => [recipe.name, recipe.categories])),
};
const render = (node: ReactNode) => renderToStaticMarkup(<CraftingMachinesContext value={data}>{node}</CraftingMachinesContext>);
const machine = (fields: Partial<MachineFormData>): MachineFormData => ({ id: 2, _uuid: 'm', recipe: 'lithium', productivity: 0, crafting_speed: 40, ...fields });

it('hints the Crafting Speed field with the machine at its quality, in both the row and the dialog', () => {
    const hint = 'cryogenic-plant (Legendary): 5× before modules and beacons, which change it. The clock uses the speed in this field.';
    expect(render(<CraftingSpeedHint machine={machine({ prototype: 'cryogenic-plant', quality: 'legendary' })} />)).toContain(hint);
    for (const dialog of [false, true]) {
        const html = render(<MachineSettingsFields machine={machine({ prototype: 'cryogenic-plant', quality: 'legendary' })} dialog={dialog} onChange={() => {}} onPatch={() => {}} />);
        expect(html).toContain(hint);
        // the field keeps the speed as exported
        expect(html).toContain('value="40"');
    }
});

it('shows the Machine field as a button that opens the picker, with the machine and its quality', () => {
    const html = render(<MachinePrototypeField machine={machine({ prototype: 'electric-furnace', quality: 'rare' })} onPatch={() => {}} inputAriaLabel="Machine, Machine 2" />);
    expect(html).toContain('aria-label="Machine, Machine 2"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('value="electric-furnace"');
    expect(html).not.toContain('role="combobox"');
    expect(render(<MachinePrototypeField machine={machine({})} onPatch={() => {}} inputAriaLabel="Machine, Machine 2" />)).toContain('placeholder="Choose a machine"');
});

it("names the button on a row's machine icon and leaves the picker closed", () => {
    const html = render(<MachineIconPicker machine={machine({ prototype: 'electric-furnace' })} onPatch={() => {}} buttonName="Change machine, Machine 2" rowName="Machine 2"><span>icon</span></MachineIconPicker>);
    expect(html).toContain('aria-label="Change machine, Machine 2"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
});

it("says on the row that a machine cannot make the row's recipe, and says nothing when it can", () => {
    const html = render(<RecipeNotMadeNote machine={machine({ prototype: 'assembling-machine-1', recipe: 'lithium' })} />);
    expect(html).toContain("assembling-machine-1 can&#x27;t craft lithium. Machines that can: chemical-plant, cryogenic-plant.");
    expect(render(<RecipeNotMadeNote machine={machine({ prototype: 'cryogenic-plant', recipe: 'lithium' })} />)).toBe('');
    expect(render(<RecipeNotMadeNote machine={machine({ recipe: 'lithium' })} />)).toBe('');
});
