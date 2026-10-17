import { expect, it } from 'vitest';
import type { TimelineEntity, TimelineSeries } from 'clock-generator/browser';
import { signalsForTimelinePause, timelineSignalVisible, timelineStateLabel, timelineStateStyle } from './timelinePresentation';
const entity = { id: 'machine:1', type: 'machine', items: [], signals: [] } as TimelineEntity;
const output: TimelineSeries = { id: 'output:iron-plate', label: 'Output', group: 'inventory', unit: 'items', ticks: [0], values: [0] };
it('reveals output and fuel evidence without dropping the user’s existing signal choices', () => {
    const outputGroups = signalsForTimelinePause(['hand', 'progress'], 'full_output');
    expect(outputGroups).toEqual(expect.arrayContaining(['hand', 'progress', 'state', 'inventory', 'transfers', 'buffers']));
    expect(timelineSignalVisible(entity, output, 'activity', outputGroups)).toBe(true);
    const fuel = { ...output, id: 'fuel', group: 'fuel' as const };
    expect(timelineSignalVisible(entity, fuel, 'activity', signalsForTimelinePause([], 'no_fuel'))).toBe(true);
    expect(signalsForTimelinePause([], 'waiting_for_space_in_destination')).toContain('buffers');
    expect(signalsForTimelinePause(['inventory'], 'item_ingredient_shortage')).not.toContain('buffers');
    expect(signalsForTimelinePause(['inventory'], 'item_ingredient_shortage')).not.toContain('fuel');
});
it('aligns the inspector with visible chart signals, including the products-made total', () => {
    const groups = ['state', 'inventory', 'transfers'] as const;
    expect(timelineSignalVisible(entity, output, 'activity', groups)).toBe(false);
    expect(timelineSignalVisible(entity, { ...output, id: 'input:iron-plate' }, 'activity', groups)).toBe(true);
    expect(timelineSignalVisible(entity, { ...output, id: 'produced', group: 'production' }, 'activity', groups)).toBe(true);
    expect(timelineSignalVisible(entity, { ...output, id: 'craft', group: 'progress' }, 'activity', groups)).toBe(false);
    expect(timelineSignalVisible(entity, output, 'states', ['buffers'])).toBe(false);
});
it('uses calm state names and non-color cues consistently', () => {
    expect(timelineStateLabel('item_ingredient_shortage')).toBe('Waiting for ingredients');
    expect(timelineStateLabel('full_output')).toBe('Output buffer full');
    expect(timelineStateLabel('WORKING')).toBe('Working');
    expect(timelineStateStyle('item_ingredient_shortage').pattern).toBe('dots');
    expect(timelineStateStyle('full_output').pattern).toBe('dots');
    expect(timelineStateStyle('working').pattern).toBe('solid');
});
it('distinguishes an empty source from waiting to fill a hand by both hue and pattern', () => {
    const source = timelineStateStyle('waiting_for_source_items');
    const more = timelineStateStyle('waiting_for_more_items');
    expect(source.color).not.toBe(more.color);
    expect(source.pattern).not.toBe(more.pattern);
    expect(timelineStateStyle('WAITING_FOR_MORE_ITEMS')).toEqual(more);
});
it('keeps every distinct recorded state visually identifiable when shown together', () => {
    const states = ['working', 'waiting_for_source_items', 'waiting_for_more_items', 'item_ingredient_shortage',
        'no_fuel', 'full_output', 'waiting_for_space_in_destination', 'disabled_by_control_behavior'];
    const cues = states.map(state => {
        const { color, pattern } = timelineStateStyle(state);
        return `${color}/${pattern}`;
    });
    expect(new Set(cues).size).toBe(states.length);
    expect(timelineStateStyle('disabled')).toEqual(timelineStateStyle('disabled_by_control_behavior'));
});
