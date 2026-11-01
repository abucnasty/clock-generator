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

export interface AttributedCall {
    event: string;
    role: string;
    kind: string;
    /** Explicit caller attribution, never inferred from a method name or a visible status. */
    origin: "native" | "probe";
}

/** Count invocation entries, excluding observation-induced work and returns. No price conversion. */
export function nativeCallCounts(events: readonly AttributedCall[]): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const event of events) {
        if (event.kind !== "call" || event.origin !== "native") continue;
        const calls = result[event.role] ??= {};
        calls[event.event] = (calls[event.event] ?? 0) + 1;
    }
    return result;
}
