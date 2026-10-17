import type { TimelineRange } from './timelineInspection';

export interface CraftingCycle extends TimelineRange { partial: boolean }
export interface CraftingCycles { cycleTicks: number; end: number; count: number }

/** The Swing Plan's saved cycle length defines the segments. Actual craft events do not define these boundaries.
 * Keep the model constant-sized even when a fractional cycle gives a large cycle count. */
export function craftingCycles(cycleTicks: number, end: number): CraftingCycles | null {
    if (!Number.isFinite(cycleTicks) || cycleTicks <= 0 || !Number.isFinite(end) || end <= 0) return null;
    const ratio = end / cycleTicks;
    const nearInteger = Math.abs(ratio - Math.round(ratio)) < 1e-9;
    const count = Math.max(1, nearInteger ? Math.round(ratio) : Math.ceil(ratio));
    return Number.isSafeInteger(count) ? { cycleTicks, end, count } : null;
}

export function craftingCycleAt(cycles: CraftingCycles | null, index: number): CraftingCycle | null {
    if (!cycles || !Number.isInteger(index) || index < 0 || index >= cycles.count) return null;
    const start = index * cycles.cycleTicks;
    const nominalEnd = (index + 1) * cycles.cycleTicks;
    return { start, end: Math.min(cycles.end, nominalEnd), partial: nominalEnd - cycles.end > 1e-7 };
}

export function craftingCycleIndex(cycles: CraftingCycles | null, tick: number): number {
    return cycles ? Math.max(0, Math.min(cycles.count - 1, Math.floor(tick / cycles.cycleTicks + 1e-9))) : 0;
}

export function craftingCycleRange(cycle: CraftingCycle, end: number): TimelineRange {
    return { start: cycle.start, end: Math.min(end, cycle.end) };
}
