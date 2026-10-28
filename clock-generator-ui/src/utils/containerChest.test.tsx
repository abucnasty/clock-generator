// @vitest-environment happy-dom
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, validateConfig, type Config } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { addChest, switchedChest, updateChest } from './configForm/edits';
import type { ChestFormData, ConfigFormData } from './configForm/formData';
import { readConfigFile, readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { decodeShareLink, encodeShareLink, readShareHash } from './shareLink';
import { containerChest, show } from '../test/fixtures';
import { ChestFields } from '../components/EntityFields';
import { paintSlotFilters, slotCountsText } from './containerSlotFilters';
import { chestLabel } from './entityLabel';
import { qualityLabel } from './machinePrototype';

FactorioDataService.initialize(JSON.parse(factorioData));

/** Plates from an infinity chest into the container, from it into an assembler making gears, and out to a disposal chest */
function build(container: Record<string, unknown>): Config {
    return {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 5, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 3.125, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'chest', id: 10 }, sink: { type: 'chest', id: 1 }, stack_size: 16, filters: ['iron-plate'] },
            { id: 2, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 16 },
            { id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 2 }, stack_size: 16 },
        ],
        belts: [],
        chests: [
            { id: 1, ...container } as NonNullable<Config['chests']>[number],
            { type: ChestType.INFINITY_CHEST, id: 2, item_filter: [], remove_unfiltered_items: true },
            { type: ChestType.INFINITY_CHEST, id: 10, item_filter: [{ item_name: 'iron-plate', request_count: 200 }] },
        ],
    };
}

const CONTAINERS = {
    car: { type: ChestType.CAR, slot_filters: [{ slot: 1, item: 'iron-plate' }, { slot: 2, item: 'copper-plate' }], contents: [{ slot: 3, item: 'coal', count: 50 }] },
    tank: { type: ChestType.TANK, contents: [{ slot: 80, item: 'iron-plate', count: 100 }] },
    wagon: { type: ChestType.CARGO_WAGON, quality: 'legendary', slot_filters: [{ slot: 100, item: 'iron-plate' }] },
    silo: { type: ChestType.ROCKET_SILO, recipe_quality: 'rare', crafting_speed: 2.5, productivity: 10, contents: [{ item: 'iron-plate', count: 100 }] },
    blockedCar: { type: ChestType.CAR, slot_filters: [{ slot: 1, item: 'iron-plate' }, { slot: 2, blocked: true }, { slot: 3, blocked: true }] },
};

const containerOf = (form: ConfigFormData) => form.chests[0];
const formChest = (container: Record<string, unknown>) => containerOf(configToFormData(build(container)));

describe('cars, tanks, cargo wagons and rocket silos in the form', () => {
    it.each(Object.entries(CONTAINERS))('saves a %s as the config gives it, through config files, saved builds and share links', async (_name, container) => {
        const config = build(container);
        expect(ConfigSchema.parse(config)).toEqual(config);
        expect((readConfigFile(JSON.stringify(config)) as Config).chests![0]).toMatchObject({ id: 1, ...container });
        const saved = readSavedConfig(serializeConfig(configToFormData(config)))!;
        expect(formDataToConfig(saved)).toEqual(config);
        expect(JSON.stringify(formDataToConfig(saved).chests![0])).toBe(JSON.stringify({ id: 1, ...container }));
        const link = readShareHash(new URL(await encodeShareLink({ name: 'Container', config }, 'https://example.com/')).hash);
        if (link.kind !== 'link') throw new Error('not a share link');
        const shared = await decodeShareLink(link);
        if (shared.kind !== 'build') throw new Error('not a build');
        expect(shared.config).toEqual(config);
    });

    it.each([ChestType.CAR, ChestType.TANK, ChestType.CARGO_WAGON, ChestType.ROCKET_SILO])('adds a %s that the generator takes', type => {
        const form = addChest({ ...configToFormData(build(CONTAINERS.car)), chests: [] }, type);
        expect(formDataToConfig(form).chests).toEqual([{ id: 1, type }]);
        const config = { ...build(CONTAINERS.car), chests: [...formDataToConfig(form).chests!, ...build(CONTAINERS.car).chests!.slice(1)] };
        expect(() => validateConfig(ConfigSchema.parse(config))).not.toThrow();
    });

    it('leaves out rows without an item and fields left unset, and keeps the rows the player filled in', () => {
        let form = configToFormData(build({ type: ChestType.CAR }));
        form = updateChest(form, 0, { slot_filters: [{ slot: 1, item: '' }, { slot: 2, item: 'iron-plate' }], contents: [{ slot: 3, item: '', count: 1 }] } as Partial<ChestFormData>);
        expect(formDataToConfig(form).chests![0]).toEqual({ id: 1, type: ChestType.CAR, slot_filters: [{ slot: 2, item: 'iron-plate' }], contents: [] });
        let silo = configToFormData(build(CONTAINERS.silo));
        silo = updateChest(silo, 0, { crafting_speed: undefined, productivity: undefined } as Partial<ChestFormData>);
        expect(Object.keys(formDataToConfig(silo).chests![0]).sort()).toEqual(['contents', 'id', 'recipe_quality', 'type']);
    });

    it('lets the generator say what is wrong with a slot, unchanged by the form', () => {
        const form = configToFormData(build({ type: ChestType.CAR, contents: [{ slot: 81, item: 'iron-plate', count: 10 }] }));
        expect(() => validateConfig(ConfigSchema.parse(formDataToConfig(form)))).toThrow('contents in slot 81, past its 80 slots');
        const refused = ConfigSchema.safeParse({ ...build(CONTAINERS.silo), chests: [{ ...CONTAINERS.silo, id: 1, storage_size: 4 }] });
        expect(refused.success).toBe(false);
        expect(refused.error?.issues[0].message).toContain('`storage_size` is refused on a car, a tank, a cargo wagon or a rocket silo');
    });
});

describe('switching chest types', () => {
    it('keeps the slot filters and contents from a car to a tank or a wagon, and the wagon quality back from a car', () => {
        const car = formChest(CONTAINERS.car);
        const wagon = switchedChest(car, ChestType.CARGO_WAGON);
        expect(wagon).toMatchObject({ type: ChestType.CARGO_WAGON, slot_filters: CONTAINERS.car.slot_filters, contents: CONTAINERS.car.contents });
        const legendary = { ...wagon, quality: 'legendary' } as ChestFormData;
        const tank = switchedChest(legendary, ChestType.TANK);
        expect(tank).not.toHaveProperty('quality');
        expect(switchedChest(tank, ChestType.CARGO_WAGON)).toMatchObject({ quality: 'legendary', slot_filters: CONTAINERS.car.slot_filters });
    });

    it('keeps a silo\'s settings and a buffer chest\'s through a switch to the other and back', () => {
        const silo = formChest(CONTAINERS.silo);
        const buffer = switchedChest(silo, ChestType.BUFFER_CHEST);
        expect(buffer).toMatchObject({ type: ChestType.BUFFER_CHEST, storage_size: 1, item_filter: '' });
        const filled = { ...buffer, item_filter: 'iron-plate', storage_size: 8 } as ChestFormData;
        const back = switchedChest(filled, ChestType.ROCKET_SILO);
        const { _chest_settings: _memory, _uuid: _id, ...fields } = back;
        void _memory; void _id;
        expect(fields).toEqual({ id: 1, ...CONTAINERS.silo });
        expect(switchedChest(back, ChestType.BUFFER_CHEST)).toMatchObject({ item_filter: 'iron-plate', storage_size: 8 });
        const infinity = switchedChest(back, ChestType.INFINITY_CHEST);
        expect(infinity).toMatchObject({ type: ChestType.INFINITY_CHEST, item_filter: [{ item_name: 'iron-plate', request_count: 1 }] });
    });

    it('saves none of what it remembers', () => {
        const switched = switchedChest(switchedChest(formChest(CONTAINERS.car), ChestType.ROCKET_SILO), ChestType.CAR);
        const config = formDataToConfig({ ...configToFormData(build(CONTAINERS.car)), chests: [switched] });
        expect(config.chests).toEqual([{ id: 1, ...CONTAINERS.car }]);
    });
});

describe('the fields of each type', () => {
    const showFields = (chest: ChestFormData, dialog = false, onChange = vi.fn()) =>
        ({ ...show(<ChestFields chest={chest} itemNames={['iron-plate', 'coal']} dialog={dialog} onChange={onChange} onSwitchType={vi.fn()} />), onChange });
    const slots = () => screen.getAllByRole('button', { name: /^Slot \d+: / });

    it.each([
        { type: 'car', items: ['coal'], quality: [] },
        { type: 'tank', items: ['iron-plate'], quality: [] },
        { type: 'wagon', items: [], quality: [qualityLabel('legendary')] },
    ] as const)('offers slot filters and contents on a $type, and the quality of a wagon only', ({ type, items, quality }) => {
        const chest = formChest(CONTAINERS[type]), name = chestLabel(chest);
        showFields(chest);
        expect(screen.getByRole('group', { name: `Filtered slots, ${name}` }).textContent).toMatch(/^Filtered slots.*Shift \+ right-click copies/);
        expect(screen.getByRole('button', { name: 'Fill unfiltered slots' })).toBeDefined();
        expect(screen.getByRole('group', { name: 'Contents' })).toBeDefined();
        expect(screen.queryAllByRole<HTMLInputElement>('combobox', { name: `Item of contents 1, ${name}` }).map(field => field.value)).toEqual(items);
        expect(screen.queryAllByRole('combobox', { name: `Quality, ${name}` }).map(field => field.textContent)).toEqual(quality);
    });

    it('offers a silo its recipe quality, crafting speed, productivity and contents, without slot filters', () => {
        const chest = formChest(CONTAINERS.silo);
        showFields(chest, true);
        expect(screen.getByRole('combobox', { name: `Recipe quality, ${chestLabel(chest)}` }).textContent).toBe(qualityLabel('rare'));
        expect(['Crafting Speed', 'Productivity (%)'].map(name => screen.getByRole<HTMLInputElement>('textbox', { name }).value)).toEqual(['2.5', '10']);
        expect(screen.getByRole('button', { name: 'Add contents' })).toBeDefined();
        expect(screen.queryByText('Filtered slots')).toBeNull();
    });

    it('shows the whole inventory and keeps filters beyond a downgraded wagon visible for correction', async () => {
        const { unmount } = showFields(formChest(CONTAINERS.car));
        expect(slots()).toHaveLength(80);
        expect(slots().at(-1)).toBe(screen.getByRole('button', { name: 'Slot 80: Unfiltered' }));
        unmount();

        const { user, onChange } = showFields(formChest({ ...CONTAINERS.wagon, quality: 'normal' }));
        expect(slots()).toHaveLength(40);
        expect(slots().at(-1)).toBe(screen.getByRole('button', { name: 'Slot 40: Unfiltered' }));
        expect(screen.getByText(/^Some filters are outside this inventory/)).toBeDefined();
        await user.click(screen.getByRole('button', { name: 'Remove filter for slot 100' }));
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ slot_filters: [] });
    });

    it('says nothing of unfiltered slots when every slot is filtered or blocked', () => {
        showFields(containerChest(1, ChestType.CAR, { slot_filters: [...Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, item: 'iron-plate' })),
            ...Array.from({ length: 75 }, (_, i) => ({ slot: i + 6, blocked: true as const }))] }));
        expect(screen.getByText(slotCountsText({ filtered: 5, blocked: 75, free: 0 }))).toBeDefined();
        expect(screen.queryByText(/Unfiltered slots accept any item/)).toBeNull();
    });

    it('shows a slot blocked in the config as No item, and offers a way to block the remaining slots', async () => {
        const chest = formChest(CONTAINERS.blockedCar);
        const { user, onChange, announce } = showFields(chest);
        expect(slots().slice(1, 3)).toEqual(['Slot 2: Blocked (no-item)', 'Slot 3: Blocked (no-item)'].map(name => screen.getByRole('button', { name })));
        expect(screen.getByText(`${slotCountsText({ filtered: 1, blocked: 2, free: 77 })} · Unfiltered slots accept any item`)).toBeDefined();
        // the game draws no number in an empty slot's corner, and a filter faded
        expect(slots().map(slot => slot.textContent).join('')).toBe('');
        expect(getComputedStyle(slots()[0].firstElementChild!).opacity).toBe('0.45');
        expect(screen.getByText(/Middle-click a slot to set its filter, as in the game\./)).toBeDefined();
        await user.click(screen.getByRole('button', { name: 'Block unfiltered slots' }));
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ slot_filters: [...CONTAINERS.blockedCar.slot_filters,
            ...Array.from({ length: 77 }, (_, i) => ({ slot: i + 4, blocked: true, _marker: 'no-item' }))] });
        expect(announce).toHaveBeenCalledWith(`Set no-item on 77 slots, ${chestLabel(chest)}.`);
        expect(() => validateConfig(ConfigSchema.parse(build(CONTAINERS.blockedCar)))).not.toThrow();
    });

    it('keeps the marker painted on a blocked slot in the form and saved builds, and saves it as blocked: true', () => {
        const car = formChest(CONTAINERS.car);
        if (car.type !== ChestType.CAR) throw new Error('not a car');
        const painted = { ...car, slot_filters: paintSlotFilters(paintSlotFilters(car.slot_filters ?? [], [2], 'deconstruction-planner'), [3], 'no-item') };
        showFields(painted);
        expect(screen.getByRole('button', { name: 'Slot 2: Blocked (deconstruction-planner)' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Slot 3: Blocked (no-item)' })).toBeDefined();
        const saved = readSavedConfig(serializeConfig({ ...configToFormData(build(CONTAINERS.car)), chests: [painted] }))!;
        expect(containerOf(saved)).toMatchObject({ slot_filters: [{ slot: 1, item: 'iron-plate' }, { slot: 2, blocked: true, _marker: 'deconstruction-planner' }, { slot: 3, blocked: true, _marker: 'no-item' }] });
        expect(formDataToConfig(saved).chests![0]).toEqual({ ...build(CONTAINERS.car).chests![0],
            slot_filters: [{ slot: 1, item: 'iron-plate' }, { slot: 2, blocked: true }, { slot: 3, blocked: true }] });
    });

    it('reads a saved build or config that names a marker as a slot item as a blocked slot, keeping the marker', () => {
        const drafted = build({ type: ChestType.CAR, slot_filters: [{ slot: 1, item: 'iron-plate' }, { slot: 2, item: 'deconstruction-planner' }, { slot: 3, item: 'no-item' }] });
        const expected = [{ slot: 1, item: 'iron-plate' }, { slot: 2, blocked: true, _marker: 'deconstruction-planner' }, { slot: 3, blocked: true, _marker: 'no-item' }];
        expect(containerOf(configToFormData(drafted))).toMatchObject({ slot_filters: expected });
        expect(containerOf(readSavedConfig(JSON.stringify({ ...drafted, chests: drafted.chests!.map(chest => ({ ...chest, _uuid: 'x' })) }))!)).toMatchObject({ slot_filters: expected });
        showFields(formChest(drafted.chests![0]));
        expect(screen.getByRole('button', { name: 'Slot 2: Blocked (deconstruction-planner)' })).toBeDefined();
        expect(formDataToConfig(configToFormData(drafted)).chests![0]).toEqual(build(CONTAINERS.blockedCar).chests![0]);
        expect(ConfigSchema.parse(drafted).chests![0]).toEqual(build(CONTAINERS.blockedCar).chests![0]);
    });
});
