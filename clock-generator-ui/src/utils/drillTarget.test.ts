import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, FactorioDataService, type Config } from 'clock-generator/browser';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { drillTargetOptions, ruleAllowsContainer } from './drillTarget';
import type { ConfigFormData, DrillFormData } from './configForm/formData';

FactorioDataService.initialize(JSON.parse(data));

const labels = { item: (id: string) => `<${id}>`, recipe: (id: string) => `[${id}]` };

// a furnace, a belt and one container of each kind; drill 1 drops into the car
const config: Config = {
    target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, prototype: 'electric-furnace' }],
    drills: { configs: [
        { id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 0, target: { type: 'chest', id: 2 } }] },
    belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] }],
    inserters: [
        { id: 1, source: { type: 'chest', id: 2 }, sink: { type: 'machine', id: 1 }, stack_size: 16 },
        { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 16 },
    ],
    chests: [
        { id: 1, type: 'buffer-chest', storage_size: 48, item_filter: 'iron-ore' },
        { id: 2, type: 'car' },
        { id: 3, type: 'tank' },
        { id: 4, type: 'cargo-wagon' },
        { id: 5, type: 'rocket-silo' },
        { id: 6, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true },
    ],
};

const buildOf = (form: ConfigFormData) => ({ machines: form.machines, belts: form.belts, chests: form.chests, inserters: form.inserters, drills: form.drills!.configs });
const optionsFor = (form: ConfigFormData, drill: DrillFormData) => drillTargetOptions(drill, buildOf(form), labels);

describe('the drill Target picker', () => {
    it("offers the build's machines and every container, with their icons, and no belt", () => {
        const form = configToFormData(config);
        const options = optionsFor(form, form.drills!.configs[0]);
        expect(options.map(option => [option.type, option.id, option.icon])).toEqual([
            ['machine', 1, 'electric-furnace'],
            ['chest', 1, 'steel-chest'], ['chest', 2, 'car'], ['chest', 3, 'tank'], ['chest', 4, 'cargo-wagon'],
            ['chest', 5, 'rocket-silo'], ['chest', 6, 'infinity-chest'],
        ]);
        expect(options[0]).toMatchObject({ label: 'Machine 1', sublabel: '[iron-plate]' });
        expect(options.every(option => option.disabledReason === undefined)).toBe(true);
    });

    it('names what the drills put into a container, as its items', () => {
        const form = configToFormData(config);
        const car = optionsFor(form, form.drills!.configs[0]).find(option => option.type === 'chest' && option.id === 2);
        expect(car).toMatchObject({ sublabel: '<iron-ore>', ingredientIcons: ['iron-ore'] });
    });

    it.each(['NEVER', 'CONDITIONAL'] as const)('does not offer a container to a drill whose rule is %s, but keeps its own target', mode => {
        const form = configToFormData(config);
        const drill: DrillFormData = { ...form.drills!.configs[0], overrides: { enable_control: mode === 'NEVER' ? { mode } : { mode, rules: { operator: 'AND', rules: [] } } } as DrillFormData['overrides'] };
        expect(ruleAllowsContainer(drill)).toBe(false);
        const options = optionsFor(form, drill);
        expect(options.filter(option => option.disabledReason).map(option => option.id)).toEqual([1, 3, 4, 5, 6]);
        expect(options.find(option => option.type === 'machine')?.disabledReason).toBeUndefined();
        expect(options.find(option => option.type === 'chest' && option.id === 3)?.disabledReason)
            .toBe(`Its rule is ${mode === 'NEVER' ? 'Never on' : 'Conditional'}; a drill into a container needs Auto, Clocked, Always on`);
    });

    it.each(['AUTO', 'CLOCKED', 'ALWAYS', undefined] as const)('offers every container to a drill whose rule is %s', mode => {
        const form = configToFormData(config);
        const drill = { ...form.drills!.configs[0], target: { type: 'machine' as const, id: 1 }, ...(mode && { overrides: { enable_control: { mode } } as DrillFormData['overrides'] }) };
        expect(ruleAllowsContainer(drill)).toBe(true);
        expect(optionsFor(form, drill).some(option => option.disabledReason)).toBe(false);
    });

    it.each([2, 3, 4, 5, 1])('turns a drill added by hand into one that drops into chest %i, which the config schema takes', id => {
        const form = configToFormData({ ...config, drills: { configs: [{ ...config.drills!.configs[0], target: { type: 'machine', id: 1 } }] } });
        const picked = optionsFor(form, form.drills!.configs[0]).find(option => option.type === 'chest' && option.id === id)!;
        const next = { ...form, drills: { configs: [{ ...form.drills!.configs[0], target: { type: picked.type, id: picked.id } }] } };
        expect(ConfigSchema.parse(formDataToConfig(next)).drills!.configs[0].target).toEqual({ type: 'chest', id });
    });
});

describe('a drill puts into a container the item its resource mines', () => {
    // the form names a drill's resource by the item it mines: true of every resource a drill can mine into a container
    it.each(FactorioDataService.getAllResourceNames().filter(name => FactorioDataService.getResourceOrThrow(name).minable.result !== undefined))('%s', name => {
        expect(FactorioDataService.getResourceOrThrow(name).minable.result).toBe(name);
    });
});
