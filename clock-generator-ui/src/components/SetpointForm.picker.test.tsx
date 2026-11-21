// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SetpointOutput } from 'clock-generator/light';
import { names, show } from '../test/fixtures';
import { SetpointForm } from './SetpointForm';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';

/** What the engine's rule gives for the recipes a test picks from (the lookups of the page carry it) */
const OUTPUTS: Record<string, SetpointOutput> = {
    'jellynut-processing': { kind: 'output', item: 'jelly', choices: ['jellynut-seed', 'jelly'] },
    'iron-gear-wheel': { kind: 'output', item: 'iron-gear-wheel', choices: ['iron-gear-wheel'] },
    'iron-bacteria-cultivation': { kind: 'output', item: 'iron-bacteria', choices: ['iron-bacteria'] },
    'kovarex-enrichment-process': { kind: 'output', item: 'uranium-235', choices: [] },
    'sulfuric-acid': { kind: 'none' },
};
const gameNames = names(
    { jelly: 'Jelly', 'jellynut-seed': 'Jellynut seed', 'iron-gear-wheel': 'Iron gear wheel', 'uranium-235': 'Uranium-235' },
    { 'jellynut-processing': 'Jellynut processing', 'iron-gear-wheel': 'Iron gear wheel', 'iron-bacteria-cultivation': 'Iron bacteria cultivation',
        'kovarex-enrichment-process': 'Kovarex enrichment process', 'sulfuric-acid': 'Sulfuric acid' },
);
type Props = Parameters<typeof SetpointForm>[0];
const props: Props = { recipe: 'iron-gear-wheel', itemsPerSecond: 1, copies: 1, counts: 'made', machinesMax: null,
    recipeNames: Object.keys(OUTPUTS), recipeOutputOf: recipe => OUTPUTS[recipe] ?? null, machineRecipes: ['iron-gear-wheel'],
    onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: () => {}, onCopiesChange: () => {} };
/** The page holds the setpoint's item, which the form reports changes of */
function Page(given: Props) {
    const [item, setItem] = useState(given.recipe);
    return <SetpointForm {...given} recipe={item} onRecipeChange={value => { setItem(value); given.onRecipeChange(value); }} />;
}
const form = (overrides: Partial<Props> = {}) => show(<Page {...props} {...overrides} />, { names: gameNames });
const recipeField = () => screen.getByRole('button', { name: TARGET_RECIPE_NAME }) as HTMLInputElement;
const outputField = () => screen.queryByRole('combobox', { name: 'Output' });

/** Opens the recipe picker, finds the recipe by its name, and applies it */
async function pick(user: ReturnType<typeof form>['user'], recipe: string) {
    await user.click(recipeField());
    const dialog = screen.getByRole('dialog', { name: `Choose a recipe for ${TARGET_RECIPE_NAME}` });
    const name = gameNames.recipe[recipe] ?? recipe;
    await user.type(within(dialog).getByRole('textbox'), name);
    await user.click(within(dialog).getByRole('button', { name }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
}

describe('the setpoint picker, for a recipe with several outputs', () => {
    it('shows a second choice of the outputs, the one the engine counts selected, and saves that item, with no machine of the recipe in the build', async () => {
        const onRecipeChange = vi.fn();
        const { user } = form({ onRecipeChange });
        expect(outputField()).toBeNull();
        await pick(user, 'jellynut-processing');
        expect(onRecipeChange).toHaveBeenLastCalledWith('jelly');
        expect(recipeField().value).toBe('Jellynut processing');
        await user.click(outputField()!);
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Jellynut seed', 'Jelly']);
        expect(screen.getByRole('option', { selected: true }).textContent).toBe('Jelly');
    });

    it('says what the engine does not count yet for another choice, and saves no item for it', async () => {
        const onRecipeChange = vi.fn();
        const { user } = form({ onRecipeChange });
        await pick(user, 'jellynut-processing');
        onRecipeChange.mockClear();
        await user.click(outputField()!);
        await user.click(screen.getByRole('option', { name: 'Jellynut seed' }));
        expect(onRecipeChange).not.toHaveBeenCalled();
        expect(screen.getByText('jellynut-seed is not counted yet; choose jelly')).toBeDefined();
        // choosing the output the engine counts clears the words and saves it
        await user.click(outputField()!);
        await user.click(screen.getByRole('option', { name: 'Jelly' }));
        expect(onRecipeChange).toHaveBeenCalledExactlyOnceWith('jelly');
        expect(screen.queryByText('jellynut-seed is not counted yet; choose jelly')).toBeNull();
    });

    it('opens a saved config with the recipe of the machine that makes its item, and its choice set', () => {
        form({ recipe: 'jelly', machineRecipes: ['iron-gear-wheel', 'jellynut-processing'] });
        expect(recipeField().value).toBe('Jellynut processing');
        expect(outputField()!.textContent).toBe('Jelly');
    });
});

describe('the setpoint picker, for a recipe with one output or none to choose', () => {
    it.each([
        ['iron-gear-wheel', 'iron-gear-wheel'],
        ['iron-bacteria-cultivation', 'iron-bacteria'],
        ['kovarex-enrichment-process', 'uranium-235'],
    ])('shows no second choice for %s and saves its item %s', async (recipe, item) => {
        const onRecipeChange = vi.fn();
        const { user } = form({ recipe: 'jelly', machineRecipes: [], onRecipeChange });
        await pick(user, recipe);
        expect(outputField()).toBeNull();
        expect(onRecipeChange).toHaveBeenCalledExactlyOnceWith(item);
    });

    it('says a recipe with no item result has no output a setpoint can count, and saves nothing', async () => {
        const onRecipeChange = vi.fn();
        const { user } = form({ onRecipeChange });
        await pick(user, 'sulfuric-acid');
        expect(onRecipeChange).not.toHaveBeenCalled();
        expect(outputField()).toBeNull();
        expect(screen.getByText('sulfuric-acid has no output a setpoint can count; choose another recipe')).toBeDefined();
    });

    it('saves the name as typed for a recipe the lookups do not know', async () => {
        const onRecipeChange = vi.fn();
        const { user } = form({ onRecipeChange, recipeNames: ['grenade'], recipeOutputOf: () => null });
        await pick(user, 'grenade');
        expect(onRecipeChange).toHaveBeenCalledExactlyOnceWith('grenade');
    });
});

describe('the setpoint picker, for a saved item it cannot place', () => {
    it('shows an item that no machine makes as it is, with no choice', () => {
        form({ recipe: 'jelly', machineRecipes: ['iron-gear-wheel'] });
        expect(recipeField().value).toBe('Jelly');
        expect(outputField()).toBeNull();
    });

    it('shows a recipe name held in the item as it is, with no choice', () => {
        form({ recipe: 'jellynut-processing', machineRecipes: ['jellynut-processing'] });
        expect(recipeField().value).toBe('Jellynut processing');
        expect(outputField()).toBeNull();
    });
});

describe('the setpoint picker, for a saved or pasted setpoint the engine refuses', () => {
    it('says what the engine does not count yet for an output of a recipe of the build that is not the one it counts', () => {
        form({ recipe: 'jellynut-seed', machineRecipes: ['jellynut-processing'] });
        expect(screen.getByText('jellynut-seed is not counted yet; choose jelly')).toBeDefined();
        expect(recipeField().value).toBe('Jellynut seed');
        expect(outputField()).toBeNull();
    });

    it('says a recipe with no item result has no output a setpoint can count', () => {
        form({ recipe: 'sulfuric-acid', machineRecipes: ['iron-gear-wheel'] });
        expect(screen.getByText('sulfuric-acid has no output a setpoint can count; choose another recipe')).toBeDefined();
    });

    it('says nothing for an item the engine counts', () => {
        form({ recipe: 'jelly', machineRecipes: ['jellynut-processing'] });
        expect(screen.queryByText(/not counted yet/)).toBeNull();
    });

    it('says nothing where the setpoint counts an item destroyed', () => {
        form({ recipe: 'jellynut-seed', machineRecipes: ['jellynut-processing'], counts: 'destroyed', destroyedItemNames: ['jellynut-seed'] });
        expect(screen.queryByText(/not counted yet/)).toBeNull();
    });
});
