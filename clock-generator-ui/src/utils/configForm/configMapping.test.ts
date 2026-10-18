import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { configToFormData, formDataToConfig } from './configMapping';
import { planRepeatedUnitConversion } from 'clock-generator/browser';
import { applyRepeatedUnitConversion } from './repeatedUnitConversion';

const imported = {
    target_output: { recipe: 'electronic-circuit', items_per_second: 10, copies: 1 },
    machines: [
        { id: 1, recipe: 'copper-cable', productivity: 0, crafting_speed: 2 },
        { id: 2, recipe: 'electronic-circuit', productivity: 50, crafting_speed: 2, type: 'machine' },
    ],
    inserters: [
        { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 16 },
        {
            id: 5,
            source: { type: 'belt', id: 1, near_lane: 2, pickup_length: 0.5 },
            sink: { type: 'machine', id: 2 },
            stack_size: 16,
            filters: ['iron-plate'],
            overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 } },
        },
    ],
    belts: [
        { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] },
        { id: 2, type: 'turbo-transport-belt', strategy: 'export', lanes: [{ ingredient: 'electronic-circuit', stack_size: 4, consumption_per_second: 5 }] },
    ],
    chests: [
        { type: ChestType.BUFFER_CHEST, id: 1, storage_size: 2, item_filter: 'copper-plate' },
        { type: ChestType.INFINITY_CHEST, id: 2, item_filter: [{ item_name: 'copper-plate', request_count: 50 }] },
    ],
    drills: {
        mining_productivity_level: 2,
        configs: [{
            id: 1, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, target: { type: 'machine', id: 1 },
            overrides: { enable_control: { mode: 'NEVER' } },
        }],
    },
    overrides: { lcm: 60 },
} as unknown as Config;

describe('canonical repeated-unit form application', () => {
    it('retains source UUIDs and forced metadata through composite extraction and refuses an inconsistent payload', () => {
        const form = configToFormData({
            target_output: { recipe: 'iron-gear-wheel', items_per_second: 4, copies: 0.5 },
            machines: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, recipe: i < 4 ? 'iron-gear-wheel' : 'copper-cable', crafting_speed: 1, productivity: 0 })),
            belts: [
                { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }, { ingredient: 'copper-plate', stack_size: 1 }] },
                { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }, { ingredient: 'copper-cable', stack_size: 1 }] },
            ],
            inserters: Array.from({ length: 6 }, (_, i) => [
                { id: i * 2 + 1, source: { type: 'belt', id: 1, near_lane: i < 4 ? 1 : 2 }, sink: { type: 'machine', id: i + 1 },
                    overrides: { enable_control: { mode: 'ALWAYS' } }, filters: [i < 4 ? 'iron-plate' : 'copper-plate'] },
                { id: i * 2 + 2, source: { type: 'machine', id: i + 1 }, sink: { type: 'belt', id: 2 }, filters: [i < 4 ? 'iron-gear-wheel' : 'copper-cable'] },
            ]).flat(), chests: [], overrides: { ignored_lcm_ingredients: ['iron-plate', 'copper-plate'], backed_up_belts: false, loop_seed_items: 0 },
        } as Config);
        form.inserters[0]._forced_always = true;
        const before = structuredClone(form), plan = planRepeatedUnitConversion(formDataToConfig(form));
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        const next = applyRepeatedUnitConversion(form, plan)!;
        expect(next.machines.map(it => [it._uuid, it.id])).toEqual([0, 1, 4].map((index, i) => [form.machines[index]._uuid, i + 1]));
        expect(next.inserters[0]._forced_always).toBe(true);
        expect(next.inserters[4].source).toEqual({ ...form.inserters[8].source, id: 1 });
        expect(next.inserters[4].sink.id).toBe(3);
        expect(next.target_output).toEqual({ ...form.target_output, copies: 1 });
        expect(formDataToConfig(next)).toEqual(plan.candidate);
        const corrupted = structuredClone(plan);
        corrupted.candidate.machines[0].recipe = 'electronic-circuit';
        expect(applyRepeatedUnitConversion(form, corrupted)).toBeNull();
        const incorrectMap = structuredClone(plan);
        incorrectMap.retained.machines[2].sourceIndex = 5;
        expect(applyRepeatedUnitConversion(form, incorrectMap)).toBeNull();
        expect(applyRepeatedUnitConversion({ ...form, target_output: { ...form.target_output, items_per_second: 5 } }, plan)).toBeNull();
        expect(form).toEqual(before);
    });
});

describe('configToFormData', () => {
    it('gives every entity a uuid of its own', () => {
        const form = configToFormData(imported);
        const uuids = [...form.machines, ...form.inserters, ...form.belts, ...form.chests, ...form.drills!.configs].map((it) => it._uuid);
        expect(new Set(uuids).size).toBe(uuids.length);
    });

    it('numbers inserters without an id by their place', () => {
        expect(configToFormData(imported).inserters.map((ins) => ins.id)).toEqual([1, 5]);
    });

    it('maps the enable control overrides of inserters and drills', () => {
        const form = configToFormData(imported);
        expect(form.inserters[1].overrides).toEqual({
            animation: undefined,
            enable_control: { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 },
        });
        expect(form.drills!.configs[0].overrides).toEqual({ enable_control: { mode: 'NEVER' } });
    });

    it('fills in an empty rule set for a conditional override without one', () => {
        const config = {
            ...imported,
            inserters: [{ ...imported.inserters[0], overrides: { enable_control: { mode: 'CONDITIONAL' } } }],
        } as unknown as Config;
        expect(configToFormData(config).inserters[0].overrides!.enable_control).toEqual({
            mode: 'CONDITIONAL', rule_set: { operator: 'AND', rules: [] }, latch: undefined,
        });
    });

    it('treats a chest without a type as a buffer chest', () => {
        const config = { ...imported, chests: [{ id: 1, item_filter: 'copper-plate' }] } as unknown as Config;
        expect(configToFormData(config).chests).toEqual([
            { type: ChestType.BUFFER_CHEST, id: 1, _uuid: expect.any(String), storage_size: 1, item_filter: 'copper-plate' },
        ]);
    });
});

describe('formDataToConfig', () => {
    it('gives back the imported config without the uuids', () => {
        const config = formDataToConfig(configToFormData(imported));
        expect(JSON.stringify(config)).not.toContain('_uuid');
        expect(config.belts).toEqual(imported.belts);
        expect(config.chests).toEqual(imported.chests);
        expect(config.inserters[1]).toMatchObject(imported.inserters[1]);
        expect(config.drills).toMatchObject(imported.drills!);
        expect(config.overrides).toEqual(imported.overrides);
    });

    it('leaves out the forced flag of an inserter and keeps its ALWAYS rule', () => {
        const form = configToFormData(imported);
        form.inserters[0] = { ...form.inserters[0], overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true };
        const config = formDataToConfig(form);
        expect(JSON.stringify(config)).not.toContain('_forced_always');
        expect(config.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
    });
});

describe('configToFormData and the forced flag', () => {
    it('never flags an inserter, even one with an ALWAYS rule', () => {
        const always = {
            ...imported,
            inserters: imported.inserters.map((ins) => ({ ...ins, overrides: { enable_control: { mode: 'ALWAYS' } } })),
        } as unknown as Config;
        expect(configToFormData(always).inserters.some((ins) => '_forced_always' in ins)).toBe(false);
        expect(configToFormData(imported).inserters.some((ins) => '_forced_always' in ins)).toBe(false);
    });
});

describe('imported inserter metadata', () => {
    it.each([undefined, 8, 16])('preserves normal bulk type, quality and stack override %s through file round trips', stack_size => {
        const config: Config = { ...imported, inserters: [{ ...imported.inserters[0], prototype: 'bulk-inserter', quality: 'normal', stack_size }] };
        const form = configToFormData(config);
        const file = JSON.parse(JSON.stringify(formDataToConfig(form))) as Config;
        expect(file.inserters[0]).toMatchObject({ prototype: 'bulk-inserter', quality: 'normal' });
        expect(file.inserters[0].stack_size).toBe(stack_size);
        expect(Object.hasOwn(file.inserters[0], 'stack_size')).toBe(stack_size !== undefined);
        expect(configToFormData(file).inserters[0].stack_size).toBe(stack_size);
    });
});


it('preserves per-lane pickup supply through Sidecar/form/config round trips', () => {
    const config = structuredClone(imported);
    const source = config.inserters[1].source;
    if (source.type !== 'belt') throw new Error('expected belt');
    source.pickup_length = 1;
    source.near_lane = 1;
    source.pickup_supply = ['side-outer'];
    const roundTrip = formDataToConfig(configToFormData(config));
    expect(roundTrip.inserters[1].source).toMatchObject({pickup_length: 1, near_lane: 1, pickup_supply: ['side-outer']});
});

it('preserves two-stream merge ingredients and finite outlet geometry through form/config round trips', () => {
    const config = structuredClone(imported);
    const source = config.inserters[1].source;
    if (source.type !== 'belt') throw new Error('expected belt');
    source.pickup_length = 1;
    source.pickup_merge = {lane: 1, outer: {ingredient: 'iron-plate', stack_size: 4}, inner: {ingredient: 'copper-cable', stack_size: 4}, downstream_tiles: 3, outlet: 'open'};
    const restored = formDataToConfig(configToFormData(config));
    expect(restored.inserters[1].source).toMatchObject({pickup_merge: source.pickup_merge});
});
