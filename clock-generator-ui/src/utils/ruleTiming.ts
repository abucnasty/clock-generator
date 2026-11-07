/**
 * What the rule editor knows of the clock it edits a rule for: the output cycle, the window cycle and, from Results,
 * the clock's own wake windows. Pure functions; App works out which source is current, and `RuleTimingContext` hands it
 * to the rule form wherever it is mounted.
 */
import type { SerializableClockWindows } from 'clock-generator/browser';
import { normalizeWindows } from './wakeWindows';

export interface RuleTiming {
    /** One output cycle, in ticks */
    cycleTicks: number | null;
    /** The window cycle, in ticks: a whole number of output cycles, fractional for a subtick clock */
    windowCycleTicks: number | null;
    /** Where the numbers come from: the clock on Results for this build, the last check, or nowhere yet */
    from: 'results' | 'check' | null;
    /** The selected clock's windows by entity id ("inserter:3"); only from Results */
    windows: SerializableClockWindows | null;
}

export const NO_TIMING: RuleTiming = { cycleTicks: null, windowCycleTicks: null, from: null, windows: null };

interface TimingInput {
    /** The selected clock, only when its generation is for the build as it is now */
    results: { cycleTicks: number; windowCycleTicks: number; windows: SerializableClockWindows } | null;
    /** The last check, only when it is for the build as it is now */
    check: { cycleTicks: number; windowCycleTicks: number } | null;
}

/** Results first, as a generation can lower the output swings and so change the cycle the check planned */
export function ruleTimingOf({ results, check }: TimingInput): RuleTiming {
    if (results) {
        return { cycleTicks: results.cycleTicks, windowCycleTicks: results.windowCycleTicks, from: 'results', windows: results.windows };
    }
    if (check) {
        return { cycleTicks: check.cycleTicks, windowCycleTicks: check.windowCycleTicks, from: 'check', windows: null };
    }
    return NO_TIMING;
}

/** The engine's id of an entity, as the clock's windows are keyed: "inserter:3", "drill:1" */
export function entityKey(entityType: 'inserter' | 'drill', id: number): string {
    return `${entityType}:${id}`;
}

/**
 * The clock's wake windows for one entity, as a Clocked rule would hold them: within the window cycle, in order, a window that
 * wraps past the end of the window cycle as two. Null unless they come from Results, the window cycle is a whole number of ticks
 * (a rule can't repeat with any other) and the entity has a window.
 */
export function plannedWindowsOf(timing: RuleTiming, key: string): { start: number; end: number }[] | null {
    const window_cycle_ticks = timing.windowCycleTicks;
    if (timing.from !== 'results' || timing.windows === null || window_cycle_ticks === null || !Number.isInteger(window_cycle_ticks)) return null;
    const raw = timing.windows[key];
    if (raw === undefined) return null;
    const ranges = normalizeWindows(raw, window_cycle_ticks)
        .flatMap((window) => window.segments)
        // a window that wraps by one tick ends its second part at tick 0, which a rule can't hold (its end is 1 or
        // more): it is widened to ticks 0–1. The windows are merged, so the next one starts at 2 or later
        .map((range) => (range.start === 0 && range.end === 0 ? { start: 0, end: 1 } : range))
        .sort((a, b) => a.start - b.start);
    return ranges.length > 0 ? ranges : null;
}

/** A tick count as text: whole numbers as they are, others with 3 decimals ("264", "550.957") */
export function ticksText(ticks: number): string {
    return Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);
}
