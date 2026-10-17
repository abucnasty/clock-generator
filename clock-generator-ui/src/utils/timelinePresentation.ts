import type { TimelineEntity, TimelineSeries } from 'clock-generator/browser';
import type { TimelineInspection, TimelineSignalGroup } from './timelineInspection';
import type { ItemChartStyle } from '../theme/beltCharts';

const STATE_LABELS: Record<string, string> = {
    working: 'Working', item_ingredient_shortage: 'Waiting for ingredients', full_output: 'Output buffer full',
    no_fuel: 'Waiting for fuel', waiting_for_source_items: 'Waiting for source items',
    waiting_for_more_items: 'Waiting for more items', waiting_for_space_in_destination: 'Waiting for destination space',
    disabled_by_control_behavior: 'Disabled by control', disabled: 'Disabled by control',
};
export function timelineStateLabel(state: string): string {
    const normalized = state.toLowerCase();
    const words = normalized.replaceAll('_', ' ');
    return STATE_LABELS[normalized] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

const STATE_STYLES: Record<string, ItemChartStyle> = {
    working: { color: '#009E73', pattern: 'solid' },
    waiting_for_source_items: { color: '#F0E442', pattern: 'diagonal' },
    waiting_for_more_items: { color: '#E69F00', pattern: 'horizontal' },
    item_ingredient_shortage: { color: '#F0E442', pattern: 'dots' },
    no_fuel: { color: '#D55E00', pattern: 'diagonal' },
    full_output: { color: '#CC79A7', pattern: 'dots' },
    waiting_for_space_in_destination: { color: '#CC79A7', pattern: 'horizontal' },
    disabled_by_control_behavior: { color: '#707070', pattern: 'solid' },
    disabled: { color: '#707070', pattern: 'solid' },
};

/** Distinct recorded states keep distinct cues in both the legend and plotted bands. */
export function timelineStateStyle(state: string): ItemChartStyle {
    const value = state.toLowerCase();
    if (STATE_STYLES[value]) return STATE_STYLES[value];
    if (value.includes('full') || value.includes('space')) return { color: '#CC79A7', pattern: 'dots' };
    if (value.includes('shortage') || value.includes('waiting') || value === 'no_fuel') return { color: '#F0E442', pattern: 'diagonal' };
    return { color: '#707070', pattern: 'solid' };
}

export function timelineSignalVisible(entity: TimelineEntity, series: TimelineSeries, view: TimelineInspection['view'], groups: readonly TimelineSignalGroup[]): boolean {
    if (view === 'windows') return false;
    if (view === 'flow') return ['state', 'hand'].includes(series.group) || series.id === 'produced' || series.id === 'craft';
    if (view === 'states') return series.group === 'state';
    if (view === 'transfers') return ['state', 'hand'].includes(series.group) || series.id === 'produced';
    if (series.id === 'produced' && groups.includes('transfers')) return true;
    return groups.includes(entity.type === 'machine' && series.id.startsWith('output:') ? 'buffers' : series.group);
}

/** Keep existing choices, adding only the evidence required by this pause. */
export function signalsForTimelinePause(groups: readonly TimelineSignalGroup[], state: string): TimelineSignalGroup[] {
    const needed: TimelineSignalGroup[] = ['state', 'inventory', 'transfers'];
    if (state === 'full_output' || state === 'waiting_for_space_in_destination') needed.push('buffers');
    if (state === 'no_fuel') needed.push('fuel');
    return [...new Set([...groups, ...needed])];
}
