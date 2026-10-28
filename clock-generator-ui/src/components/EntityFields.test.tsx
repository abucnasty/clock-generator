// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { belt as beltRow, bufferChest, infinityChest, machine as machineRow, show } from '../test/fixtures';
import { SELECT_NAMES } from '../utils/a11yLabels';
import { BeltLaneFields, BeltStrategyField, ChestFields, MachineSettingsFields } from './EntityFields';

const belt = beltRow(3, { strategy: 'export', lanes: [{ ingredient: 'iron-plate', stack_size: 8, consumption_per_second: 2 }] });
const field = (name: string) => screen.getByRole('textbox', { name });

it('keeps dialog machine edits within the draft whitelist and preserves numeric clear defaults', async () => {
    const machine = machineRow(1, { recipe: 'iron-plate', productivity: 25, crafting_speed: 3, prototype: 'biochamber' });
    const onChange = vi.fn();
    const { user, unmount } = show(<MachineSettingsFields machine={machine} dialog onChange={onChange} onPatch={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: 'Energy Consumption (%)' })).toBeNull();
    for (const name of ['Productivity (%)', 'Crafting Speed']) {
        await user.clear(field(name));
        await user.tab();
    }
    // a cleared field commits its default, and the dialog edits nothing else
    expect(new Set(onChange.mock.calls.map(call => call.join(' ')))).toEqual(new Set(['productivity 0', 'crafting_speed 1']));
    unmount();

    show(<MachineSettingsFields machine={machine} onChange={onChange} onPatch={vi.fn()} nutrients />);
    await user.clear(field('Energy Consumption (%)'));
    await user.click(field('Energy Consumption (%)'));
    await user.paste('-40');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('energy_consumption_bonus', -40);
    // no lower than the game allows
    await user.clear(field('Energy Consumption (%)'));
    await user.paste('-95');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('energy_consumption_bonus', -80);
    expect(machine.energy_consumption_bonus).toBeUndefined();
});

it('switches normal belts by removing external consumption without mutating the original lanes', async () => {
    const onChange = vi.fn();
    const { user } = show(<BeltStrategyField belt={belt} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: `${SELECT_NAMES.beltStrategy}, Belt 3` }));
    await user.click(screen.getByRole('option', { name: 'Normal' }));
    expect(onChange).toHaveBeenCalledWith({ strategy: undefined, lanes: [{ ingredient: 'iron-plate', stack_size: 8 }] });
    expect(belt.lanes[0].consumption_per_second).toBe(2);
});

it.each([false, true])('keeps imported lane geometry read-only while external consumption stays editable (dialog: %s)', async dialog => {
    const onChange = vi.fn();
    const { user } = show(<BeltLaneFields belt={belt} itemNames={[]} readOnly dialog={dialog} onChange={onChange} />);
    expect(screen.getAllByRole('textbox')).toEqual([field('Consumed /s')]);
    expect(screen.queryByRole('button', { name: /lane/i })).toBeNull();
    await user.clear(field('Consumed /s'));
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ lanes: [{ ingredient: 'iron-plate', stack_size: 8, consumption_per_second: undefined }] });
    expect(belt.lanes[0].consumption_per_second).toBe(2);
});

it.each([false, true])('preserves infinity stock zero and delegates type conversion to the caller (dialog: %s)', async dialog => {
    const chest = infinityChest(2, { item_filter: [{ item_name: 'iron-plate', request_count: 100 }] });
    const onChange = vi.fn(), onSwitchType = vi.fn();
    const { user } = show(<ChestFields chest={chest} itemNames={['iron-plate']} dialog={dialog} onChange={onChange} onSwitchType={onSwitchType} />);
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Buffer chest' }));
    expect(onSwitchType).toHaveBeenCalledWith(ChestType.BUFFER_CHEST);
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole('group', { name: 'Chest filters' })).getByRole('button', { name: /^Filter 1: iron-plate \(100\)/ }));
    const picker = screen.getByRole('dialog');
    const quantity = within(picker).getByRole('spinbutton');
    await user.clear(quantity);
    await user.type(quantity, '0');
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ item_filter: [{ item_name: 'iron-plate', request_count: 0 }] });
    expect(chest.item_filter[0].request_count).toBe(100);
    expect(chest.remove_unfiltered_items).toBe(true);
});

it('keeps buffer storage clear fallback and filter edits independent', async () => {
    const chest = bufferChest(2, { item_filter: 'iron-plate', storage_size: 8 });
    const onChange = vi.fn();
    const { user } = show(<ChestFields chest={chest} itemNames={[]} onChange={onChange} onSwitchType={vi.fn()} />);
    await user.clear(screen.getByRole('spinbutton'));
    expect(onChange).toHaveBeenCalledWith({ storage_size: 1 });
    expect(chest.item_filter).toBe('iron-plate');
});
