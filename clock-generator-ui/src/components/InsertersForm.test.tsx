// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { belt, infinityChest, inserter, machine, show } from '../test/fixtures';
import type { InserterFormData } from '../utils/configForm/formData';
import { describeEnableRule } from '../utils/enableRuleLabel';
import { BLACKLIST_NOTE } from '../utils/inserterFilters';
import { DROP_ROUTE_READ_ONLY } from '../utils/inserterMetadata';
import { InsertersForm } from './InsertersForm';

const base = inserter(2, { filters: ['iron-plate', 'copper-plate'] });
// two items on its lanes, so an inserter taking from it has a pickup type and a nearest lane
const mixedBelt = belt(1, { lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'copper-plate', stack_size: 4 }] });
const showForm = (fields: Partial<InserterFormData> = {}) => show(<InsertersForm inserters={[{ ...base, ...fields }]} machines={[machine()]}
    belts={[mixedBelt]} chests={[infinityChest()]} itemNames={['iron-plate', 'copper-plate', 'iron-gear-wheel']} getRecipeInfo={() => null}
    onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} onReorder={vi.fn()} onDuplicate={vi.fn()} onBulkUpdate={vi.fn()} />);
const route = (side: 'Source' | 'Destination') => screen.getByRole<HTMLInputElement>('combobox', { name: `${side}, Inserter 2` });
const slots = () => within(screen.getByRole('group', { name: 'Inserter filter slots' }));
const slotNames = () => slots().getAllByRole('button').map(slot => slot.getAttribute('aria-label'));
const slotPictures = () => slots().queryAllByRole('presentation').map(picture => picture.getAttribute('src'));
const useAutomatic = () => screen.queryByRole('button', { name: 'Use automatic filters' });

it('shows the editable source → five filter slots → destination workbench without a Routes/Filters toggle', () => {
    showForm();
    expect([route('Source').readOnly, route('Destination').readOnly]).toEqual([false, false]);
    expect(slotNames()).toHaveLength(5);
    expect(screen.queryByRole('group', { name: 'Inserter view' })).toBeNull();
    for (const toggle of [/Routes$/, /Filters$/]) expect(screen.queryByText(toggle)).toBeNull();
});

it.each([
    { mode: 'automatic', filters: undefined, slots: ['Add filter 1', 'Add filter 2', 'Add filter 3', 'Add filter 4', 'Add filter 5'], pictures: [], explicit: false },
    { mode: 'explicit', filters: ['iron-plate', 'copper-plate'], slots: ['Filter 1: iron-plate', 'Filter 2: copper-plate', 'Add filter 3', 'Add filter 4', 'Add filter 5'],
        pictures: ['/icons/iron-plate.png', '/icons/copper-plate.png'], explicit: true },
])('shows $mode filters in their slots, with the way back to automatic only when explicit', ({ filters, slots, pictures, explicit }) => {
    showForm({ filters });
    expect(slotNames()).toEqual(slots);
    expect(slotPictures()).toEqual(pictures);
    // nothing to infer from a machine without recipe data
    expect([screen.queryByText('No items inferred. Choose an item to set an explicit filter.'), useAutomatic()].map(Boolean)).toEqual([!explicit, explicit]);
    expect(screen.queryByText('Filters · Explicit')).toBeNull();
});

it('explains that captured blacklists are unsupported', () => {
    showForm({ filter_mode: 'blacklist' });
    expect(screen.getByText(BLACKLIST_NOTE)).toBeDefined();
});

it('keeps an imported drop destination read-only', () => {
    showForm({ sink: { ...base.sink, drop: { lane: 1, position: 0.5 } } } as Partial<InserterFormData>);
    expect([route('Source').readOnly, route('Destination').readOnly]).toEqual([true, true]);
    expect(screen.getByText(`Drop: lane 1, position 0.5. ${DROP_ROUTE_READ_ONLY}`)).toBeDefined();
});

it('keeps advanced stack settings out of the default workbench view, in Entity details', async () => {
    const { user } = showForm({ source: { type: 'belt', id: 1 } });
    const advanced = () => [screen.queryByRole('textbox', { name: 'Stack size' }), screen.queryByRole('combobox', { name: 'Picks up from, Inserter 2' }),
        screen.queryByRole('combobox', { name: 'Nearest lane of the belt, Inserter 2' })];
    expect(advanced()).toEqual([null, null, null]);
    await user.click(screen.getByRole('button', { name: 'Entity details for Inserter 2' }));
    expect(advanced()).not.toContain(null);
});

it.each([
    { stack: 'automatic', stack_size: undefined, shown: 16 },
    { stack: 'overridden', stack_size: 1, shown: 1 },
])('shows only the effective $stack stack size in the row summary', ({ stack_size, shown }) => {
    showForm({ stack_size });
    expect(screen.getByText(/^Stack /).textContent).toBe(`Stack ${shown} · ${describeEnableRule(undefined).chip}`);
    expect(document.body.textContent).not.toMatch(/\((automatic|explicit)\)/);
});

it('keeps every imported filter editable when a legacy list exceeds five slots', () => {
    const filters = ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'battery', 'stone', 'coal'];
    showForm({ filters });
    // one slot each, and none to add a seventh
    expect(slotNames()).toEqual(filters.map((item, index) => `Filter ${index + 1}: ${item}`));
    expect(slotPictures()).toEqual(filters.map(item => `/icons/${item}.png`));
});

it('retains unavailable endpoint identities in the editable route', () => {
    showForm({ source: { type: 'machine', id: 99 }, sink: { type: 'chest', id: 98 } });
    expect([route('Source').getAttribute('aria-invalid'), route('Destination').getAttribute('aria-invalid')]).toEqual(['true', 'true']);
    expect(screen.getByText('Machine 99 is unavailable.')).toBeDefined();
    expect(screen.getByText('Chest 98 is unavailable.')).toBeDefined();
    expect(useAutomatic()).not.toBeNull();
});
