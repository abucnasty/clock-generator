import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfigFromFile } from '../config/loader';
import { ConfigPaths } from '../config/config-paths';
import type { Config } from '../config';
import { SimulationContext } from './sequence/simulation-context';
import { TimelineRecorder } from './timeline-recording';
import { runBuild, trialRunOf } from './plan/plan-run';
import { recordSimulationTimeline } from './record-timeline';
import { quiet } from './generate-blueprint-test-helpers';

let config: Config;
beforeAll(async () => { config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE); });

describe('optional timeline observer', () => {
    it('records baseline values without inventing warm-up events, and exact partial drops with the previous hand item', () => {
        const context = SimulationContext.fromConfig(config);
        const state = context.inserters[0].inserter_state;
        state.items_picked_up = 200; state.items_dropped = 190;
        state.held_item = { item_name: 'electromagnetic-science-pack', quantity: 10 };
        const recorder = new TimelineRecorder(context, { period_ticks: 20 });
        const initial = recorder.recording('clock', 20, 100, 11);
        expect(initial.events).toEqual([]);
        expect(initial.entities.find(e => e.id === state.entity_id.id)?.signals.find(s => s.id === 'hand')).toMatchObject({ ticks: [0], values: [10] });
        state.items_dropped += 3; state.held_item.quantity -= 3; recorder.record();
        state.items_dropped += 7; state.held_item = null; recorder.record();
        state.items_picked_up += 4; state.held_item = { item_name: 'accumulator', quantity: 4 }; recorder.record();
        const recording = recorder.recording('clock', 20, 100, 11);
        expect(recording.events).toEqual([
            expect.objectContaining({ tick: 1, kind: 'drop', item: 'electromagnetic-science-pack', amount: 3 }),
            expect.objectContaining({ tick: 2, kind: 'drop', item: 'electromagnetic-science-pack', amount: 7 }),
            expect.objectContaining({ tick: 3, kind: 'pickup', item: 'accumulator', amount: 4 }),
        ]);
        expect(recording).toMatchObject({ end_tick: 3, ticks_before_recording: 100, copies: 11, truncated: false });
    });

    it('keeps crafts, productivity payouts, and released product quantities distinct', () => {
        const context = SimulationContext.fromConfig(config);
        const state = context.machines[0].machine_state;
        state.craftCount = 10; state.productsFinished = 12; state.totalCrafted = 300;
        const recorder = new TimelineRecorder(context, { period_ticks: 20 });
        state.craftsStarted += 1; state.craftCount += 1; state.productsFinished += 3; state.totalCrafted += 9;
        recorder.record();
        expect(recorder.recording('plan', 20, 0, 1).events).toEqual([
            expect.objectContaining({ kind: 'craft-start', amount: 1 }),
            expect.objectContaining({ kind: 'craft-complete', amount: 1 }),
            expect.objectContaining({ kind: 'productivity-payout', amount: 2 }),
            expect.objectContaining({ kind: 'produce', amount: 9, item: 'electromagnetic-science-pack' }),
        ]);
    });

    it('clips whole ticks, preserves the baseline and never changes simulation state', () => {
        const context = SimulationContext.fromConfig(config);
        const state = context.machines[0].machine_state;
        const before = JSON.stringify(state);
        const recorder = new TimelineRecorder(context, { period_ticks: 20, max_ticks: 2 });
        for (let tick = 0; tick < 5; tick++) recorder.record();
        expect(recorder.recording('clock', 20, 0, 1)).toMatchObject({ end_tick: 2, truncated: true });
        expect(JSON.stringify(state)).toBe(before);
        const bounded = new TimelineRecorder(context, { period_ticks: 20, max_points: 1 });
        bounded.record();
        expect(bounded.recording('clock', 20, 0, 1)).toMatchObject({ end_tick: 0, truncated: true });
    });

    it('does not change the normal run or its histories and records the requested period on demand', () => {
        const plain = runBuild(config, { logger: quiet });
        const detailed = runBuild(config, { logger: quiet, timeline_recording: { period_ticks: plain.duration.ticks } });
        expect(plain.timeline_recording).toBeUndefined();
        expect(trialRunOf(detailed).serializable_transfer_history).toEqual(trialRunOf(plain).serializable_transfer_history);
        expect(trialRunOf(detailed).serializable_state_transition_history).toEqual(trialRunOf(plain).serializable_state_transition_history);
        const before = JSON.stringify(config);
        const request = { config, mode: 'clock' as const, period_ticks: plain.duration.ticks,
            terminal_swing_count: 2, windows: {} };
        const recorded = recordSimulationTimeline(request);
        expect(recorded.end_tick).toBe(request.period_ticks);
        expect(recorded.events.some(event => event.kind === 'drop' && event.amount > 0 && event.item)).toBe(true);
        expect(recorded.entities.find(e => e.id === 'machine:1')?.signals.find(s => s.id === 'input:accumulator')?.ticks[0]).toBe(0);
        expect(recorded.ticks_before_recording).toBeGreaterThan(0);
        expect(JSON.stringify(config)).toBe(before);
        expect(() => recordSimulationTimeline({ ...request, period_ticks: 0 })).toThrow('cannot be recorded');
    });
});

it('records real burner inventory and energy while replaying the saved independent fuel clock', async () => {
    const fuelConfig = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
    const planned = runBuild(fuelConfig, { logger: quiet });
    const clocks = Object.fromEntries([...planned.inserter_clocks].map(([id, clock]) => [id, {
        ...clock, window: { start: clock.window.start_inclusive, end: clock.window.end_inclusive },
    }]));
    const recording = recordSimulationTimeline({ config: fuelConfig, mode: 'clock', period_ticks: planned.duration.ticks,
        terminal_swing_count: planned.used_terminal_swing_count, windows: {}, inserter_clocks: clocks });
    const machine = recording.entities.find(entity => entity.type === 'machine' && entity.signals.some(signal => signal.id === 'fuel'))!;
    expect(machine.signals.find(signal => signal.id === 'fuel')?.unit).toBe('items');
    expect(machine.signals.find(signal => signal.id === 'burning')?.values.some(value => Number(value) > 0)).toBe(true);
    const fuelId = [...planned.inserter_clocks].find(([, clock]) => clock.own_clock)![0];
    const enabled = recording.entities.find(entity => entity.id === fuelId)!.signals.find(signal => signal.id === 'enabled')!;
    expect(enabled.ticks[0]).toBe(0);
    expect(enabled.values).toContain(0);
    expect(enabled.values).toContain(1);
});
