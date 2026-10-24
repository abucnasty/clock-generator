import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { configToFormData, formDataToConfig } from './configMapping';
import { planRepeatedUnitConversion } from 'clock-generator/browser';
import { applyRepeatedUnitConversion } from './repeatedUnitConversion';
import { machineIconName } from './formData';

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
            source: { type: 'belt', id: 1, near_lane: 2, pickup_length: 0.5, pickup_layout: 'side-entrance' },
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
        configs: [{
            id: 1, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 20, target: { type: 'machine', id: 1 },
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

describe('the labels a config gives its machines and chests', () => {
    it('keeps a machine\'s prototype and qualities and a buffer chest\'s prototype through the form', () => {
        const labelled = {
            ...imported,
            machines: [{ id: 1, recipe: 'iron-plate', productivity: 0, crafting_speed: 2, prototype: 'electric-furnace', quality: 'legendary', recipe_quality: 'normal' }],
            chests: [{ type: ChestType.BUFFER_CHEST, id: 1, storage_size: 2, item_filter: 'copper-plate', prototype: 'steel-chest' }],
        } as unknown as Config;
        const config = formDataToConfig(configToFormData(labelled));
        expect(config.machines).toEqual(labelled.machines);
        expect(config.chests).toEqual(labelled.chests);
    });

    it('keeps where the inserters, drills, machines and chests stand, and the way inserters and drills face', () => {
        const at = { position: { x: 2.5, y: -1.5 } };
        const placed = {
            ...imported,
            machines: imported.machines.map(m => ({ ...m, ...at })),
            inserters: imported.inserters.map((ins, index) => ({ id: index + 1, ...ins, ...at, direction: 8 })),
            chests: [...imported.chests!.map(c => ({ ...c, ...at })), { type: ChestType.CAR, id: 3, ...at }],
            drills: { configs: imported.drills!.configs.map(d => ({ ...d, ...at, direction: 4 })) },
        } as unknown as Config;
        const config = formDataToConfig(configToFormData(placed));
        expect(config.machines.map(m => m.position)).toEqual(placed.machines.map(() => at.position));
        expect(config.inserters.map(ins => [ins.position, ins.direction])).toEqual(placed.inserters.map(() => [at.position, 8]));
        expect(config.chests!.map(c => (c as { position?: unknown }).position)).toEqual(placed.chests!.map(() => at.position));
        expect(config.drills!.configs.map(d => [d.position, d.direction])).toEqual([[at.position, 4]]);
    });

    it('draws a machine by its prototype, else by its type', () => {
        expect(machineIconName({ prototype: 'foundry' })).toBe('foundry');
        expect(machineIconName({})).toBe('assembling-machine-3');
        expect(machineIconName(undefined)).toBe('assembling-machine-3');
    });
});

describe('a drop marked as side-loading onto another belt', () => {
    const mark = { status: 'side-loaded', tiles: 3, sidecar_version: '0.13.0' } as const;
    const marked = { ...imported, inserters: [{ id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1, drop_capture: mark }, stack_size: 16 }] } as unknown as Config;

    it('goes through the form and back as the export gave it', () => {
        const form = configToFormData(marked);
        expect(form.inserters[0].sink).toEqual({ type: 'belt', id: 1, drop_capture: mark });
        expect(formDataToConfig(form).inserters[0].sink).toEqual({ type: 'belt', id: 1, drop_capture: mark });
    });
});

describe('the way the belt runs at a drop and the gap between copies', () => {
    const config = {
        ...imported,
        target_output: { ...imported.target_output, copies: 7, copy_offset: { x: 12, y: 0 } },
        inserters: [{ id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1, belt_direction: 12 }, stack_size: 16, position: { x: 1.5, y: 2.5 }, direction: 8 }],
    } as unknown as Config;

    it('go through the form and back as the export and the player gave them', () => {
        const form = configToFormData(config);
        expect(form.target_output.copy_offset).toEqual({ x: 12, y: 0 });
        expect(form.inserters[0].sink).toEqual({ type: 'belt', id: 1, belt_direction: 12 });
        const back = formDataToConfig(form);
        expect(back.target_output.copy_offset).toEqual({ x: 12, y: 0 });
        expect(back.inserters[0].sink).toEqual({ type: 'belt', id: 1, belt_direction: 12 });
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

describe('cars, tanks, cargo wagons and rocket silos', () => {
    it('keeps them through the form as the config gives them', () => {
        const chests = [
            { id: 1, type: ChestType.CAR, slot_filters: [{ slot: 1, item: 'iron-plate' }], contents: [{ slot: 2, item: 'coal', count: 50 }] },
            { id: 2, type: ChestType.TANK },
            { id: 3, type: ChestType.CARGO_WAGON, quality: 'legendary' as const },
            { id: 4, type: ChestType.ROCKET_SILO, recipe_quality: 'rare' as const, crafting_speed: 2, contents: [{ item: 'iron-plate', count: 100 }] },
        ];
        const config = { ...imported, chests } as unknown as Config;
        expect(formDataToConfig(configToFormData(config)).chests).toEqual(chests);
    });
});
