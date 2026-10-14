import { describe, expect, it } from 'vitest';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import * as edits from './edits';
import { createDefaultConfig, type ConfigFormData, type EnableControlOverride, type InserterFormData } from './formData';

const ids = (items: { id: number }[]) => items.map((item) => item.id);

const inserter = (id: number, source: InserterFormData['source'], sink: InserterFormData['sink']): InserterFormData =>
    ({ id, _uuid: `inserter-${id}`, source, sink, stack_size: 16 });

/** Three machines, two belts, two chests, two drills and inserters between them */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.addMachine(edits.addMachine(config));
    config = edits.addBelt(edits.addBelt(config));
    config = edits.addChest(edits.addChest(config), ChestType.INFINITY_CHEST);
    config = edits.addDrill(edits.addDrill(config));
    config = edits.updateDrill(config, 1, { target: { type: 'machine', id: 3 } });
    return {
        ...config,
        inserters: [
            inserter(1, { type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 3 }),
            inserter(2, { type: 'machine', id: 3 }, { type: 'chest', id: 2 }),
            inserter(3, { type: 'machine', id: 1 }, { type: 'belt', id: 1 }),
        ],
    };
}

describe('nextId', () => {
    it('is one past the highest id, or 1 when there is none, for a form saved without next ids', () => {
        expect(edits.nextId(createDefaultConfig(), 'belts')).toBe(1);
        expect(edits.nextId(createDefaultConfig(), 'machines')).toBe(2);
        expect(edits.nextId(form(), 'drills')).toBe(3);
    });

    it('is past the ids of removed entities', () => {
        const config = edits.removeInserter(form(), 2);
        expect(config.next_ids).toEqual({ inserters: 4 });
        expect(edits.nextId(config, 'inserters')).toBe(4);
        expect(edits.nextId(edits.removeInserter(config, 0), 'inserters')).toBe(4);
    });
});

describe('ids', () => {
    it('are not given out again after the entity with the highest one is removed', () => {
        const removeLast = (config: ConfigFormData) => {
            config = edits.removeMachine(config, config.machines.length - 1);
            config = edits.removeInserter(config, config.inserters.length - 1);
            config = edits.removeBelt(config, config.belts.length - 1);
            config = edits.removeChest(config, config.chests.length - 1);
            return edits.removeDrill(config, config.drills!.configs.length - 1);
        };
        let config = removeLast(form());
        config = edits.addChest(edits.addBelt(edits.addInserter(edits.addMachine(config))));
        config = edits.addDrill(config);
        expect(config.machines.at(-1)!.id).toBe(4);
        expect(config.inserters.at(-1)!.id).toBe(4);
        expect(config.belts.at(-1)!.id).toBe(3);
        expect(config.chests.at(-1)!.id).toBe(3);
        expect(config.drills!.configs.at(-1)!.id).toBe(3);

        config = edits.mergeMachines(removeLast(config), [config.machines[0]]);
        expect(config.machines.at(-1)!.id).toBe(5);
        config = edits.mergeDrills(removeLast(config), [config.drills!.configs[0]]);
        expect(config.drills!.configs.at(-1)!.id).toBe(4);
    });

    it('are past those of entities that were put in without taking an id', () => {
        const config = edits.replaceBelts(edits.addBelt(createDefaultConfig()), [{ ...form().belts[0], id: 9 }]);
        expect(edits.addBelt(config).belts.map((b) => b.id)).toEqual([9, 10]);
    });
});

describe('target output', () => {
    it('sets one field', () => {
        const config = edits.updateTargetOutput(createDefaultConfig(), 'recipe', 'iron-gear-wheel');
        expect(config.target_output).toEqual({ recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 });
    });
});

describe('machines', () => {
    it('adds a machine with the next id and default values', () => {
        const config = edits.addMachine(createDefaultConfig());
        expect(ids(config.machines)).toEqual([1, 2]);
        expect(config.machines[1]).toMatchObject({ recipe: '', productivity: 0, crafting_speed: 1 });
        expect(config.machines[1]._uuid).not.toBe(config.machines[0]._uuid);
    });

    it('updates one field of the machine at an index', () => {
        const config = edits.updateMachine(form(), 1, 'recipe', 'copper-cable');
        expect(config.machines.map((m) => m.recipe)).toEqual(['', 'copper-cable', '']);
    });

    it('removes the machine at an index', () => {
        expect(ids(edits.removeMachine(form(), 0).machines)).toEqual([2, 3]);
    });

    it('unsets the inserter ends and drill targets at a removed machine', () => {
        const config = edits.removeMachine(form(), 2);
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 0 }],
            [{ type: 'machine', id: 0 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 1 }, { type: 'belt', id: 1 }],
        ]);
        expect(config.drills!.configs.map((d) => d.target)).toEqual([{ type: 'machine', id: 1 }, { type: 'machine', id: 0 }]);
        // and they stay unset when the machines are renumbered
        expect(edits.reorderMachines(config, 1, 0).inserters[1].source).toEqual({ type: 'machine', id: 0 });
    });

    it('merges machines in after the others with new ids and uuids', () => {
        const pasted = { ...form().machines[0], id: 1, recipe: 'pasted' };
        const config = edits.mergeMachines(form(), [pasted, pasted]);
        expect(ids(config.machines)).toEqual([1, 2, 3, 4, 5]);
        expect(config.machines[3].recipe).toBe('pasted');
        expect(config.machines[3]._uuid).not.toBe(pasted._uuid);
    });

    it('replaces the machines', () => {
        const machines = [{ ...form().machines[0], id: 7 }];
        expect(edits.replaceMachines(form(), machines).machines).toBe(machines);
    });

    it('renumbers the machines on reorder and follows them in inserters and drills', () => {
        const before = form();
        const config = edits.reorderMachines(before, 2, 0);
        expect(config.machines.map((m) => m._uuid)).toEqual([2, 0, 1].map((i) => before.machines[i]._uuid));
        expect(ids(config.machines)).toEqual([1, 2, 3]);
        // machine 3 is now 1 and machine 1 is now 2
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 1 }],
            [{ type: 'machine', id: 1 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 2 }, { type: 'belt', id: 1 }],
        ]);
        expect(config.drills!.configs.map((d) => d.target.id)).toEqual([2, 1]);
    });
});

describe('inserters', () => {
    it('adds an inserter with the next id from machine 1 to belt 1', () => {
        const config = edits.addInserter(form());
        expect(config.inserters[3]).toMatchObject({ id: 4, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 16 });
    });

    it('merges updates into the inserter at an index', () => {
        const config = edits.updateInserter(form(), 2, { stack_size: 4, filters: ['iron-plate'] });
        expect(config.inserters[2]).toMatchObject({ id: 3, stack_size: 4, filters: ['iron-plate'], source: { type: 'machine', id: 1 } });
    });

    it('removes the inserter at an index', () => {
        expect(ids(edits.removeInserter(form(), 1).inserters)).toEqual([1, 3]);
    });

    it('renumbers the inserters on reorder', () => {
        const config = edits.reorderInserters(form(), 0, 2);
        expect(config.inserters.map((ins) => ins._uuid)).toEqual(['inserter-2', 'inserter-3', 'inserter-1']);
        expect(ids(config.inserters)).toEqual([1, 2, 3]);
    });

    it('replaces the inserters', () => {
        expect(edits.replaceInserters(form(), []).inserters).toEqual([]);
    });
});

describe('belts', () => {
    it('adds a turbo belt with one empty lane', () => {
        const config = edits.addBelt(createDefaultConfig());
        expect(config.belts).toEqual([
            { id: 1, _uuid: expect.any(String), type: 'turbo-transport-belt', lanes: [{ ingredient: '', stack_size: 4 }] },
        ]);
    });

    it('merges updates into the belt at an index', () => {
        const config = edits.updateBelt(form(), 0, { type: 'transport-belt' });
        expect(config.belts.map((b) => b.type)).toEqual(['transport-belt', 'turbo-transport-belt']);
    });

    it('removes the belt at an index', () => {
        expect(ids(edits.removeBelt(form(), 0).belts)).toEqual([2]);
    });

    it('unsets the inserter ends at a removed belt, with the lane they took from first', () => {
        const config = edits.removeBelt(form(), 1);
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 0 }, { type: 'machine', id: 3 }],
            [{ type: 'machine', id: 3 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 1 }, { type: 'belt', id: 1 }],
        ]);
        expect(edits.removeBelt(form(), 0).inserters[2].sink).toEqual({ type: 'belt', id: 0 });
    });

    it('renumbers the belts on reorder and follows them in inserters', () => {
        const config = edits.reorderBelts(form(), 1, 0);
        expect(config.inserters[0].source).toEqual({ type: 'belt', id: 1, near_lane: 1 });
        expect(config.inserters[2].sink).toEqual({ type: 'belt', id: 2 });
    });
});

describe('chests', () => {
    it('adds a buffer chest by default and an infinity chest when asked', () => {
        const config = form();
        expect(config.chests).toEqual([
            { type: ChestType.BUFFER_CHEST, id: 1, _uuid: expect.any(String), storage_size: 1, item_filter: '' },
            { type: ChestType.INFINITY_CHEST, id: 2, _uuid: expect.any(String), item_filter: [{ item_name: '', request_count: 1 }] },
        ]);
    });

    it('merges updates into the chest at an index', () => {
        const config = edits.updateChest(form(), 0, { item_filter: 'iron-plate' });
        expect(config.chests[0]).toMatchObject({ item_filter: 'iron-plate', storage_size: 1 });
    });

    it('switches the type of a chest, keeping its id and uuid', () => {
        const before = form();
        const config = edits.switchChestType(before, 1, ChestType.BUFFER_CHEST);
        expect(config.chests[1]).toEqual({ type: ChestType.BUFFER_CHEST, id: 2, _uuid: before.chests[1]._uuid, storage_size: 1, item_filter: '' });
        expect(config.chests[0]).toBe(before.chests[0]);
    });

    it('removes the chest at an index', () => {
        expect(ids(edits.removeChest(form(), 1).chests)).toEqual([1]);
    });

    it('unsets the inserter ends at a removed chest', () => {
        const config = edits.removeChest(form(), 1);
        expect(config.inserters[1].sink).toEqual({ type: 'chest', id: 0 });
        expect(edits.removeChest(form(), 0).inserters).toEqual(form().inserters);
    });

    it('renumbers the chests on reorder and follows them in inserters', () => {
        const config = edits.reorderChests(form(), 1, 0);
        expect(config.inserters[1].sink).toEqual({ type: 'chest', id: 1 });
    });
});

describe('drills', () => {
    it('enables drills with none and disables them altogether', () => {
        const enabled = edits.enableDrills(createDefaultConfig());
        expect(enabled.drills).toEqual({ mining_productivity_level: 0, configs: [] });
        expect('drills' in edits.disableDrills(enabled)).toBe(false);
    });

    it('sets the mining productivity level only when drills are enabled', () => {
        expect(edits.updateDrillsConfig(form(), 'mining_productivity_level', 3).drills!.mining_productivity_level).toBe(3);
        const config = createDefaultConfig();
        expect(edits.updateDrillsConfig(config, 'mining_productivity_level', 3)).toBe(config);
    });

    it('adds an electric drill for machine 1, enabling drills first', () => {
        const config = edits.addDrill(createDefaultConfig());
        expect(config.drills).toEqual({
            mining_productivity_level: 0,
            configs: [{ id: 1, _uuid: expect.any(String), type: 'electric-mining-drill', mined_item_name: '', speed_bonus: 0, target: { type: 'machine', id: 1 } }],
        });
    });

    it('updates and removes the drill at an index', () => {
        expect(edits.updateDrill(form(), 0, { mined_item_name: 'iron-ore' }).drills!.configs[0].mined_item_name).toBe('iron-ore');
        expect(ids(edits.removeDrill(form(), 0).drills!.configs)).toEqual([2]);
    });

    it('merges drills in after the others with new ids, enabling drills first', () => {
        const pasted = form().drills!.configs[0];
        expect(ids(edits.mergeDrills(form(), [pasted]).drills!.configs)).toEqual([1, 2, 3]);
        expect(ids(edits.mergeDrills(createDefaultConfig(), [pasted]).drills!.configs)).toEqual([1]);
    });

    it('replaces the drills, enabling drills first', () => {
        const pasted = form().drills!.configs;
        expect(edits.replaceDrills(createDefaultConfig(), pasted).drills).toEqual({ mining_productivity_level: 0, configs: pasted });
    });

    it('renumbers the drills on reorder', () => {
        const config = edits.reorderDrills(form(), 1, 0);
        expect(config.drills!.configs.map((d) => [d.id, d.target.id])).toEqual([[1, 3], [2, 1]]);
    });
});

describe('overrides', () => {
    it('sets an override and drops the overrides once none is left', () => {
        const config = edits.updateOverrides(createDefaultConfig(), 'lcm', 120);
        expect(config.overrides).toEqual({ lcm: 120 });
        expect('overrides' in edits.updateOverrides(config, 'lcm', undefined)).toBe(false);
    });

    /** A transfer plan in which each inserter (by id) moves the given items */
    const plan = (transfers: Record<number, string[]>) => ({
        computed_lcm: 1,
        entities: Object.entries(transfers).map(([id, items]) => ({
            entity_id: `inserter:${id}`,
            entity_type: 'inserter',
            entity_number: Number(id),
            item_transfers: items.map((item_name) => ({ item_name })),
        })),
    }) as unknown as SerializableTransferPlan;

    const ironPlan = plan({ 1: ['iron-plate'] });

    /** The form with the rule of inserter 1 replaced */
    const withRule = (overrides: InserterFormData['overrides']) => edits.updateInserter(form(), 0, { overrides });

    it('forces inserters whose items are all ignored to always run, and reverts them when no longer', () => {
        const ignored = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        expect(ignored.overrides).toEqual({ ignored_lcm_ingredients: ['iron-plate'] });
        expect(ignored.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
        expect(ignored.inserters[0]._forced_always).toBe(true);
        expect(ignored.inserters[1].overrides).toBeUndefined();
        expect('_forced_always' in ignored.inserters[1]).toBe(false);

        const reverted = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect('overrides' in reverted).toBe(false);
        expect('overrides' in reverted.inserters[0]).toBe(false);
        expect('_forced_always' in reverted.inserters[0]).toBe(false);
    });

    it('keeps the other overrides of an inserter when it reverts the forced ALWAYS', () => {
        const animated = withRule({ animation: { pickup_duration_ticks: 12 } });
        const ignored = edits.updateIgnoredIngredients(animated, ['iron-plate'], ironPlan);
        expect(ignored.inserters[0].overrides).toEqual({ animation: { pickup_duration_ticks: 12 }, enable_control: { mode: 'ALWAYS' } });
        const reverted = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect(reverted.inserters[0].overrides).toEqual({ animation: { pickup_duration_ticks: 12 } });
        expect('_forced_always' in reverted.inserters[0]).toBe(false);
    });

    it.each([
        ['CLOCKED', { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 }],
        ['CONDITIONAL', { mode: 'CONDITIONAL', rule_set: { operator: 'AND', rules: [] } }],
        ['NEVER', { mode: 'NEVER' }],
    ])('leaves a %s rule alone when its items are excluded and included again', (_mode, rule) => {
        const config = withRule({ enable_control: rule as EnableControlOverride });
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], ironPlan);
        expect(ignored.inserters[0]).toBe(config.inserters[0]);
        expect('_forced_always' in ignored.inserters[0]).toBe(false);
        const included = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect(included.inserters[0]).toBe(config.inserters[0]);
    });

    it('keeps an ALWAYS the player set when its items are excluded and included again', () => {
        const config = withRule({ enable_control: { mode: 'ALWAYS' } });
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], ironPlan);
        expect(ignored.inserters[0]).toBe(config.inserters[0]);
        const included = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect(included.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
        expect('_forced_always' in included.inserters[0]).toBe(false);
    });

    it('counts an explicit AUTO rule as AUTO', () => {
        const config = withRule({ enable_control: { mode: 'AUTO' } });
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], ironPlan);
        expect(ignored.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
        expect(ignored.inserters[0]._forced_always).toBe(true);
        const reverted = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect('overrides' in reverted.inserters[0]).toBe(false);
        expect('_forced_always' in reverted.inserters[0]).toBe(false);
    });

    it('forces an inserter with two items only once both are excluded, and reverts it when one is included', () => {
        const twoItems = plan({ 1: ['iron-plate', 'copper-plate'] });
        const config = form();
        const one = edits.updateIgnoredIngredients(config, ['iron-plate'], twoItems);
        expect(one.inserters[0]).toBe(config.inserters[0]);
        const both = edits.updateIgnoredIngredients(one, ['iron-plate', 'copper-plate'], twoItems);
        expect(both.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
        expect(both.inserters[0]._forced_always).toBe(true);
        const reverted = edits.updateIgnoredIngredients(both, ['copper-plate'], twoItems);
        expect('overrides' in reverted.inserters[0]).toBe(false);
        expect('_forced_always' in reverted.inserters[0]).toBe(false);
    });

    it('leaves a forced inserter forced when run again with the same items', () => {
        const ignored = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const again = edits.updateIgnoredIngredients(ignored, ['iron-plate'], ironPlan);
        expect(again.inserters[0]).toBe(ignored.inserters[0]);
        expect(again.inserters[0]._forced_always).toBe(true);
    });

    it('drops the flag but keeps the rule of a flagged inserter whose rule is not ALWAYS', () => {
        const config = form();
        const rule: EnableControlOverride = { mode: 'NEVER' };
        config.inserters[0] = { ...config.inserters[0], overrides: { enable_control: rule }, _forced_always: true };
        const included = edits.updateIgnoredIngredients(config, [], ironPlan);
        expect(included.inserters[0].overrides).toEqual({ enable_control: rule });
        expect('_forced_always' in included.inserters[0]).toBe(false);
    });

    it('unflags an inserter whose rule is replaced, and keeps the flag through other edits', () => {
        const forced = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const replaced = edits.updateInserter(forced, 0, { overrides: { enable_control: { mode: 'ALWAYS' } } });
        expect('_forced_always' in replaced.inserters[0]).toBe(false);
        expect(replaced.inserters[0].overrides).toEqual({ enable_control: { mode: 'ALWAYS' } });
        const restacked = edits.updateInserter(forced, 0, { stack_size: 12 });
        expect(restacked.inserters[0]._forced_always).toBe(true);
        expect(restacked.inserters[0].stack_size).toBe(12);
    });

    it('keeps the flag on the inserter, not its id, through a reorder', () => {
        const forced = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const reordered = edits.reorderInserters(forced, 0, 2);
        expect(reordered.inserters.map((ins) => [ins._uuid, ins.id, ins._forced_always])).toEqual([
            ['inserter-2', 1, undefined],
            ['inserter-3', 2, undefined],
            ['inserter-1', 3, true],
        ]);
    });
});
