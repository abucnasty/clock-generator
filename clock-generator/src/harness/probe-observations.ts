/** A probe's tick origin is installation time, separate from the recorder's final start. */
export interface ProbeTimeline {
    started: number;
    samples: {game_tick: number}[];
    interventions?: {game_tick?: number}[];
}

/**
 * Normalize only a declared constant origin. Preserve every other field, including local ticks,
 * conditions, energy and interventions; never align rows by their output or fit a phase shift.
 */
export function normalizeProbeOrigin<T extends ProbeTimeline>(report: T): T {
    const result = structuredClone(report);
    const origin = result.started;
    result.started = 0;
    for (const row of result.samples) row.game_tick -= origin;
    for (const row of result.interventions ?? []) if (row.game_tick !== undefined) row.game_tick -= origin;
    return result;
}

/** Independent workers may interleave differently; preserve the exact sequence within each role. */
export function roleSequences<T extends {role: string}>(events: readonly T[]): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const event of events) (result[event.role] ??= []).push(event);
    return result;
}

export interface AttributedObservation {
    event: string;
    stage: string;
    role: string;
    phase: string;
    /** Explicit attribution; observation-induced checks are not ordinary game actions. */
    origin: "game" | "observation";
}

/** Count bounded observed event beginnings. No rate or price conversion. */
export function observedEventCounts(events: readonly AttributedObservation[]): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const event of events) {
        if (event.phase !== "begin" || event.origin !== "game") continue;
        const counts = result[event.role] ??= {};
        const key = `${event.event}:${event.stage}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return result;
}
