import { describe, expect, it } from 'vitest';
import { Config, ConfigSchema } from '../config/schema';
import { CompositeControlLogic, TickControlLogic } from '../control-logic';
import { EntityState } from '../state';
import { SimulationContext } from './sequence/simulation-context';
import { generateClockAlternatives } from './alternatives';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

// a big mining drill on iron ore, as the car build has it: 4 speed modules and 4 beacons (speed bonus 17.5);
// at 8000 levels of research it mines 617 ore a tick (its bar moves 0.77 a tick, its bonus bar 616.7)
const drill = (target: { type: 'chest' | 'machine'; id: number }, overrides?: object) => ({
    id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 17.5, productivity: 80000, target, ...(overrides ? { overrides } : {}),
});
const stack = (source: object, sink: object) => ({ source, sink, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16 });

/** The drill into chest 1, which `chests` gives, and a furnace on iron plates the inserters may feed from it */
function build(chests: object[], inserters: object[] = []): Config {
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, type: 'furnace' }],
        drills: { configs: [drill({ type: 'chest', id: 1 })] },
        inserters, belts: [], chests,
    });
}

function run(config: Config, ticks: number) {
    const context = SimulationContext.fromConfig(config);
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates(), ...context.drills]);
    for (let i = 0; i < ticks; i++) tick.executeForTick();
    return context;
}

describe('a drill that drops into a chest', () => {
    it('fills a car slot by slot to its 80 stacks of ore, then holds what it mined and stops', () => {
        const context = run(build([{ id: 1, type: 'car' }]), 20);
        const car = context.state_registry.getAllStates().find(EntityState.isSlotContainer)!;
        expect(car.getCurrentQuantity('iron-ore')).toBe(4000);
        expect(car.inventoryState.slots.every(slot => slot.item === 'iron-ore' && slot.count === 50)).toBe(true);
        // what did not fit stays in the drill, and the drill mines no more: it holds less than a tick's ore
        const held = context.drills[0].drill_state.inventoryState.getQuantity('iron-ore');
        expect(held).toBeGreaterThan(0);
        expect(held).toBeLessThan(618);
    });

    it('fills the car in slot order, the first slots first, a tick after it mines', () => {
        // the first tick mines 616 (the bonus bar's whole units; the mining bar has not wrapped) into the drill, the
        // second drops them
        const first = run(build([{ id: 1, type: 'car' }]), 1);
        expect(first.state_registry.getAllStates().find(EntityState.isSlotContainer)!.getCurrentQuantity('iron-ore')).toBe(0);
        expect(first.drills[0].drill_state.inventoryState.getQuantity('iron-ore')).toBe(616);
        const context = run(build([{ id: 1, type: 'car' }]), 2);
        const car = context.state_registry.getAllStates().find(EntityState.isSlotContainer)!;
        const filled = car.inventoryState.slots.map(slot => slot.count);
        expect(car.getCurrentQuantity('iron-ore')).toBe(616);
        expect(filled.slice(0, 12)).toEqual(new Array(12).fill(50));
        expect(filled[12]).toBe(16);
        expect(filled.slice(13).every(count => count === 0)).toBe(true);
    });

    it('drops again when an inserter takes from the full car', () => {
        const context = run(build([{ id: 1, type: 'car' }], [stack({ type: 'chest', id: 1 }, { type: 'machine', id: 1 })]), 2000);
        const car = context.state_registry.getAllStates().find(EntityState.isSlotContainer)!;
        const taker = context.inserters[0].inserter_state;
        expect(taker.items_dropped).toBeGreaterThan(0);
        // the drill keeps the car full whatever the furnace takes
        expect(car.getCurrentQuantity('iron-ore') + taker.items_dropped - (taker.held_item?.quantity ?? 0)).toBeGreaterThan(4000);
        expect(car.getCurrentQuantity('iron-ore')).toBeGreaterThanOrEqual(4000 - 16);
    });

    it('fills a rocket silo by weight: 500 ore of 2,000 a piece in a rocket of 1,000,000', () => {
        const context = run(build([{ id: 1, type: 'rocket-silo' }]), 10);
        const silo = context.state_registry.getAllStates().find(EntityState.isRocketSilo)!;
        expect(silo.getCurrentQuantity('iron-ore')).toBe(500);
    });

    it('fills a buffer chest of its item to its slots', () => {
        const context = run(build([{ id: 1, type: 'buffer-chest', storage_size: 4, item_filter: 'iron-ore' }]), 5);
        const chest = context.state_registry.getAllStates().find(EntityState.isBufferChest)!;
        expect(chest.getCurrentQuantity()).toBe(200);
    });

    it('is refused into a buffer chest of another item', () => {
        expect(() => run(build([{ id: 1, type: 'buffer-chest', storage_size: 4, item_filter: 'copper-ore' }]), 1))
            .toThrow(/mines iron-ore into buffer chest chest:1, which holds copper-ore/);
    });
});

describe('the config of a drill into a chest', () => {
    const base = {
        target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, type: 'furnace' }],
        inserters: [], belts: [], chests: [{ id: 1, type: 'car' }],
    };
    const parse = (target: { type: 'chest' | 'machine'; id: number }, overrides?: object) =>
        ConfigSchema.safeParse({ ...base, drills: { configs: [drill(target, overrides)] } });

    it('takes a chest as the target', () => {
        expect(parse({ type: 'chest', id: 1 }).success).toBe(true);
        expect(parse({ type: 'machine', id: 1 }).success).toBe(true);
    });

    it('refuses a chest that is not in the config', () => {
        const parsed = parse({ type: 'chest', id: 2 });
        expect(parsed.success).toBe(false);
        expect(parsed.error!.issues[0].message).toBe('Drill 1 drops into chest 2, which is not in the config');
    });

    it('takes AUTO, CLOCKED and ALWAYS as its enable control', () => {
        for (const enable_control of [{ mode: 'AUTO' }, { mode: 'ALWAYS' }, { mode: 'CLOCKED', ranges: [{ start: 1, end: 2 }], period_duration_ticks: 72 }]) {
            expect(parse({ type: 'chest', id: 1 }, { enable_control }).success, enable_control.mode).toBe(true);
        }
        expect(parse({ type: 'chest', id: 1 }, { extra_window_ticks: 1 }).success).toBe(true);
    });

    it('refuses CONDITIONAL and NEVER on it', () => {
        const conditional = { mode: 'CONDITIONAL', rule_set: { operator: 'AND', rules: [{ left: { type: 'CONSTANT', value: 1 }, operator: '>', right: { type: 'CONSTANT', value: 0 } }] } };
        for (const enable_control of [conditional, { mode: 'NEVER' }]) {
            const parsed = parse({ type: 'chest', id: 1 }, { enable_control });
            expect(parsed.success, enable_control.mode).toBe(false);
            expect(parsed.error!.issues.map(issue => issue.message)).toContain(
                `Drill 1 drops into a chest; its enable control can be AUTO, CLOCKED or ALWAYS, not ${enable_control.mode}`);
        }
    });
});

describe('a clock for a drill into a car between two furnaces', () => {
    it('enables the drill a tick a period on the clocks that meet goal 1, and leaves it always enabled on the others', () => {
        const config = ConfigSchema.parse({
            target_output: { recipe: 'iron-plate', items_per_second: 80, copies: 1 },
            machines: [1, 2].map(id => ({ id, recipe: 'iron-plate', crafting_speed: 86.18, productivity: 50, type: 'furnace' })),
            drills: { configs: [drill({ type: 'chest', id: 1 })] },
            inserters: [stack({ type: 'chest', id: 1 }, { type: 'machine', id: 1 }), stack({ type: 'chest', id: 1 }, { type: 'machine', id: 2 }),
                stack({ type: 'machine', id: 1 }, { type: 'belt', id: 1 }), stack({ type: 'machine', id: 2 }, { type: 'belt', id: 1 })],
            belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }],
            chests: [{ id: 1, type: 'car' }],
        });
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        const selected = alternatives[selected_index];
        expect(selected.assessment.holds).toBe(true);
        expect(selected.assessment.items_per_second).toBeCloseTo(80, 6);
        for (const alternative of alternatives) {
            const drill = alternative.result.clock_windows['drill:1'];
            if (alternative.verdict === 'stable') {
                // the tick before the takers' first window: 617 ore a tick, more than a period takes
                const first_take = Math.min(...alternative.result.clock_windows['inserter:1'].map(range => range.start));
                expect(drill, alternative.id).toEqual([{ start: first_take - 1, end: first_take - 1 }]);
                expect(alternative.insights.find(it => it.id === 'chest-drill-windows')?.what).toContain('is enabled 1 tick of the');
            } else {
                // made again with the drill a tick longer, then always enabled: today's clock
                expect(drill, alternative.id).toBeUndefined();
                expect(alternative.result.chest_drills?.[0].always_enabled_because, alternative.id).toEqual({ kind: 'fallback' });
                expect(alternative.result.always_on_reasons?.['drill:1'], alternative.id).toEqual({ kind: 'chest-drill', why: { kind: 'fallback' } });
            }
        }
        // the decider of the drill, named by its ends, its windows a period, its one condition, and tagged with the drill it switches on
        const decider = selected.result.blueprint.entities.find(entity => entity.tags?.clock_generator?.drills !== undefined);
        const window = selected.result.clock_windows['drill:1'][0];
        expect(decider?.tags?.clock_generator?.drills).toEqual([1]);
        // the blueprint's name is the item's icon and its name in the game
        expect(selected.result.blueprint.label).toBe('[item=iron-plate] Iron plate clock');
        expect(decider?.player_description?.split('\n')).toEqual([
            '[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)',
            `Tops the [entity=car] up just in time, 1 window per 72-tick period: open ${window.start + 1}`,
            'Not counted as swings: opens just before the inserters take from the [entity=car]',
        ]);
        // a window of one tick is one condition, the clock equal to it
        const conditions = (decider?.control_behavior as { decider_conditions: { conditions: unknown[] } }).decider_conditions.conditions;
        expect(conditions).toEqual([expect.objectContaining({ first_signal: expect.objectContaining({ name: 'signal-clock' }), comparator: '=', constant: window.start + 1 })]);
        expect(selected.result.schedule.inserter_combinators.flatMap(it => it.inserter_ids).sort()).toEqual([1, 2, 3, 4]);
    }, 60_000);
});
