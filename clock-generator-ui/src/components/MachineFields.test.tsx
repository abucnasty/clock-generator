// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import factorioData from '../../../clock-generator/resources/data-filtered.json';
import { machine as machineRow, show } from '../test/fixtures';
import type { CraftingMachineData } from '../worker/types';
import type { MachineFormData } from '../utils/configForm/formData';
import { CraftingSpeedHint, MachineIconPicker, MachinePrototypeField, RecipeNotMadeNote } from './MachineFields';
import { MachineSettingsFields } from './EntityFields';

const craftingMachines: CraftingMachineData = {
    machines: Object.values(factorioData.crafting_machine),
    recipeCategories: Object.fromEntries(Object.values(factorioData.recipe).map(recipe => [recipe.name, recipe.categories])),
};
const machine = (fields: Partial<MachineFormData>) => machineRow(2, { recipe: 'lithium', crafting_speed: 40, ...fields });
const cryogenic = machine({ prototype: 'cryogenic-plant', quality: 'legendary' });

it.each([
    { where: 'hint alone', speed: undefined, ui: <CraftingSpeedHint machine={cryogenic} /> },
    // the field keeps the speed as exported
    { where: 'row', speed: '40', ui: <MachineSettingsFields machine={cryogenic} onChange={vi.fn()} onPatch={vi.fn()} /> },
    { where: 'dialog', speed: '40', ui: <MachineSettingsFields machine={cryogenic} dialog onChange={vi.fn()} onPatch={vi.fn()} /> },
])('hints the Crafting Speed field with the machine at its quality ($where)', ({ speed, ui }) => {
    show(ui, { craftingMachines });
    expect(screen.getByText('cryogenic-plant (Legendary): 5× before modules and beacons, which change it. The clock uses the speed in this field.')).toBeDefined();
    expect(screen.queryByRole<HTMLInputElement>('textbox', { name: 'Crafting Speed' })?.value).toBe(speed);
});

it.each([
    { what: 'the Machine field', button: 'Machine, Machine 2', picker: 'Choose a machine for Machine, Machine 2',
        ui: <MachinePrototypeField machine={machine({ prototype: 'electric-furnace', quality: 'rare' })} onPatch={vi.fn()} inputAriaLabel="Machine, Machine 2" /> },
    { what: "a row's machine icon", button: 'Change machine, Machine 2', picker: 'Choose a machine for Machine 2',
        ui: <MachineIconPicker machine={machine({ prototype: 'electric-furnace' })} onPatch={vi.fn()} buttonName="Change machine, Machine 2" rowName="Machine 2"><span>icon</span></MachineIconPicker> },
])('shows $what as a button that opens the Machine picker, closed until pressed', async ({ button, picker, ui }) => {
    const { user } = show(ui, { craftingMachines });
    const opener = screen.getByRole('button', { name: button });
    expect([opener.getAttribute('aria-haspopup'), opener.getAttribute('aria-expanded')]).toEqual(['dialog', 'false']);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: picker })).toBeDefined();
    expect(opener.getAttribute('aria-expanded')).toBe('true');
});

it.each([
    { prototype: 'electric-furnace', quality: 'rare' as const, value: 'electric-furnace' },
    { prototype: undefined, quality: undefined, value: '' },
])('shows the machine in the Machine field, or asks for one ($prototype)', ({ prototype, quality, value }) => {
    show(<MachinePrototypeField machine={machine({ prototype, quality })} onPatch={vi.fn()} inputAriaLabel="Machine, Machine 2" />, { craftingMachines });
    const field = screen.getByRole<HTMLInputElement>('button', { name: 'Machine, Machine 2' });
    expect([field.value, field.placeholder]).toEqual([value, 'Choose a machine']);
});

it("says on the row that a machine cannot make the row's recipe", () => {
    show(<RecipeNotMadeNote machine={machine({ prototype: 'assembling-machine-1' })} />, { craftingMachines });
    expect(screen.getByText("assembling-machine-1 can't craft lithium. Machines that can: chemical-plant, cryogenic-plant.")).toBeDefined();
});

it.each([
    { machine: 'one that can', prototype: 'cryogenic-plant' },
    { machine: 'none', prototype: undefined },
])("says nothing of the row's recipe for $machine", ({ prototype }) => {
    const { container } = show(<RecipeNotMadeNote machine={machine({ prototype })} />, { craftingMachines });
    expect(container.firstChild).toBeNull();
});
