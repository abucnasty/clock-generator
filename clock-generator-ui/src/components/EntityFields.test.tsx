import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { BeltLaneFields, BeltStrategyField, ChestFields, EntityTypeField, MachineSettingsFields } from './EntityFields';
import { ChestFilterSlotSelector } from './ChestFilterSlotSelector';
import { NumberField } from './NumberField';
import { Button, Select, TextField } from '@mui/material';
import type { BeltFormData, ChestFormData, MachineFormData } from '../hooks/useConfigForm';

vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ itemLabel: (value: string) => value }) }));

function fields(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
        ? [child, ...fields(child.props.children as ReactNode)] : []);
}
const belt: BeltFormData = { id: 3, _uuid: 'belt', type: 'turbo-transport-belt', strategy: 'export',
    lanes: [{ ingredient: 'iron-plate', stack_size: 8, consumption_per_second: 2 }] };

it('keeps dialog machine edits within the draft whitelist and preserves numeric clear defaults', () => {
    const machine: MachineFormData = { id: 1, _uuid: 'machine', recipe: 'iron-plate', productivity: 25, crafting_speed: 3, type: 'biochamber' };
    const onChange = vi.fn();
    const dialog = fields(MachineSettingsFields({ machine, dialog: true, onChange, onPatch: vi.fn() }));
    const numbers = dialog.filter(field => field.type === NumberField);
    expect(numbers.map(field => field.props.label)).toEqual(['Productivity (%)', 'Crafting Speed']);
    for (const field of numbers) (field.props.onValueChange as (value: null) => void)(null);
    expect(onChange.mock.calls).toEqual([['productivity', 0], ['crafting_speed', 1]]);
    const energy = fields(MachineSettingsFields({ machine, onChange, onPatch: vi.fn() })).find(field => field.props.label === 'Energy Consumption (%)')!;
    expect(energy.props.min).toBe(-80);
    (energy.props.onValueChange as (value: number) => void)(-40);
    expect(onChange).toHaveBeenLastCalledWith('energy_consumption_bonus', -40);
    expect(machine.energy_consumption_bonus).toBeUndefined();
});

it('switches normal belts by removing external consumption without mutating the original lanes', () => {
    const onChange = vi.fn();
    const select = fields(BeltStrategyField({ belt, onChange })).find(field => field.type === Select)!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: 'normal' } });
    expect(onChange).toHaveBeenCalledWith({ strategy: undefined, lanes: [{ ingredient: 'iron-plate', stack_size: 8 }] });
    expect(belt.lanes[0].consumption_per_second).toBe(2);
});

it.each([false, true])('keeps imported lane geometry read-only while external consumption stays editable (dialog: %s)', dialog => {
    const onChange = vi.fn();
    const locked = fields(BeltLaneFields({ belt, itemNames: [], readOnly: true, dialog, onChange }));
    const numbers = locked.filter(field => field.type === NumberField);
    expect(numbers.map(field => field.props.label)).toEqual(['Consumed /s']);
    expect(locked.some(field => field.type === Button)).toBe(false);
    (numbers[0].props.onValueChange as (value: null) => void)(null);
    expect(onChange).toHaveBeenCalledWith({ lanes: [{ ingredient: 'iron-plate', stack_size: 8, consumption_per_second: undefined }] });
    expect(belt.lanes[0].consumption_per_second).toBe(2);
});

it.each([false, true])('preserves infinity stock zero and delegates type conversion to the caller (dialog: %s)', dialog => {
    const chest: ChestFormData = { id: 2, _uuid: 'chest', type: ChestType.INFINITY_CHEST,
        item_filter: [{ item_name: 'iron-plate', request_count: 100 }], remove_unfiltered_items: true };
    const onChange = vi.fn(), onSwitchType = vi.fn();
    const controls = fields(ChestFields({ chest, itemNames: [], dialog, onChange, onSwitchType }));
    const type = controls.find(field => field.type === EntityTypeField)!;
    (type.props.onChange as (value: ChestType) => void)(ChestType.BUFFER_CHEST);
    expect(onSwitchType).toHaveBeenCalledWith(ChestType.BUFFER_CHEST);
    expect(onChange).not.toHaveBeenCalled();
    const slots = controls.find(field => field.type === ChestFilterSlotSelector)!;
    expect(slots.props.filters).toEqual([{ item_name: 'iron-plate', quantity: 100 }]);
    (slots.props.onFilterChange as (index: number, filter: unknown) => void)(0, { item_name: 'iron-plate', quantity: 0 });
    expect(onChange).toHaveBeenCalledWith({ item_filter: [{ item_name: 'iron-plate', request_count: 0 }] });
    expect(chest.item_filter[0].request_count).toBe(100);
    expect(chest.remove_unfiltered_items).toBe(true);
});

it('keeps buffer storage clear fallback and filter edits independent', () => {
    const chest: ChestFormData = { id: 2, _uuid: 'chest', type: ChestType.BUFFER_CHEST, item_filter: 'iron-plate', storage_size: 8 };
    const onChange = vi.fn();
    const size = fields(ChestFields({ chest, itemNames: [], onChange, onSwitchType: vi.fn() })).find(field => field.type === TextField)!;
    (size.props.onChange as (event: unknown) => void)({ target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ storage_size: 1 });
    expect(chest.item_filter).toBe('iron-plate');
});
