// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { bufferChest, containerChest, infinityChest, inserter, names, show } from '../test/fixtures';
import { validationIssueElementId } from '../utils/buildValidation';
import type { ChestFormData, InserterFormData } from '../utils/configForm/formData';
import { OutputChestAlert } from './OutputChestAlert';

const into = inserter(1, { sink: { type: 'chest', id: 7 } });
const out = inserter(2, { source: { type: 'chest', id: 7 }, sink: { type: 'machine', id: 2 } });
const alert = (chest: ChestFormData, inserters: InserterFormData[], { onSwitchType = vi.fn(), onEnableRemoval = vi.fn() } = {}) =>
    <OutputChestAlert chests={[chest]} inserters={inserters} onSwitchType={onSwitchType} onEnableRemoval={onEnableRemoval} />;
const ironPlate = names({ 'iron-plate': 'Iron plate' });
const pictures = (scope: HTMLElement) => within(scope).getAllByRole('presentation', { hidden: true }).map(picture => picture.getAttribute('src'));

it.each([
    { chest: bufferChest(7, { storage_size: 1, item_filter: 'iron-plate' }), name: 'Chest 7', text: 'No inserter takes iron plate out of this buffer chest.', icon: 'steel-chest' },
    { chest: containerChest(7, ChestType.CAR), name: 'Car 7', text: 'out of this car.', icon: 'car' },
    { chest: containerChest(7, ChestType.TANK), name: 'Tank 7', text: 'out of this tank.', icon: 'tank' },
    { chest: containerChest(7, ChestType.CARGO_WAGON), name: 'Cargo wagon 7', text: 'or swap it at a station', icon: 'cargo-wagon' },
    { chest: containerChest(7, ChestType.ROCKET_SILO), name: 'Rocket silo 7', text: 'launches rockets, which the simulator does not model yet', icon: 'rocket-silo' },
])('warns that $name at the end of a line can fill up, with its own icon, and switches it to an infinity chest', async ({ chest, name, text, icon }) => {
    const onSwitchType = vi.fn();
    const { user, container, rerender } = show(alert(chest, [into], { onSwitchType }), { names: ironPlate });
    expect(screen.getByRole('region', { name: 'Build validation' })).toBeDefined();
    // advice in the page, not an interruption
    expect(screen.queryByRole('alert')).toBeNull();
    // named by what it is
    const issue = screen.getByRole('group', { name: `${name} can fill up and block output` });
    expect(within(issue).getByText(content => content.includes(text))).toBe(within(issue).getByText(/model output being taken away continuously\.$/));
    expect(pictures(issue)).toEqual([`/icons/${icon}.png`]);
    await user.click(within(issue).getByRole('button', { name: `Use infinity chest for ${name}` }));
    expect(onSwitchType).toHaveBeenCalledExactlyOnceWith(0, ChestType.INFINITY_CHEST, true);

    // nothing delivers to it, or it is between two inserters and holds the line: no warning
    for (const inserters of [[], [into, out]]) {
        rerender(alert(chest, inserters));
        expect(container.firstChild).toBeNull();
    }
});

it('offers an enable-removal fix on the existing infinity chest with its own icon', async () => {
    // left out, as in an imported build that lacks it
    const chest = infinityChest(7, { remove_unfiltered_items: undefined });
    const onEnableRemoval = vi.fn();
    const { user, container, rerender } = show(alert(chest, [into], { onEnableRemoval }));
    const issue = screen.getByRole('group', { name: 'Chest 7 needs output removal enabled' });
    // the target a link to the issue moves the focus to
    expect(document.getElementById(validationIssueElementId('chest:7:removal-disabled'))).toBe(issue);
    expect(within(issue).getByText(/^An inserter already delivers to this infinity chest/)).toBeDefined();
    expect(pictures(issue)).toEqual(['/icons/infinity-chest.png']);
    await user.click(within(issue).getByRole('button', { name: 'Enable Remove unfiltered items for Chest 7' }));
    expect(onEnableRemoval).toHaveBeenCalledExactlyOnceWith(0);

    rerender(alert({ ...chest, remove_unfiltered_items: true }, [into]));
    expect(container.firstChild).toBeNull();
});
