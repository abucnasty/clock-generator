import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Checkbox, FormControlLabel } from '@mui/material';
import type { InserterFormData } from '../utils/configForm/formData';
import { NumberField } from './NumberField';
import { InserterStackSizeControl } from './InserterStackSizeControl';

const hooks = vi.hoisted(() => {
    let states: unknown[] = [], stateIndex = 0;
    return {
        reset() { states = []; stateIndex = 0; },
        begin() { stateIndex = 0; },
        react: {
            useState(initial: unknown) {
                const index = stateIndex++;
                if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
                return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(states[index]) : value; }];
            },
        },
    };
});

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks.react }));

type PropsView = Record<string, unknown> & { children?: ReactNode; control?: ReactNode };
type ElementView = { type: unknown; props: PropsView };
function elements(node: ReactNode): ElementView[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<PropsView>(node)) return [];
    return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}

type Value = Pick<InserterFormData, 'prototype' | 'stack_size'>;
const automatic: Value = { prototype: undefined, stack_size: undefined };
const Render = (value: Value = automatic, onChange = vi.fn()) => {
    hooks.begin();
    return { view: elements(InserterStackSizeControl({ value, label: 'Inserter 3', id: 'stack-3', onChange })), onChange };
};
const checkbox = (view: ElementView[]) => {
    const field = view.find(element => element.type === FormControlLabel)!;
    return field.props.control as ReactNode;
};
const checkboxElement = (view: ElementView[]) => elements(checkbox(view)).find(element => element.type === Checkbox)!;
const number = (view: ElementView[]) => view.find(element => element.type === NumberField)!;

beforeEach(() => hooks.reset());
afterEach(() => vi.restoreAllMocks());

it('renders automatic capacity unchecked with a disabled numeric field, and checks into the current capacity', () => {
    const { view, onChange } = Render();
    const toggle = checkboxElement(view);
    expect(toggle.props.checked).toBe(false);
    expect(toggle.props.slotProps).toEqual({ input: { 'aria-label': 'Override stack size, Inserter 3' } });
    expect(number(view).props).toMatchObject({ value: 16, disabled: true, id: 'stack-3' });
    (toggle.props.onChange as (_event: unknown, checked: boolean) => void)({}, true);
    expect(onChange).toHaveBeenCalledWith(16);
});

it('preserves the automatic capacity for other supported inserter types and existing explicit values', () => {
    expect(number(Render({ prototype: 'bulk-inserter', stack_size: undefined }).view).props.value).toBe(12);
    expect(number(Render({ prototype: 'fast-inserter', stack_size: undefined }).view).props.value).toBe(4);
    expect(number(Render({ prototype: 'bulk-inserter', stack_size: 16 }).view).props.value).toBe(16);
    expect(checkboxElement(Render({ prototype: 'bulk-inserter', stack_size: 16 }).view).props.checked).toBe(true);
});

it('turns off only from the checkbox and ignores a transient null while editing', () => {
    const onChange = vi.fn();
    const initial = Render({ prototype: undefined, stack_size: 16 }, onChange);
    (number(initial.view).props.onValueChange as (n: number | null) => void)(null);
    expect(onChange).not.toHaveBeenCalled();
    const empty = Render({ prototype: undefined, stack_size: 16 }, onChange);
    expect(number(empty.view).props).toMatchObject({ value: null, disabled: false });
    expect(checkboxElement(empty.view).props.checked).toBe(true);
    (number(empty.view).props.onValueChange as (n: number | null) => void)(7);
    expect(onChange).toHaveBeenCalledWith(7);

    const checked = checkboxElement(initial.view);
    (checked.props.onChange as (_event: unknown, checked: boolean) => void)({}, false);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it('restores a blank numeric draft on leaving the control without clearing the saved override', () => {
    const onChange = vi.fn();
    const value = { prototype: 'stack-inserter', stack_size: 16 };
    const initial = Render(value, onChange);
    (number(initial.view).props.onValueChange as (n: number | null) => void)(null);
    const empty = Render(value, onChange);
    (empty.view[0].props.onBlur as (event: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
    const restored = Render(value, onChange);
    expect(number(restored.view).props).toMatchObject({ value: 16, disabled: false });
    expect(checkboxElement(restored.view).props.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
});

it('allows an unknown capacity to be overridden without inventing an initial number', () => {
    const unknown: Value = { prototype: 'modded-inserter', stack_size: undefined };
    const first = Render(unknown);
    expect(checkboxElement(first.view).props.checked).toBe(false);
    expect(number(first.view).props).toMatchObject({ value: null, disabled: true, placeholder: 'Unavailable' });
    (checkboxElement(first.view).props.onChange as (_event: unknown, checked: boolean) => void)({}, true);
    expect(first.onChange).not.toHaveBeenCalled();

    const enabled = Render(unknown);
    expect(checkboxElement(enabled.view).props.checked).toBe(true);
    expect(number(enabled.view).props).toMatchObject({ value: null, disabled: false, placeholder: 'Unavailable' });
    (number(enabled.view).props.onValueChange as (n: number | null) => void)(null);
    expect(enabled.onChange).not.toHaveBeenCalled();
    (number(enabled.view).props.onValueChange as (n: number | null) => void)(5);
    expect(enabled.onChange).toHaveBeenCalledWith(5);
});

it('resets a locally enabled unknown control when the external model changes or clears', () => {
    const unknown: Value = { prototype: 'modded-inserter', stack_size: undefined };
    const first = Render(unknown);
    (checkboxElement(first.view).props.onChange as (_event: unknown, checked: boolean) => void)({}, true);
    Render(unknown);
    const changed = Render({ prototype: 'fast-inserter', stack_size: undefined });
    const synchronized = Render({ prototype: 'fast-inserter', stack_size: undefined });
    expect(checkboxElement(synchronized.view).props.checked).toBe(false);
    expect(number(synchronized.view).props).toMatchObject({ value: 4, disabled: true });
    expect(changed.onChange).not.toHaveBeenCalled();

    const explicit = { prototype: 'fast-inserter', stack_size: 9 };
    Render(explicit);
    const cleared = Render({ prototype: 'fast-inserter', stack_size: undefined });
    const resynced = Render({ prototype: 'fast-inserter', stack_size: undefined });
    expect(checkboxElement(resynced.view).props.checked).toBe(false);
    expect(number(resynced.view).props).toMatchObject({ value: 4, disabled: true });
    expect(cleared.onChange).not.toHaveBeenCalled();
});
