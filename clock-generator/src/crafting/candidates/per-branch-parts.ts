import type { AlwaysOnReasons } from "../always-on-reasons";
import type { SerializableClockWindows } from "../clock";
import type { ClockStrategy } from "../clock-strategy";

/**
 * The parts the per-branch clock is composed from (per-branch.ts): every clock the other makers built for the build, with
 * its windows. A part gives windows to the groups of inserters it has; it never adds a window of its own. Plain data, so
 * that the runs of a generation can carry their parts from the workers that made them to the one that composes the clock.
 */
export interface PerBranchPart {
    /** What made it, for the planning log: the alternative's id, or the way of the grouped hands rule */
    name: string;
    /** The listed alternative it is, where it is one; a way of a construction is none */
    alternative_id?: string;
    /** The alternative's verdict; absent for a way */
    verdict?: "stable" | "no recovery" | "unstable";
    /**
     * The strategy of its clock (family and construction): set for an alternative by `perBranchInputOf`, from the alternatives of the
     * runs; a way of the grouped hands rule has none and is Round-Robin Polling by the grouped hands construction
     */
    strategy?: Pick<ClockStrategy, "family" | "construction">;
    /** The ticks of its period, the period its windows are of */
    period_ticks: number;
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
export interface PerBranchInput {
    recommended_id: string;
    parts: PerBranchPart[];
}

/** The parts being collected, innermost last: a part offered goes to every one */
const collecting: PerBranchPart[][] = [];

/** Offers a part to the collections open now (`collectingParts`); nothing where none is open */
export function offerPart(part: PerBranchPart): void {
    for (const parts of collecting) parts.push(part);
}

/** Whether a part offered now would be collected: where none is, a maker does not prepare one */
export function partsWanted(): boolean {
    return collecting.length > 0;
}

/** Runs `work` and gives what it returned with the parts offered while it ran */
export function collectingParts<T>(work: () => T): { value: T; parts: PerBranchPart[] } {
    const parts: PerBranchPart[] = [];
    collecting.push(parts);
    try {
        return { value: work(), parts };
    } finally {
        collecting.splice(collecting.lastIndexOf(parts), 1);
    }
}

/** A part's key: its period and its windows, inserter by inserter in the order of their ids */
export function partKey(part: Pick<PerBranchPart, "period_ticks" | "windows">): string {
    const ids = Object.keys(part.windows).filter(id => part.windows[id].length > 0).sort();
    return `${part.period_ticks}|${ids.map(id => `${id}:${part.windows[id].map(range => `${range.start}-${range.end}`).join(",")}`).join(";")}`;
}

/** The strategy of a way: the grouped hands rule makes every way, so each is Round-Robin Polling by the grouped hands construction */
const WAY_STRATEGY: Pick<ClockStrategy, "family" | "construction"> = { family: "round-robin-polling", construction: "grouped-hands" };

/** What `perBranchInputOf` reads of a run: its parts, the alternatives it lists (for their strategies), and the runs listed after it */
interface RunWithParts {
    parts?: PerBranchPart[];
    alternatives?: readonly { id: string; strategy: Pick<ClockStrategy, "family" | "construction"> }[];
    also?: RunWithParts[];
}

/**
 * The input of the per-branch clock from the runs of a generation and the id of the clock they recommend: the parts of
 * every run, the stable alternatives first in the order they are listed, then the ways of the constructions in the order
 * they were made, each set of windows once (a counted one before one not yet counted), and the recommended clock itself
 * where it is not among them (a clock that is not stable is a part only where it is the recommended one)
 */
export function perBranchInputOf(runs: readonly (RunWithParts | null)[], recommended_id: string): PerBranchInput {
    const all: PerBranchPart[] = [];
    const strategies = new Map<string, Pick<ClockStrategy, "family" | "construction">>();
    const walk = (run: RunWithParts | null | undefined): void => {
        if (run === null || run === undefined) return;
        for (const alternative of run.alternatives ?? []) strategies.set(alternative.id, alternative.strategy);
        all.push(...(run.parts ?? []));
        run.also?.forEach(walk);
    };
    runs.forEach(walk);
    for (const [index, part] of all.entries()) {
        const strategy = part.alternative_id === undefined ? WAY_STRATEGY : strategies.get(part.alternative_id);
        if (strategy !== undefined) all[index] = { ...part, strategy: { family: strategy.family, ...(strategy.construction !== undefined && { construction: strategy.construction }) } };
    }
    const ordered = [...all.filter(part => part.alternative_id !== undefined && part.verdict === "stable"),
        ...all.filter(part => part.alternative_id === undefined)];
    const kept = new Map<string, PerBranchPart>();
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
