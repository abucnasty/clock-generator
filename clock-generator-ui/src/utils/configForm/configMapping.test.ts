import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { configToFormData, formDataToConfig } from './configMapping';

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
            source: { type: 'belt', id: 1, near_lane: 2 },
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
