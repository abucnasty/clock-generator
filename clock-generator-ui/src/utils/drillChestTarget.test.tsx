// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { ConfigSchema, type Config } from 'clock-generator/browser';
import { expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import type { ConfigFormData } from './configForm/formData';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { removeChest, removeMachine } from './configForm/edits';
import { removalMessage } from './undoSnapshot';
import { DrillsForm } from '../components/DrillsForm';

// a big mining drill dropping into a car, which two inserters empty into a furnace
const config: Config = {
    target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, prototype: 'electric-furnace' }],
    drills: { configs: [
        { id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 17.5, productivity: 80000, target: { type: 'chest', id: 1 } }] },
    belts: [],
    inserters: [{ id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 16 }],
    chests: [{ id: 1, type: 'car' }],
};

it("keeps a drill's chest target through the form and a saved build", () => {
    const form = configToFormData(config), saved = readSavedConfig(serializeConfig(form))!;
    expect(formDataToConfig(saved)).toEqual(config);
    expect(ConfigSchema.parse(formDataToConfig(saved))).toEqual(config);
});

const showDrills = (form: ConfigFormData, onUpdate = vi.fn()) => show(<DrillsForm drills={form.drills!.configs} resourceNames={['iron-ore']}
    machines={form.machines} belts={form.belts} chests={form.chests} inserters={form.inserters}
    onAdd={vi.fn()} onUpdate={onUpdate} onRemove={vi.fn()} onReorder={vi.fn()} onDuplicate={vi.fn()} />);
const target = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Drop target, Drill 1' });
// the icons are drawn for the eye; the field says what they show
const pictures = () => screen.queryAllByRole('presentation', { hidden: true }).map(picture => picture.getAttribute('src'));

it("shows a drill's container in the one Target picker, with its icon and the ore it holds", async () => {
    const onUpdate = vi.fn();
    const { user } = showDrills(configToFormData(config), onUpdate);
    expect(screen.getAllByRole('combobox', { name: /target/i })).toEqual([target()]);
    expect(target().value).toBe('Car 1 - iron-ore');
    expect(target().getAttribute('aria-invalid')).toBe('false');
    expect(pictures()).toContain('/icons/car.png');
    // a picker to choose from, not a fixed chest or machine
    expect(document.body.textContent).not.toMatch(/Target (chest|machine)/i);
    expect(screen.queryAllByLabelText(/Target (chest|machine)/i)).toEqual([]);
    expect(['textbox', 'combobox', 'spinbutton'].flatMap(role => screen.queryAllByRole<HTMLInputElement>(role)).filter(field => field.readOnly)).toEqual([]);
    await user.click(target());
    await user.click(screen.getByRole('option', { name: /^Machine 1/ }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(0, { target: { type: 'machine', id: 1 } });
});

it('marks an unset target', () => {
    showDrills(removeChest(configToFormData(config), 0));
    expect(target().value).toBe('');
    expect(target().getAttribute('aria-invalid')).toBe('true');
});

it('unsets the target of a drill whose chest is removed, and keeps it on a machine removed', () => {
    const form = configToFormData(config);
    expect(removeMachine(form, 0).drills!.configs[0].target).toEqual({ type: 'chest', id: 1 });
    expect(removeChest(form, 0).drills!.configs[0].target).toEqual({ type: 'chest', id: 0 });
    expect(removalMessage(form, 'chests', 0)).toBe('Deleted Car 1. Inserter 1 has no Source now. Drill 1 has no Target now.');
});
