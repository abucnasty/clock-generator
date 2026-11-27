// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import type { StorageLike } from '../utils/buildLibrary';
import { PROFILES_KEY, TEMPLATES, openProfileStore, type Bonuses } from '../utils/researchProfiles';
import { ResearchProfilesDialog } from './ResearchProfilesDialog';

const NAMES = { item: {}, recipe: { 'plastic-bar': 'Plastic bar', 'low-density-structure': 'Low density structure', 'steel-plate': 'Steel plate' } };
const RECIPES = ['plastic-bar', 'low-density-structure', 'steel-plate'];

function memoryStorage() {
    const items = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { items.set(key, value); });
    const storage: StorageLike = {
        getItem: key => items.get(key) ?? null,
        setItem,
        removeItem: key => { items.delete(key); },
        key: i => [...items.keys()][i] ?? null,
        get length() { return items.size; },
    };
    return { storage, items, setItem };
}

function counter() {
    let n = 0;
    return () => `id-${++n}`;
}

function openDialog(storage: StorageLike = memoryStorage().storage) {
    const onClose = vi.fn();
    const view = show(<ResearchProfilesDialog open onClose={onClose} recipeOptions={RECIPES} storage={storage} newId={counter()} />, { names: NAMES });
    return { ...view, onClose };
}

const field = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const profileBox = () => screen.getByRole('combobox', { name: 'Profile' });

/** Makes a profile through the New dialog and leaves it selected */
async function makeProfile(user: ReturnType<typeof show>['user'], name: string, template = 'All finite research') {
    await user.click(button('New'));
    const dialog = screen.getByRole('dialog', { name: 'New research profile' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), name);
    await user.click(within(dialog).getByRole('radio', { name: template }));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
}

describe('the dialog', () => {
    it('opens on a template, read-only, with both templates listed and nothing written', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        expect(screen.getByRole('dialog', { name: 'Research profiles' })).toBeDefined();
        expect(profileBox().textContent).toContain('No research');
        await user.click(profileBox());
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            expect.stringContaining('No research'), expect.stringContaining('All finite research'),
        ]);
        await user.click(screen.getByRole('option', { name: /All finite research/ }));
        expect(field('Mining productivity').value).toBe('20');
        expect(field('Mining productivity').readOnly).toBe(true);
        expect(field('Inserter capacity').value).toBe('3');
        expect(field('Bulk inserter capacity').value).toBe('11');
        expect(field('Belt stack size bonus').value).toBe('3');
        expect(button('Rename').disabled).toBe(true);
        expect(button('Copy').disabled).toBe(true);
        expect(button('Remove').disabled).toBe(true);
        expect(button('Revert to template').disabled).toBe(true);
        expect(button('New profile from this template')).toBeDefined();
        expect(screen.getAllByText('Set yours').length).toBeGreaterThan(0);
        expect(memory.items.has(PROFILES_KEY)).toBe(true); // choosing a profile is the user's act: it is remembered
        expect(memory.setItem).toHaveBeenCalledTimes(1);
    });

    it('writes nothing while the user only looks', () => {
        const memory = memoryStorage();
        openDialog(memory.storage);
        expect(memory.setItem).not.toHaveBeenCalled();
    });

    it('makes a profile from a template with New, and selects it', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'My megabase');
        expect(profileBox().textContent).toContain('My megabase');
        expect(field('Mining productivity').value).toBe('20');
        expect(field('Mining productivity').readOnly).toBe(false);
        expect(screen.getByText('Started from the template: All finite research')).toBeDefined();
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles).toHaveLength(1);
    });

    it('opens New with the template chosen from "New profile from this template"', async () => {
        const { user } = openDialog();
        await user.click(profileBox());
        await user.click(screen.getByRole('option', { name: /All finite research/ }));
        await user.click(button('New profile from this template'));
        const dialog = screen.getByRole('dialog', { name: 'New research profile' });
        expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'All finite research' }).checked).toBe(true);
    });

    it('refuses an empty name, a name in use and a template\'s name in New, and says why', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Taken');
        await user.click(button('New'));
        const dialog = screen.getByRole('dialog', { name: 'New research profile' });
        const create = within(dialog).getByRole('button', { name: 'Create' });
        await user.click(create);
        expect(within(dialog).getByText('Type a name.')).toBeDefined();
        await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'taken');
        await user.click(create);
        expect(within(dialog).getByText('A profile with that name exists.')).toBeDefined();
        await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
        await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'No Research');
        await user.click(create);
        expect(within(dialog).getByText('That is the name of a template.')).toBeDefined();
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'New research profile' })).toBeNull();
    });

    it('renames a profile, and refuses a name in use', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Old');
        await makeProfile(user, 'Other');
        await user.click(button('Rename'));
        const dialog = screen.getByRole('dialog', { name: 'Rename research profile' });
        const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Name' });
        expect(name.value).toBe('Other');
        await user.clear(name);
        await user.type(name, 'old');
        await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
        expect(within(dialog).getByText('A profile with that name exists.')).toBeDefined();
        await user.clear(name);
        await user.type(name, 'Renamed');
        await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
        expect(profileBox().textContent).toContain('Renamed');
    });

    it('copies a profile in one click, with its numbers, and selects the copy', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Base');
        await user.click(button('Copy'));
        expect(profileBox().textContent).toContain('Base (copy)');
        expect(field('Bulk inserter capacity').value).toBe('11');
        await user.click(profileBox());
        await user.click(screen.getByRole('option', { name: /^Base$/ }));
        await user.click(button('Copy'));
        expect(profileBox().textContent).toContain('Base (copy 2)');
    });

    it('removes a profile only after asking, and Cancel keeps it', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'Gone');
        await user.click(button('Remove'));
        const ask = screen.getByRole('dialog', { name: 'Remove "Gone"?' });
        await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles).toHaveLength(1);
        await user.click(button('Remove'));
        await user.click(within(screen.getByRole('dialog', { name: 'Remove "Gone"?' })).getByRole('button', { name: 'Remove' }));
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles).toHaveLength(0);
        // a template is shown in its place
        expect(profileBox().textContent).not.toContain('Gone');
        expect(field('Mining productivity').readOnly).toBe(true);
    });

    it('reverts to the template after asking, and the button is off while the numbers are the template\'s', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Mine');
        expect(button('Revert to template').disabled).toBe(true);
        await user.clear(field('Inserter capacity'));
        await user.type(field('Inserter capacity'), '2');
        await user.tab();
        expect(button('Revert to template').disabled).toBe(false);
        await user.click(button('Revert to template'));
        const ask = screen.getByRole('dialog', { name: 'Revert "Mine" to "All finite research"?' });
        await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
        expect(field('Inserter capacity').value).toBe('2');
        await user.click(button('Revert to template'));
        await user.click(within(screen.getByRole('dialog', { name: 'Revert "Mine" to "All finite research"?' })).getByRole('button', { name: 'Revert' }));
        expect(field('Inserter capacity').value).toBe('3');
        expect(button('Revert to template').disabled).toBe(true);
    });

    it('shows what each stack number gives, from the two rules', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Mine');
        expect(screen.getByText('gives an inserter 4')).toBeDefined();
        expect(screen.getByText('gives a bulk inserter 12, a stack inserter 16')).toBeDefined();
        expect(screen.getByText('gives stacks of 4')).toBeDefined();
        await user.clear(field('Inserter capacity'));
        await user.type(field('Inserter capacity'), '0');
        await user.tab();
        expect(screen.getByText('gives an inserter 1')).toBeDefined();
        await user.clear(field('Belt stack size bonus'));
        await user.type(field('Belt stack size bonus'), '1');
        await user.tab();
        expect(screen.getByText('gives stacks of 2')).toBeDefined();
    });

    it('keeps a belt bonus of 4 and shows stacks of 4', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Scripted');
        await user.clear(field('Belt stack size bonus'));
        await user.type(field('Belt stack size bonus'), '4');
        await user.tab();
        expect(field('Belt stack size bonus').value).toBe('4');
        expect(screen.getByText('gives stacks of 4')).toBeDefined();
    });

    it('keeps mining productivity in percent', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'Mine');
        await user.clear(field('Mining productivity'));
        await user.type(field('Mining productivity'), '79990');
        await user.tab();
        const stored = JSON.parse(memory.items.get(PROFILES_KEY)!);
        expect(stored.profiles[0].bonuses.mining_drill_productivity_bonus).toBe(79990);
    });

    it('steps a number with the steppers and the arrow keys', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'Mine');
        const stored = () => JSON.parse(memory.items.get(PROFILES_KEY)!).profiles[0].bonuses;
        const row = field('Inserter capacity').closest('div')!.parentElement!;
        await user.click(within(row).getByRole('button', { name: 'Increase' }));
        expect(stored().inserter_stack_size_bonus).toBe(4);
        expect(field('Inserter capacity').value).toBe('4');
        expect(screen.getByText('gives an inserter 5')).toBeDefined();
        await user.click(within(row).getByRole('button', { name: 'Decrease' }));
        await user.click(within(row).getByRole('button', { name: 'Decrease' }));
        expect(stored().inserter_stack_size_bonus).toBe(2);
        await user.click(field('Belt stack size bonus'));
        await user.keyboard('{ArrowUp}{ArrowUp}');
        await user.tab();
        expect(stored().belt_stack_size_bonus).toBe(5);
        expect(field('Belt stack size bonus').value).toBe('5');
    });

    it('does not keep a stack number that is not whole, and says so', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Mine');
        await user.clear(field('Inserter capacity'));
        await user.type(field('Inserter capacity'), '2.5');
        await user.tab();
        expect(screen.getByText('Inserter capacity must be a whole number, 0 or more.')).toBeDefined();
        expect(field('Inserter capacity').value).toBe('3');
    });

    it('adds a recipe row with the recipe picker, sets its productivity and removes it', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'Mine', 'No research');
        await user.click(button('Add a recipe'));
        await user.click(screen.getByRole('button', { name: 'Recipe to add' }));
        const picker = screen.getByRole('dialog', { name: 'Choose a recipe for Recipe to add' });
        await user.click(within(picker).getByRole('button', { name: 'Plastic bar' }));
        await user.click(within(picker).getByRole('button', { name: 'Apply' }));
        expect(field('Plastic bar').value).toBe('0');
        await user.clear(field('Plastic bar'));
        await user.type(field('Plastic bar'), '300');
        await user.tab();
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles[0].bonuses.recipes).toEqual({ 'plastic-bar': { productivity_bonus: 300 } });
        // a recipe in the list is not offered again
        await user.click(button('Add a recipe'));
        await user.click(screen.getByRole('button', { name: 'Recipe to add' }));
        const again = screen.getByRole('dialog', { name: 'Choose a recipe for Recipe to add' });
        expect(within(again).queryByRole('button', { name: 'Plastic bar' })).toBeNull();
        await user.click(within(again).getByRole('button', { name: 'Cancel recipe selection' }));
        await user.click(button('Remove Plastic bar'));
        expect(screen.queryByRole('textbox', { name: 'Plastic bar' })).toBeNull();
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles[0].bonuses.recipes).toEqual({});
    });

    it('shows the 18 recipes of the All template read-only at 300, with "Set yours" under Recipe productivity', async () => {
        const { user } = openDialog();
        await user.click(profileBox());
        await user.click(screen.getByRole('option', { name: /All finite research/ }));
        const recipes = within(screen.getByRole('region', { name: /Recipe productivity/ }));
        const rows = recipes.getAllByRole<HTMLInputElement>('textbox');
        expect(rows).toHaveLength(18);
        for (const row of rows) {
            expect(row.value).toBe('300');
            expect(row.readOnly).toBe(true);
        }
        expect(recipes.getByText('Set yours')).toBeDefined();
        expect(screen.getAllByText('Set yours')).toHaveLength(2);
    });

    it('keeps "Set yours" on the recipes of a profile until a recipe number is changed, added or removed', async () => {
        const { user } = openDialog();
        await makeProfile(user, 'Mine');
        const section = () => within(screen.getByRole('region', { name: /Recipe productivity/ }));
        expect(section().getByText('Set yours')).toBeDefined();
        expect(screen.getAllByText('Set yours')).toHaveLength(2);
        await user.clear(field('Plastic bar'));
        await user.type(field('Plastic bar'), '290');
        await user.tab();
        expect(section().queryByText('Set yours')).toBeNull();
        await user.click(button('Revert to template'));
        await user.click(within(screen.getByRole('dialog', { name: /^Revert/ })).getByRole('button', { name: 'Revert' }));
        expect(section().getByText('Set yours')).toBeDefined();
        await user.click(button('Remove Plastic bar'));
        expect(section().queryByText('Set yours')).toBeNull();
        await user.click(button('Revert to template'));
        await user.click(within(screen.getByRole('dialog', { name: /^Revert/ })).getByRole('button', { name: 'Revert' }));
        expect(section().getByText('Set yours')).toBeDefined();
        // mining keeps its own mark while its number is the template's
        await user.clear(field('Mining productivity'));
        await user.type(field('Mining productivity'), '25');
        await user.tab();
        expect(screen.getAllByText('Set yours')).toHaveLength(1);
        expect(section().getByText('Set yours')).toBeDefined();
    });

    it('shows no "Set yours" under Recipe productivity of No research', async () => {
        const { user } = openDialog();
        expect(within(screen.getByRole('region', { name: /Recipe productivity/ })).queryByText('Set yours')).toBeNull();
        await makeProfile(user, 'Mine', 'No research');
        expect(within(screen.getByRole('region', { name: /Recipe productivity/ })).queryByText('Set yours')).toBeNull();
    });

    it('shows the recipes of a template read-only, with no way to add one', async () => {
        const { user } = openDialog();
        await user.click(profileBox());
        await user.click(screen.getByRole('option', { name: /All finite research/ }));
        expect(screen.queryByRole('button', { name: 'Add a recipe' })).toBeNull();
    });

    it('reads the list again when another tab writes, and when the storage is cleared', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        const other = openProfileStore(memory.storage, () => 'from-other-tab');
        other.create('From another tab', 'no-research');
        await user.click(profileBox());
        expect(screen.queryByRole('option', { name: /From another tab/ })).toBeNull();
        await user.keyboard('{Escape}');
        act(() => { window.dispatchEvent(new StorageEvent('storage', { key: PROFILES_KEY, newValue: memory.items.get(PROFILES_KEY) ?? null })); });
        await user.click(profileBox());
        expect(screen.getByRole('option', { name: /From another tab/ })).toBeDefined();
        await user.keyboard('{Escape}');
        memory.items.clear();
        act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
        await user.click(profileBox());
        expect(screen.queryByRole('option', { name: /From another tab/ })).toBeNull();
        expect(screen.getAllByRole('option')).toHaveLength(TEMPLATES.length);
    });

    it('ignores a storage event of another key', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        openProfileStore(memory.storage, () => 'x').create('Quiet', 'no-research');
        act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'clock-generator-builds' })); });
        await user.click(profileBox());
        expect(screen.queryByRole('option', { name: /Quiet/ })).toBeNull();
    });

    it('says when the profiles are not saved', async () => {
        const blocked: StorageLike = {
            getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
            key: () => { throw new Error('blocked'); }, get length(): number { throw new Error('blocked'); },
        };
        const { user } = openDialog(blocked);
        expect(screen.getByText(/not saved/i)).toBeDefined();
        await makeProfile(user, 'In memory');
        expect(profileBox().textContent).toContain('In memory');
    });

    it('closes with Close', async () => {
        const { user, onClose } = openDialog();
        await user.click(button('Close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows no content while closed', () => {
        show(<ResearchProfilesDialog open={false} onClose={vi.fn()} recipeOptions={RECIPES} storage={memoryStorage().storage} />, { names: NAMES });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('what a profile holds', () => {
    it('keeps the numbers as the store keeps them', async () => {
        const memory = memoryStorage();
        const { user } = openDialog(memory.storage);
        await makeProfile(user, 'Mine', 'No research');
        const bonuses: Bonuses = JSON.parse(memory.items.get(PROFILES_KEY)!).profiles[0].bonuses;
        expect(bonuses).toEqual(TEMPLATES[0].bonuses);
    });
});
