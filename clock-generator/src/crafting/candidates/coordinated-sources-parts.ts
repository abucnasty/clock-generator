import type { AlwaysOnReasons } from "../enable-control-router";
import type { SerializableClockWindows } from "../clock";
import type { ClockStrategy, StrategyRef } from "../clock-strategy";

/**
 * The parts the per-branch clock is composed from (coordinated-sources.ts): every clock the other makers built for the build, with
 * its windows. A part gives windows to the groups of inserters it has; it never adds a window of its own. Plain data, so
 * that the runs of a generation can carry their parts from the workers that made them to the one that composes the clock.
 */
export interface CoordinatedSourcesPart {
    /** What made it, for the planning log: the alternative's id, or the way of the grouped hands rule */
    name: string;
    /** The listed alternative it is, where it is one; a way of a construction is none */
    alternative_id?: string;
    /** The alternative's verdict; absent for a way */
    verdict?: "stable" | "no recovery" | "unstable";
    /**
     * The wakeups a minute the selection ranks the alternative by (`ClockRanking.wake_ups_per_minute`; null where they were not
     * counted); absent for a way, and for a part carried from before it was set
     */
    wake_ups_per_minute?: number | null;
    /**
     * The strategy of its clock (family and construction): set for an alternative by `coordinatedSourcesInputOf`, from the alternatives of the
     * runs; a way of the grouped hands rule has none and is Round-Robin Polling by the grouped hands construction
     */
    strategy?: StrategyRef;
    /** The ticks of its window cycle, the window cycle its windows are of */
    window_cycle_ticks: number;
    windows: SerializableClockWindows;
    /**
     * Whether its own clock's long run was counted as built (the as-built check's wake-ups): a part without a count gives no
     * windows. Absent where it is not known yet (the per-hand shape of a way): the composition counts it.
     */
    counted?: boolean;
    /** Why it leaves inserters always enabled, where it says */
    always_on?: AlwaysOnReasons;
    /** How the plan its clock runs on is made (output swings, cycles, fractional swings); set for an alternative */
    plan?: { terminal_swing_count?: number; lcm?: number; fractional_swings?: true };
}

/** What the per-branch clock is composed from: today's recommended clock (by its id) and every part */
export interface CoordinatedSourcesInput {
    recommended_id: string;
    parts: CoordinatedSourcesPart[];
}

/** The parts being collected, innermost last: a part offered goes to every one */
const collecting: CoordinatedSourcesPart[][] = [];

/** Offers a part to the collections open now (`collectingParts`); nothing where none is open */
export function offerPart(part: CoordinatedSourcesPart): void {
    for (const parts of collecting) parts.push(part);
}

/** Whether a part offered now would be collected: where none is, a maker does not prepare one */
export function partsWanted(): boolean {
    return collecting.length > 0;
}

/** Runs `work` and gives what it returned with the parts offered while it ran */
export function collectingParts<T>(work: () => T): { value: T; parts: CoordinatedSourcesPart[] } {
    const parts: CoordinatedSourcesPart[] = [];
    collecting.push(parts);
    try {
        return { value: work(), parts };
    } finally {
        collecting.splice(collecting.lastIndexOf(parts), 1);
    }
}

/** A part's key: its window cycle and its windows, inserter by inserter in the order of their ids */
export function partKey(part: Pick<CoordinatedSourcesPart, "window_cycle_ticks" | "windows">): string {
    const ids = Object.keys(part.windows).filter(id => part.windows[id].length > 0).sort();
    return `${part.window_cycle_ticks}|${ids.map(id => `${id}:${part.windows[id].map(range => `${range.start}-${range.end}`).join(",")}`).join(";")}`;
}

/** The strategy of a way: the grouped hands rule makes every way, so each is Round-Robin Polling by the grouped hands construction */
const WAY_STRATEGY: StrategyRef = { id: "round_robin_polling", tuning_method: "calculated" };

/** What `coordinatedSourcesInputOf` reads of a run: its parts, the alternatives it lists (for their strategies), and the runs listed after it */
interface RunWithParts {
    parts?: CoordinatedSourcesPart[];
    alternatives?: readonly { id: string; strategy: ClockStrategy }[];
    also?: RunWithParts[];
}

/**
 * The input of the per-branch clock from the runs of a generation and the id of the clock they recommend: the parts of
 * every run, the stable alternatives first in the order they are listed, then the ways of the constructions in the order
 * they were made, each set of windows once (a counted one before one not yet counted), and the recommended clock itself
 * where it is not among them (a clock that is not stable is a part only where it is the recommended one)
 */
export function coordinatedSourcesInputOf(runs: readonly (RunWithParts | null)[], recommended_id: string): CoordinatedSourcesInput {
    const all: CoordinatedSourcesPart[] = [];
    const strategies = new Map<string, StrategyRef>();
    const walk = (run: RunWithParts | null | undefined): void => {
        if (run === null || run === undefined) return;
        for (const { id, strategy } of run.alternatives ?? []) if (strategy.id !== null && strategy.tuning_method !== null) strategies.set(id, { id: strategy.id, tuning_method: strategy.tuning_method });
        all.push(...(run.parts ?? []));
        run.also?.forEach(walk);
    };
    runs.forEach(walk);
    for (const [index, part] of all.entries()) {
        const strategy = part.alternative_id === undefined ? WAY_STRATEGY : strategies.get(part.alternative_id);
        if (strategy !== undefined) all[index] = { ...part, strategy };
    }
    const ordered = [...all.filter(part => part.alternative_id !== undefined && part.verdict === "stable"),
        ...all.filter(part => part.alternative_id === undefined)];
    const kept = new Map<string, CoordinatedSourcesPart>();
    for (const part of ordered) {
        const key = partKey(part);
        const known = kept.get(key);
        if (known === undefined) kept.set(key, part);
        else if (known.alternative_id === undefined && known.counted === undefined && part.counted !== undefined) kept.set(key, part);
    }
    const parts = [...kept.values()];
    const recommended = all.find(part => part.alternative_id === recommended_id);
    if (recommended !== undefined && !parts.includes(recommended)) parts.push(recommended);
    return { recommended_id, parts };
}
