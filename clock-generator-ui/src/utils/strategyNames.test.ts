import { describe, expect, it } from 'vitest';
import { settingChipsOf } from 'clock-generator/light';
import type { ClockRouting, ClockSettings, ClockStrategy, StrategyId, TuningMethod } from 'clock-generator/browser';
import { CHIP_SEPARATOR, clockChipsOf, directRouterOf, familyCopyOf, fullClockName, pendingClockName, sourceLinesOf, strategyNameOf, type NamedClock } from './strategyNames';

const STRATEGIES: StrategyId[] = ['takt_batches', 'round_robin_polling', 'euclidean_swings', 'time_division_windows', 'time_study_windows', 'moved_output_swing',
    'phase_shifted_batch', 'pitch_pickups', 'exhaust'];

const plain = (output_swings = 2): ClockSettings => ({ output_count: { kind: 'output_swings', count: output_swings }, window_cycle: [], belt_pickups: [] });
const strategy = (id: StrategyId, tuning_method: TuningMethod = 'calculated', settings: ClockSettings = plain()): ClockStrategy =>
    ({ id, tuning_method, settings, output_swings: settings.output_count.count, routing: { router: 'direct' } });
const coordinatedSources = (sources: ClockRouting['sources'] = []): ClockStrategy =>
    ({ id: null, tuning_method: null, settings: plain(), output_swings: 2, routing: { router: 'coordinated_sources', sources } });
/** The words of the output-count chip, read from the catalog (the tests do not pin them) */
const swingsChip = (count = 2, kind: 'output_swings' | 'hands_brought_in' = 'output_swings') => settingChipsOf({ ...plain(), output_count: { kind, count } })[0].label;
const labels = (value: NamedClock) => clockChipsOf(value).map(chip => chip.label);
const clock = (extra: Partial<NamedClock> = {}): NamedClock => ({ label: 'Engine label', strategy: strategy('takt_batches'), ...extra });

describe('strategyNameOf and familyCopyOf', () => {
    it('names a clock by the catalog row of its strategy', () => {
        expect(strategyNameOf(clock())).toBe('Takt Batches');
        expect(strategyNameOf(clock({ strategy: strategy('takt_batches', 'observed') }))).toBe('Takt Batches');
        expect(strategyNameOf(clock({ strategy: strategy('round_robin_polling') }))).toBe('Round-Robin Polling');
        expect(strategyNameOf(clock({ strategy: strategy('phase_shifted_batch', 'observed') }))).toBe('Phase-Shifted Batch');
        expect(familyCopyOf(clock({ strategy: strategy('exhaust') }))?.name).toBe('Exhaust');
    });

    it('names a Coordinated Sources clock by its router', () => {
        const coordinated = clock({ strategy: coordinatedSources() });
        expect(strategyNameOf(coordinated)).toBe('Coordinated Sources');
        expect(familyCopyOf(coordinated)?.line).toContain('own enable windows');
    });

    it('says Direct in the (i) of a clock that follows one strategy, and not for Coordinated Sources', () => {
        expect(directRouterOf(clock())?.name).toBe('Direct');
        expect(directRouterOf(clock({ strategy: coordinatedSources() }))).toBeNull();
        expect(directRouterOf({ label: 'kept' })).toBeNull();
        expect(labels(clock())).not.toContain('Direct');
    });

    it('names a clock kept before the strategy was carried by its engine label, with no chips', () => {
        const kept = { label: 'Batched swings: 2 output swings per cycle' };
        expect(strategyNameOf(kept)).toBe(kept.label);
        expect(familyCopyOf(kept)).toBeNull();
        expect(clockChipsOf(kept)).toEqual([]);
        expect(fullClockName(kept)).toBe(kept.label);
    });

    it('reads a name, a line, a definition and a practice from the catalog for every strategy, and no old name', () => {
        for (const id of STRATEGIES) {
            const row = familyCopyOf(clock({ strategy: strategy(id) }));
            expect(row).not.toBeNull();
            for (const text of [row?.name, row?.line, row?.definition, row?.practice]) expect(text?.length).toBeGreaterThan(0);
            expect(JSON.stringify(row)).not.toMatch(/Batched swings|Small batches|Observed windows|Even hands|Shifted swings|Coordinated signal|wake-up|wake window|target output/i);
        }
    });
});

describe('the tuning method and selection chips', () => {
    it('come first after the name, with a tooltip each', () => {
        const chips = clockChipsOf(clock());
        expect(chips.map(chip => [chip.id, chip.label])).toEqual([['tuning_method', 'calculated'], ['selection', 'one version'], ['output_count:output_swings', swingsChip()]]);
        expect(chips[0].line).toContain('calculated from the build');
        expect(chips[1].line.length).toBeGreaterThan(0);
    });

    it('tell the two Takt Batches apart by the tuning method', () => {
        expect(labels(clock())).toContain('calculated');
        expect(labels(clock({ strategy: strategy('takt_batches', 'observed') }))).toContain('observed');
    });

    it('say observed and found by search for the searched strategies, the selection once', () => {
        expect(labels(clock({ strategy: strategy('pitch_pickups', 'observed') }))).toEqual(['observed', 'found by search', swingsChip()]);
    });

    it('say best of several versions for Round-Robin Polling and have no tuning method for Coordinated Sources', () => {
        expect(labels(clock({ strategy: strategy('round_robin_polling') }))).toEqual(['calculated', 'best of several versions', swingsChip()]);
        expect(labels(clock({ strategy: coordinatedSources() }))).toEqual(['best of several versions', swingsChip()]);
    });
});

describe('sourceLinesOf', () => {
    it('is empty for a clock with no routing, a direct one, and a Coordinated Sources one with no sources', () => {
        expect(sourceLinesOf(clock())).toEqual([]);
        expect(sourceLinesOf(clock({ strategy: strategy('takt_batches') }))).toEqual([]);
        expect(sourceLinesOf(clock({ strategy: coordinatedSources() }))).toEqual([]);
        expect(sourceLinesOf({ label: 'kept' })).toEqual([]);
    });

    it('says what each source was given: a strategy name and tuning method, or "always enabled" and its reason', () => {
        const observed = { kind: 'strategy', id: 'takt_batches', tuning_method: 'observed' } as const;
        const polling = { kind: 'strategy', id: 'round_robin_polling', tuning_method: 'calculated' } as const;
        const coordinated = clock({
            strategy: coordinatedSources([
                { source: 'machine:2', entities: { 'inserter:3': observed, 'inserter:4': observed } },
                { source: 'chest:1', entities: { 'inserter:5': { kind: 'always_on', reason: { kind: 'loop' } } } },
                { source: 'belt:1', entities: { 'inserter:6': polling, 'drill:1': { kind: 'always_on', reason: { kind: 'no-swing' } } } },
            ]),
        });
        const lines = sourceLinesOf(coordinated);
        expect(lines[0]).toBe('Machine 2 → Takt Batches · observed');
        expect(lines[1]).toMatch(/^Chest 1 → always enabled: it moves items between machines/);
        expect(lines[2]).toMatch(/^Belt 1 → Inserter 6: Round-Robin Polling · calculated; Drill 1: always enabled: /);
    });
});

describe('the chips of the settings', () => {
    it('say the output swings each output cycle', () => {
        expect(labels(clock())).toContain(swingsChip());
        expect(labels(clock({ strategy: strategy('takt_batches', 'calculated', plain(1)) }))).toContain(swingsChip(1));
    });

    it('say the hands brought in for a target that counts an item destroyed', () => {
        const settings: ClockSettings = { ...plain(), output_count: { kind: 'hands_brought_in', count: 3 } };
        expect(labels(clock({ strategy: strategy('time_division_windows', 'calculated', settings) }))).toContain(swingsChip(3, 'hands_brought_in'));
    });

    it('say the ticks a rounded clock is rounded to, and how fast it runs', () => {
        const rounded = (runs_fast: number) => clock({ strategy: strategy('takt_batches', 'calculated', { ...plain(), window_cycle: [{ kind: 'rounded_clock', window_cycle_ticks: 600, runs_fast }] }) });
        expect(labels(rounded(0.0002)).slice(2)).toEqual([swingsChip(), 'rounded to 600 ticks, 0.02% fast']);
        expect(labels(rounded(0.000001))[3]).toBe('rounded to 600 ticks, under 0.01% fast');
    });

    it('have a label and a line for every value the engine can carry', () => {
        const settings: ClockSettings = {
            output_count: { kind: 'output_swings', count: 2 },
            window_cycle: [{ kind: 'shorter_window_cycle' }, { kind: 'harmonic_window_cycle' }, { kind: 'subtick_clock' }, { kind: 'rounded_clock', window_cycle_ticks: 1199, runs_fast: 0.0008 }],
            shared_windows: 'window_a_swing', loops: 'loop_windows', drill_windows: 'a_tick_longer', belt_pickups: ['counted_from_entry', 'room_for_a_hand_of_fuel'],
        };
        const chips = clockChipsOf(clock({ strategy: strategy('takt_batches', 'calculated', settings) }));
        expect(chips.map(chip => chip.id)).toEqual(['tuning_method', 'selection', 'output_count:output_swings', 'window_cycle:shorter_window_cycle',
            'window_cycle:harmonic_window_cycle', 'window_cycle:subtick_clock', 'window_cycle:rounded_clock', 'shared_windows:window_a_swing', 'loops:loop_windows',
            'drill_windows:a_tick_longer', 'belt_pickups:counted_from_entry', 'belt_pickups:room_for_a_hand_of_fuel']);
        for (const chip of chips) {
            expect(chip.label.length).toBeGreaterThan(0);
            expect(chip.line.length, chip.id).toBeGreaterThan(0);
            expect(chip.label + chip.line).not.toMatch(/wake-up|window cycle time|\bperiod\b|whole swings only/i);
        }
        const others = clockChipsOf(clock({ strategy: strategy('takt_batches', 'calculated', { ...plain(), shared_windows: 'shared_enable_windows', loops: 'loop_exits_only' }) }));
        expect(others.slice(2).map(chip => [chip.id, chip.line.length > 0])).toEqual([['output_count:output_swings', true], ['shared_windows:shared_enable_windows', true], ['loops:loop_exits_only', true]]);
    });

    it('cite a source for the harmonic window cycle, the kanban latch and the split-time controller', () => {
        const harmonic = clockChipsOf(clock({ strategy: strategy('takt_batches', 'calculated', { ...plain(), window_cycle: [{ kind: 'harmonic_window_cycle' }] }) }))[3];
        expect(harmonic.line).toContain('Spectral Audio Signal Processing');
        const kanban = clockChipsOf(clock({ strategy: strategy('takt_batches', 'calculated', { ...plain(), loops: 'loop_windows' }) }))[3];
        expect(kanban.line).toContain('hysteresis');
        expect(familyCopyOf(clock({ strategy: strategy('euclidean_swings', 'observed') }))?.practice).toContain('split-time controller');
    });

    it('call the subtick window cycle the subtick clock', () => {
        const subtick = clockChipsOf(clock({ strategy: strategy('takt_batches', 'calculated', { ...plain(), window_cycle: [{ kind: 'subtick_clock' }] }) }))[3];
        expect(subtick.label).toBe('subtick clock');
    });
});

describe('fullClockName', () => {
    it('joins the name and the chips', () => {
        const shared = clock({ strategy: strategy('round_robin_polling', 'calculated', { ...plain(), shared_windows: 'shared_enable_windows' }) });
        expect(fullClockName(shared)).toBe(['Round-Robin Polling', 'calculated', 'best of several versions', swingsChip(), 'shared enable windows'].join(CHIP_SEPARATOR));
    });
});

describe('pendingClockName', () => {
    it('names a task whose strategy is known by its strategy', () => {
        expect(pendingClockName({ id: 'derived', label: 'Observed windows' })).toBe('Time-Study Windows');
        expect(pendingClockName({ id: 'full-hand', label: 'Full-hand output swings' })).toBe('Pitch Pickups');
        expect(pendingClockName({ id: 'primitive-grouped', label: 'Small batches' })).toBe('Round-Robin Polling');
        expect(pendingClockName({ id: 'per-branch', label: 'Coordinated sources' })).toBe('Coordinated Sources');
    });

    it('names a count of output swings by the count alone, as its strategy is known only after the run', () => {
        expect(pendingClockName({ id: 'swings-6', label: '6 output swings each output cycle' })).toBe('6 output swings each output cycle');
        expect(pendingClockName({ id: 'swings-1', label: '1 output swing each output cycle' })).toBe('1 output swing each output cycle');
    });

    it('keeps the label of a task it does not know', () => {
        expect(pendingClockName({ id: 'other', label: 'Other clock' })).toBe('Other clock');
    });
});
