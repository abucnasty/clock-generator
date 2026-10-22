import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigSchema, type Config } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { parseFormConfig } from '../worker/formConfig';
import { inferInserterItems } from './inferInserterItems';
import { entityOptionsOf } from './inserterOptions';
import { switchedChest } from './configForm/edits';
import { encodeShareLink, decodeShareLink, readShareHash } from './shareLink';
import { configKeyOf } from './resultsStaleness';
import { InfinityChestSettings } from '../components/InfinityChestSettings';
import { buildFlowGraph } from './buildFlowGraph';

const config: Config = {
    target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
    belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] }],
    inserters: [{ id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 4 }],
    chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
};

it('retains empty disposal filters and the removal switch through import, saved builds, export and share links', async () => {
    const form = configToFormData(config), saved = readSavedConfig(serializeConfig(form))!;
    expect(formDataToConfig(saved)).toEqual(config);
    expect(ConfigSchema.parse(formDataToConfig(saved))).toEqual(config);
    const link = readShareHash(new URL(await encodeShareLink({ name: 'Disposal', config }, 'https://example.com/')).hash);
    expect(link.kind).toBe('link');
    if (link.kind === 'link') {
        const result = await decodeShareLink(link);
        expect(result.kind).toBe('build');
        if (result.kind === 'build') expect(result.config).toEqual(config);
    }
});

it('keeps an unchecked empty chest as an editable saved draft while strict simulation validation explains how to fix it', () => {
    const draft = { ...config, chests: [{ ...config.chests![0], remove_unfiltered_items: false }] };
    expect(ConfigSchema.safeParse(draft).success).toBe(false);
    expect(parseFormConfig(ConfigSchema, draft).success).toBe(true);
    const form = configToFormData(draft);
    expect(formDataToConfig(readSavedConfig(serializeConfig(form))!)).toEqual(draft);
    expect(configKeyOf(draft)).not.toBe(configKeyOf(config));
});

it('infers incoming items for disposal without inferring an arbitrary outgoing supply', () => {
    const form = configToFormData(config), route = form.inserters[0];
    expect(inferInserterItems(route, form.machines, form.belts, form.chests)).toEqual(['iron-gear-wheel']);
    expect(inferInserterItems({ ...route, source: route.sink, sink: { type: 'belt', id: 1 } }, form.machines, form.belts, form.chests)).toEqual([]);
    expect(entityOptionsOf(form.machines, form.belts, form.chests, { item: id => id, recipe: id => id }).find(option => option.type === 'chest')?.sublabel).toBe('Removes all incoming items');
    const graph = buildFlowGraph(form.machines, form.inserters, form.belts, form.chests);
    expect(graph.nodes.find(node => node.id === 'chest-1')?.data.sublabel).toBe('Removes all incoming items');
});

it('remembers the removal switch through chest type changes without losing the previous buffer item', () => {
    const form = configToFormData(config);
    const buffer = switchedChest(form.chests[0], ChestType.BUFFER_CHEST);
    const restored = switchedChest(buffer, ChestType.INFINITY_CHEST);
    expect(restored).toMatchObject({ item_filter: [], remove_unfiltered_items: true });
    const oldBuffer = { id: 2, _uuid: 'chest-2', type: ChestType.BUFFER_CHEST, item_filter: 'iron-plate', storage_size: 48 } as const;
    expect(switchedChest(switchedChest(oldBuffer, ChestType.INFINITY_CHEST, true), ChestType.BUFFER_CHEST)).toMatchObject(oldBuffer);
});

it('keeps the shared editor focused on controls without repeating the category explanation', () => {
    const form = configToFormData(config), chest = form.chests[0];
    if (chest.type !== ChestType.INFINITY_CHEST) throw new Error('not an infinity chest');
    const render = (filters: typeof chest.item_filter, remove = true) => renderToStaticMarkup(
        <InfinityChestSettings chest={{ ...chest, item_filter: filters, remove_unfiltered_items: remove }} onChange={() => {}} />);
    expect(render([])).toContain('Also remove unfiltered items');
    const filters = [{ item_name: 'iron-plate', request_count: 100 }];
    expect(render(filters, false)).not.toContain('Maintains configured stock');
    expect(render(filters, false)).not.toContain('aria-haspopup="dialog"');
    expect(render(filters)).toContain('Also remove unfiltered items');
});

it('normalizes omitted filters and strips empty UI slots without losing the disposal switch', () => {
    const parsed = ConfigSchema.parse({ ...config, chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }] });
    expect((parsed.chests![0] as { item_filter: unknown }).item_filter).toEqual([]);
    const form = configToFormData(parsed);
    form.chests[0] = { ...form.chests[0], type: 'infinity-chest', item_filter: [{ item_name: '', request_count: 1 }] };
    expect(formDataToConfig(form).chests![0]).toEqual({ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true });
});
