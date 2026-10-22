import { describe, expect, it } from 'vitest';
import { Config, ConfigSchema } from '../config/schema';
import { CompositeControlLogic, TickControlLogic } from '../control-logic';
import { EntityState } from '../state';
import { SimulationContext } from './sequence/simulation-context';
import { generateClockAlternatives } from './alternatives';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

// a big mining drill on iron ore, as the owner's car build has it: 4 speed modules and 4 beacons (speed bonus 17.5);
// at the harness's research (mining productivity 3 at level 8000) it mines 617 ore a tick
const drill = (target: { type: 'chest' | 'machine'; id: number }, overrides?: object) => ({
    id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 17.5, target, ...(overrides ? { overrides } : {}),
});
const stack = (source: object, sink: object) => ({ source, sink, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16 });

/** The drill into chest 1, which `chests` gives, and a furnace on iron plates the inserters may feed from it */
function build(chests: object[], inserters: object[] = []): Config {
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0, type: 'furnace' }],
        drills: { mining_productivity_level: 8000, configs: [drill({ type: 'chest', id: 1 })] },
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

    it('fills the car in slot order, the first slots first', () => {
        const context = run(build([{ id: 1, type: 'car' }]), 1);
        const car = context.state_registry.getAllStates().find(EntityState.isSlotContainer)!;
        const filled = car.inventoryState.slots.map(slot => slot.count);
        expect(car.getCurrentQuantity('iron-ore')).toBe(617);
        expect(filled.slice(0, 12)).toEqual(new Array(12).fill(50));
        expect(filled[12]).toBe(17);
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
        ConfigSchema.safeParse({ ...base, drills: { mining_productivity_level: 8000, configs: [drill(target, overrides)] } });

    it('takes a chest as the target', () => {
        expect(parse({ type: 'chest', id: 1 }).success).toBe(true);
        expect(parse({ type: 'machine', id: 1 }).success).toBe(true);
    });

    it('refuses a chest that is not in the config', () => {
        const parsed = parse({ type: 'chest', id: 2 });
        expect(parsed.success).toBe(false);
        expect(parsed.error!.issues[0].message).toBe('Drill 1 drops into chest 2, which is not in the config');
    });

    it('refuses an enable control on it but ALWAYS', () => {
        expect(parse({ type: 'chest', id: 1 }, { enable_control: { mode: 'ALWAYS' } }).success).toBe(true);
        const parsed = parse({ type: 'chest', id: 1 }, { enable_control: { mode: 'NEVER' } });
        expect(parsed.success).toBe(false);
        expect(parsed.error!.issues[0].message).toContain('drops into a chest and is always enabled');
    });
});

describe('a clock for a drill into a car between two furnaces', () => {
    it('leaves the drill always enabled, with no window, and holds 80 plates a second', () => {
        const config = ConfigSchema.parse({
            target_output: { recipe: 'iron-plate', items_per_second: 80, copies: 1 },
            machines: [1, 2].map(id => ({ id, recipe: 'iron-plate', crafting_speed: 86.18, productivity: 50, type: 'furnace' })),
            drills: { mining_productivity_level: 8000, configs: [drill({ type: 'chest', id: 1 })] },
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
            expect(Object.keys(alternative.result.clock_windows).filter(id => id.startsWith('drill:'))).toEqual([]);
        }
    }, 60_000);
});
