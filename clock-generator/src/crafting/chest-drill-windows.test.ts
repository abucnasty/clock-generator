import { describe, expect, it } from 'vitest';
import { Config, ConfigSchema } from '../config/schema';
import { DrillChestWorkingMode } from '../control-logic/drill/modes/chest-working-mode';
import { OpenRange } from '../data-types';
import { EntityId, MiningDrill } from '../entities';
import { ChestState, DrillState, EntityStateFactory } from '../state';
import { createEntityRegistryFromConfig } from './sequence/simulation-context';
import { chestDrillBecause, chestDrillFallbackConfig, chestDrillWindows, chestDrillWindowsKeepUp, hasPlannedChestDrill } from './chest-drill-windows';

const stack = (source: object, sink: object) => ({ source, sink, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16 });

interface Build {
    /** The drill's speed bonus and productivity in percent: the car build's drill by default, 617 ore a tick */
    speed_bonus?: number;
    productivity?: number;
    chest?: object;
    items_per_second?: number;
    furnaces?: number;
    drill_overrides?: object;
    second_drill?: boolean;
    /** An inserter that puts iron ore into the chest too */
    filler?: boolean;
}

/**
 * A big mining drill on iron ore into chest 1, and furnaces on iron plates, each fed from the chest by a stack
 * inserter (inserters 1, 2, ...) and emptied onto a belt (the inserters after them)
 */
function build(it: Build = {}): Config {
    const furnaces = it.furnaces ?? 2;
    const drill = (id: number) => ({ id, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: it.speed_bonus ?? 17.5,
        productivity: it.productivity ?? 80000, target: { type: 'chest', id: 1 }, ...(it.drill_overrides ? { overrides: it.drill_overrides } : {}) });
    const ids = Array.from({ length: furnaces }, (_, index) => index + 1);
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-plate', items_per_second: it.items_per_second ?? 80, copies: 1 },
        machines: ids.map(id => ({ id, recipe: 'iron-plate', crafting_speed: 86.18, productivity: 50, type: 'furnace' })),
        drills: { configs: [drill(1), ...(it.second_drill ? [drill(2)] : [])] },
        inserters: [
            ...ids.map(id => stack({ type: 'chest', id: 1 }, { type: 'machine', id })),
            ...ids.map(id => stack({ type: 'machine', id }, { type: 'belt', id: 1 })),
            ...(it.filler ? [stack({ type: 'chest', id: 2 }, { type: 'chest', id: 1 })] : []),
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }],
        chests: [it.chest ?? { id: 1, type: 'car' },
            ...(it.filler ? [{ id: 2, type: 'infinity-chest', item_filter: [{ item_name: 'iron-ore', request_count: 50 }] }] : [])],
    });
}

const windowsOf = (entries: Record<string, [number, number][]>) =>
    new Map(Object.entries(entries).map(([key, ranges]) => [key, ranges.map(([start, end]) => OpenRange.from(start, end))]));
const pairs = (ranges: OpenRange[] | undefined) => ranges?.map(range => [range.start_inclusive, range.end_inclusive]);

/** The car build's clock with 3 output swings: the takers in ticks 28-41 of a 72-tick period, 32 ore each */
const CAR_WINDOWS = { 'inserter:1': [[28, 41]], 'inserter:2': [[28, 41]], 'inserter:3': [[1, 34]], 'inserter:4': [[1, 34]] } as Record<string, [number, number][]>;

describe('the windows of a drill into a chest', () => {
    it('are one tick, the tick before the takers, when a mining tick yields more than a period takes', () => {
        // 617 ore a tick against 64 a period: the window drops what the drill holds, and it mines again once in ten periods
        const { windows, drills } = chestDrillWindows(build(), windowsOf(CAR_WINDOWS), 72);
        expect(pairs(windows.get('drill:1'))).toEqual([[27, 27]]);
        expect(drills).toEqual([{ drill_id: 1, chest_id: 1, chest_type: 'car', item: 'iron-ore', planned: true, enabled_ticks: 1, window_count: 1 }]);
        // the inserters' windows are not touched
        expect(pairs(windows.get('inserter:1'))).toEqual([[28, 41]]);
    });

    it('are several where the chest does not hold what is taken between two of them', () => {
        // a buffer chest of one stack: 50 ore of room against 32 + 32 a period, taken in two windows
        const config = build({ chest: { id: 1, type: 'buffer-chest', storage_size: 1, item_filter: 'iron-ore' } });
        const taken = windowsOf({ ...CAR_WINDOWS, 'inserter:1': [[10, 20]], 'inserter:2': [[40, 50]] });
        const { windows } = chestDrillWindows(config, taken, 72);
        // each window two ticks: when the hold runs out in a window's first tick the drill drops what is left and mines,
        // so a window of one tick then brings less than a take, and one stack does not cover it
        expect(pairs(windows.get('drill:1'))).toEqual([[8, 9], [38, 39]]);
        expect(chestDrillWindowsKeepUp(config, taken, 72, 1, windows.get('drill:1')!)).toBe(true);
        expect(chestDrillWindowsKeepUp(config, taken, 72, 1, [OpenRange.from(9, 9), OpenRange.from(39, 39)])).toBe(false);
        // with only the first, the second take finds 18 of its 32
        expect(chestDrillWindowsKeepUp(config, taken, 72, 1, [OpenRange.from(8, 9)])).toBe(false);
    });

    it('cover what the bars yield at a low rate, and not a tick less', () => {
        // the drills family's l8 and l45 drills: 4 legendary speed modules 3 (bar 0.25 a tick) at +70% and +440%: 0.425
        // and 1.35 ore a tick; a furnace that takes a hand of 16 a 600-tick period
        for (const [productivity, ticks] of [[70, 38], [440, 12]] as const) {
            const config = build({ speed_bonus: 5, productivity, items_per_second: 1.5, furnaces: 1 });
            const taken = windowsOf({ 'inserter:1': [[300, 310]], 'inserter:2': [[100, 120]] });
            const drill = chestDrillWindows(config, taken, 600).windows.get('drill:1')!;
            expect(pairs(drill), `+${productivity}%`).toEqual([[300 - ticks, 299]]);
            expect(chestDrillWindowsKeepUp(config, taken, 600, 1, [OpenRange.from(300 - ticks + 1, 299)]), `+${productivity}%, a tick less`).toBe(false);
        }
    });

    it('takes a window over the end of the period as one take, in its first tick', () => {
        const taken = windowsOf({ ...CAR_WINDOWS, 'inserter:1': [[0, 5], [66, 71]], 'inserter:2': [[0, 5], [66, 71]] });
        expect(pairs(chestDrillWindows(build(), taken, 72).windows.get('drill:1'))).toEqual([[65, 65]]);
    });

    it('are kept where the windows have them already, as an exported clock does', () => {
        const given = windowsOf({ ...CAR_WINDOWS, 'drill:1': [[5, 6]] });
        const { windows, drills } = chestDrillWindows(build(), given, 72);
        expect(windows).toBe(given);
        expect(drills[0]).toMatchObject({ enabled_ticks: 2, window_count: 1 });
    });

    it('are the ranges of a CLOCKED drill, repeated with its own period', () => {
        const config = build({ drill_overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: 3, end: 4 }], period_duration_ticks: 36 } } });
        expect(pairs(chestDrillWindows(config, windowsOf(CAR_WINDOWS), 72).windows.get('drill:1'))).toEqual([[3, 4], [39, 40]]);
        expect(hasPlannedChestDrill(config)).toBe(false);
    });

    it('start a tick earlier with a tick more, as the fallback asks', () => {
        const longer = chestDrillFallbackConfig(build(), 'one tick longer');
        expect(longer.drills!.configs[0].overrides).toEqual({ extra_window_ticks: 1 });
        expect(pairs(chestDrillWindows(longer, windowsOf(CAR_WINDOWS), 72).windows.get('drill:1'))).toEqual([[26, 27]]);
    });
});

describe('a drill into a chest stays always enabled', () => {
    const always = (config: Config, windows = windowsOf(CAR_WINDOWS)) => {
        const made = chestDrillWindows(config, windows, 72);
        expect(made.windows.has('drill:1')).toBe(false);
        expect(made.windows).toBe(windows);
        return made.drills[0];
    };

    it('where the config sets it so, as the fallback does last', () => {
        expect(always(build({ drill_overrides: { enable_control: { mode: 'ALWAYS' } } })).always_enabled_because).toEqual({ kind: 'config' });
        const fallback = chestDrillFallbackConfig(build(), 'always enabled');
        expect(fallback.drills!.configs[0].overrides?.enable_control).toEqual({ mode: 'ALWAYS' });
        expect(hasPlannedChestDrill(fallback)).toBe(false);
    });

    it('where another drill fills the same chest with the same item', () => {
        const because = always(build({ second_drill: true })).always_enabled_because!;
        expect(because).toEqual({ kind: 'other-drill', drill_number: 2, item: 'iron-ore' });
        expect(chestDrillBecause(because)).toBe('drill 2 fills the same chest with iron-ore too');
    });

    it('where an inserter fills the same chest with the same item', () => {
        const because = always(build({ filler: true })).always_enabled_because!;
        expect(because).toEqual({ kind: 'filler', inserter_number: 5, item: 'iron-ore' });
        expect(chestDrillBecause(because)).toBe('inserter 5 fills the same chest with iron-ore too');
    });

    it('where a taker of the chest has no window', () => {
        const windows = windowsOf({ 'inserter:2': [[28, 41]] });
        const because = always(build(), windows).always_enabled_because!;
        expect(because).toEqual({ kind: 'taker-without-window', inserter_number: 1, item: 'iron-ore' });
        expect(chestDrillBecause(because)).toBe('inserter 1 takes iron-ore out of the chest with no window');
    });
});

describe('the drill into a chest that the windows are replayed with (the recordings of the drill-chest family)', () => {
    /** A legendary steel chest's 6,000 ore, as a buffer chest of 120 stacks, full, after a take; the drill holding `hold` */
    function refill(productivity: number, take: number, hold: number): number {
        const config = build({ speed_bonus: 5, productivity, chest: { id: 1, type: 'buffer-chest', storage_size: 120, item_filter: 'iron-ore' } });
        const registry = createEntityRegistryFromConfig(config);
        const chest = new EntityStateFactory(registry).createStateForEntity(EntityId.forChest(1)) as ChestState;
        chest.inventoryState.addQuantity('iron-ore', 6000 - take);
        const drill = DrillState.fromEntity(registry.getEntityByIdOrThrow(EntityId.forDrill(1)) as MiningDrill);
        drill.inventoryState.addQuantity('iron-ore', hold);
        const mode = new DrillChestWorkingMode(drill, chest);
        let ticks = 0;
        while (chest.getCurrentQuantity('iron-ore') < 6000) {
            mode.executeForTick();
            ticks++;
        }
        return ticks;
    }

    it('fills the chest in the one tick it drops when its hold covers the room', () => {
        // gated-l100000: 2,500.225 ore a tick, 13 of its 24 windows
        expect(refill(999990, 1000, 2500)).toBe(1);
    });

    it('needs one tick more than its mining ticks when its hold does not cover the room: the drop', () => {
        // gated-l7999: 200.2 a tick, every window: 1 + ceil((room - hold) / rate)
        expect(refill(79990, 1000, 200)).toBe(1 + Math.ceil(800 / 200.2));
        expect(refill(79990, 100, 0)).toBe(2);
    });
});
