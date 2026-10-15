/**
 * What the rule editor knows of the clock it edits a rule for: the crafting cycle, the clock period and, from Results,
 * the clock's own wake windows. Pure functions; App works out which source is current, and `RuleTimingContext` hands it
 * to the rule form wherever it is mounted.
 */
import type { SerializableClockWindows } from 'clock-generator/browser';
import { normalizeWindows } from './wakeWindows';

export interface RuleTiming {
    /** One crafting cycle, in ticks */
    cycleTicks: number | null;
    /** The clock period, in ticks: a whole number of crafting cycles, fractional for a subtick clock */
    periodTicks: number | null;
    /** Where the numbers come from: the clock on Results for this build, the last check, or nowhere yet */
    from: 'results' | 'check' | null;
    /** The selected clock's windows by entity id ("inserter:3"); only from Results */
    windows: SerializableClockWindows | null;
}

export const NO_TIMING: RuleTiming = { cycleTicks: null, periodTicks: null, from: null, windows: null };

interface TimingInput {
    /** The selected clock, only when its generation is for the build as it is now */
    results: { cycleTicks: number; periodTicks: number; windows: SerializableClockWindows } | null;
    /** The last check, only when it is for the build as it is now */
    check: { cycleTicks: number; periodTicks: number } | null;
}

/** Results first, as a generation can lower the output swings and so change the cycle the check planned */
export function ruleTimingOf({ results, check }: TimingInput): RuleTiming {
    if (results) {
        return { cycleTicks: results.cycleTicks, periodTicks: results.periodTicks, from: 'results', windows: results.windows };
    }
    if (check) {
        return { cycleTicks: check.cycleTicks, periodTicks: check.periodTicks, from: 'check', windows: null };
    }
    return NO_TIMING;
}

/** The engine's id of an entity, as the clock's windows are keyed: "inserter:3", "drill:1" */
export function entityKey(entityType: 'inserter' | 'drill', id: number): string {
    return `${entityType}:${id}`;
}

/**
 * The clock's wake windows for one entity, as a Clocked rule would hold them: within the period, in order, a window that
 * wraps past the end of the period as two. Null unless they come from Results, the period is a whole number of ticks
 * (a rule can't repeat with any other) and the entity has a window.
 */
export function plannedWindowsOf(timing: RuleTiming, key: string): { start: number; end: number }[] | null {
    const period = timing.periodTicks;
    if (timing.from !== 'results' || timing.windows === null || period === null || !Number.isInteger(period)) return null;
    const raw = timing.windows[key];
    if (raw === undefined) return null;
    const ranges = normalizeWindows(raw, period)
        .flatMap((window) => window.segments)
        .sort((a, b) => a.start - b.start);
    return ranges.length > 0 ? ranges : null;
}

/** A tick count as text: whole numbers as they are, others with 3 decimals ("264", "550.957") */
export function ticksText(ticks: number): string {
    return Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);
}
