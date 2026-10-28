// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { InserterFormData } from '../utils/configForm/formData';
import { InserterStackSizeControl } from './InserterStackSizeControl';

type Value = Pick<InserterFormData, 'prototype' | 'stack_size'>;
const automatic: Value = { prototype: undefined, stack_size: undefined };
const unknown: Value = { prototype: 'modded-inserter', stack_size: undefined };
const control = (value: Value, onChange = vi.fn()) =>
    <InserterStackSizeControl value={value} label="Inserter 3" id="stack-3" onChange={onChange} />;
function Render(value: Value = automatic) {
    const onChange = vi.fn();
    const view = render(control(value, onChange));
    return { ...view, onChange, user: userEvent.setup(), rerender: (next: Value) => view.rerender(control(next, onChange)) };
}
const checkbox = () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Override stack size, Inserter 3' });
const number = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Stack size' });
const shows = (checked: boolean, value: string, disabled: boolean) =>
    expect({ checked: checkbox().checked, value: number().value, disabled: number().disabled }).toEqual({ checked, value, disabled });

it('renders automatic capacity unchecked with a disabled numeric field, and checks into the current capacity', async () => {
    const { user, onChange } = Render();
    shows(false, '16', true);
    expect(number().id).toBe('stack-3');
    await user.click(checkbox());
    expect(onChange).toHaveBeenCalledWith(16);
});

it.each([
    ['bulk-inserter', undefined, '12'],
    ['fast-inserter', undefined, '4'],
    ['bulk-inserter', 16, '16'],
])('preserves the automatic capacity for other supported inserter types and existing explicit values: %s, stack size %s', (prototype, stack_size, shown) => {
    Render({ prototype, stack_size });
    shows(stack_size !== undefined, shown, stack_size === undefined);
});

it('turns off only from the checkbox and ignores a transient null while editing', async () => {
    const { user, onChange } = Render({ prototype: undefined, stack_size: 16 });
    await user.clear(number());
    expect(onChange).not.toHaveBeenCalled();
    shows(true, '', false);
    await user.type(number(), '7');
    expect(onChange).toHaveBeenCalledWith(7);

    await user.click(checkbox());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it('restores a blank numeric draft on leaving the control without clearing the saved override', async () => {
    const { user, onChange } = Render({ prototype: 'stack-inserter', stack_size: 16 });
    await user.clear(number());
    shows(true, '', false);
    await user.click(document.body);
    shows(true, '16', false);
    expect(onChange).not.toHaveBeenCalled();
});

it('allows an unknown capacity to be overridden without inventing an initial number', async () => {
    const { user, onChange } = Render(unknown);
    shows(false, '', true);
    expect(number().placeholder).toBe('Unavailable');
    await user.click(checkbox());
    expect(onChange).not.toHaveBeenCalled();

    shows(true, '', false);
    expect(number().placeholder).toBe('Unavailable');
    await user.type(number(), '5');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
    await user.clear(number());
    expect(onChange).toHaveBeenCalledOnce();
});

it('resets a locally enabled unknown control when the external model changes or clears', async () => {
    const { user, onChange, rerender } = Render(unknown);
    await user.click(checkbox());
    rerender({ prototype: 'fast-inserter', stack_size: undefined });
    shows(false, '4', true);
    expect(onChange).not.toHaveBeenCalled();

    rerender({ prototype: 'fast-inserter', stack_size: 9 });
    rerender({ prototype: 'fast-inserter', stack_size: undefined });
    shows(false, '4', true);
    expect(onChange).not.toHaveBeenCalled();
});
