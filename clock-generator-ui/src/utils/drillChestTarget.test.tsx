import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigSchema, type Config } from 'clock-generator/browser';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
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

it("shows a drill's container in the one Target picker, with its icon and the ore it holds", () => {
    const form = configToFormData(config);
    const html = renderToStaticMarkup(<DrillsForm drills={form.drills!.configs} resourceNames={['iron-ore']}
        machines={form.machines} belts={form.belts} chests={form.chests} inserters={form.inserters}
        onAdd={() => { }} onUpdate={() => { }} onRemove={() => { }} onReorder={() => { }} onDuplicate={() => { }} />);
    expect(html).toContain('aria-label="Target, Drill 1"');
    expect(html).toContain('value="Car 1 - iron-ore"');
    expect(html).toContain('/icons/car.png');
    expect(html).not.toMatch(/readonly/i);
    expect(html).not.toContain('Target chest');
    expect(html).not.toContain('Target machine');
});

it('marks an unset target', () => {
    const form = removeChest(configToFormData(config), 0);
    const html = renderToStaticMarkup(<DrillsForm drills={form.drills!.configs} resourceNames={['iron-ore']}
        machines={form.machines} belts={form.belts} chests={form.chests} inserters={form.inserters}
        onAdd={() => { }} onUpdate={() => { }} onRemove={() => { }} onReorder={() => { }} onDuplicate={() => { }} />);
    expect(html).toMatch(/aria-invalid="true"[^>]*aria-label="Target, Drill 1"|aria-label="Target, Drill 1"[^>]*aria-invalid="true"/);
});

it('unsets the target of a drill whose chest is removed, and keeps it on a machine removed', () => {
    const form = configToFormData(config);
    expect(removeMachine(form, 0).drills!.configs[0].target).toEqual({ type: 'chest', id: 1 });
    expect(removeChest(form, 0).drills!.configs[0].target).toEqual({ type: 'chest', id: 0 });
    expect(removalMessage(form, 'chests', 0)).toBe('Deleted Car 1. Inserter 1 has no Source now. Drill 1 has no Target now.');
});
