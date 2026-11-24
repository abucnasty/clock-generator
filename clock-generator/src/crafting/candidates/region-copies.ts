// This step makes windows only by copying windows the clock already has from one region onto its copies, moved by one shift.
import type { Config } from "../../config";
import type { SerializableClockWindows } from "../clock";
import { regionOrbitsOfConfig, type FoundOrbit, type RegionOrbit } from "../graph/regions";
import { costKey } from "../rank";
import { recoveryWorse, type InputJointStage, type InputWindowJudge } from "./metered-input-windows";
import { enabledTicks, rangesOf, shiftedWindows } from "./staggered-input-windows";

type Range = { start: number; end: number };

/** Why the arms of an orbit keep the windows they have */
export type RegionCopyRetained = "no_orbit" | "capacity_short" | "no_map" | "uneven_shift" | "open_differs" | "joint_check_failed"
    | "not_better" | "more_deciders" | "recovery_worse";
type Copied = { kind: "copied"; region: string; from: string; shift_ticks: number };
export type RegionCopyDecision = Copied | { kind: "retained"; reason: RegionCopyRetained; stage?: InputJointStage };

/** One region's windows on every region of its orbit, moved by one shift onto the landing region's turns */
export interface RegionCopyCandidate {
    /** The region whose windows every region takes */
    from: string;
    shift_ticks: number;
    changes: SerializableClockWindows;
    copied: Record<string, Copied>;
}

/** The candidates of one orbit, or the code that stops it before any is judged; a candidate that cannot be made has its code */
export interface OrbitProposals {
    /** Every arm of the orbit's regions */
    arms: string[];
    candidates: RegionCopyCandidate[];
    /** Candidates that could not be made, by region, with their code */
    unmade: { from: string; reason: "uneven_shift" }[];
    /** A code for the whole orbit: from the finder, or an arm open in one region and clocked in another */
    refused?: "capacity_short" | "no_map" | "open_differs";
}

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** The distinct window sets of the clock's clocked entities: each is one enable decider of its blueprint */
export function decidersOf(clock: SerializableClockWindows, period: number): number {
    return new Set(Object.values(clock).filter(ranges => ranges.length > 0)
        .map(ranges => JSON.stringify(enabledTicks(ranges, period) === null ? ranges : rangesOf(enabledTicks(ranges, period)!)))).size;
}

/** Whether two window sets enable the same ticks */
const sameTicks = (a: readonly Range[], b: readonly Range[], period: number): boolean =>
    JSON.stringify(enabledTicks(a, period)) === JSON.stringify(enabledTicks(b, period));

/**
 * The shift that moves every metered taker of a region onto the ticks of its partner in the landing region: of those that do,
 * the one of least absolute value, a tie to the negative one. 0 where the region has no metered taker; null where no single
 * shift fits them all.
 */
export function shiftOnto(pairs: readonly { mine: readonly Range[]; theirs: readonly Range[] }[], period: number): number | null {
    if (pairs.length === 0) return 0;
    if (pairs.some(pair => enabledTicks(pair.mine, period) === null || enabledTicks(pair.theirs, period) === null)) return null;
    let best: number | null = null;
    for (let shift = 0; shift < period; shift++) {
        if (!pairs.every(pair => sameTicks(shiftedWindows(pair.mine, shift, period), pair.theirs, period))) continue;
        for (const value of [shift, shift - period]) {
            if (best === null || Math.abs(value) < Math.abs(best) || (Math.abs(value) === Math.abs(best) && value < best)) best = value;
        }
    }
    return best;
}

/** The candidates of one orbit on a clock (see `regionCopies`) */
export function orbitProposals(
    orbit: RegionOrbit, clock: SerializableClockWindows, period: number, metered: ReadonlySet<string>, open: ReadonlySet<string>,
): OrbitProposals {
    const { regions, maps } = orbit;
    const arms = regions.flatMap(region => region.arms);
    // the map from region j to region k: maps[k] after the inverse of maps[j]
    const inverse = maps.map(map => new Map(Object.entries(map).map(([zero, it]) => [it, zero])));
    const between = (j: number, k: number, id: string) => maps[k][inverse[j].get(id)!];
    const clocked = (id: string) => !open.has(id) && (clock[id]?.length ?? 0) > 0;
    // an arm clocked in one region and open in another stops the orbit
    for (const id of regions[0].arms) {
        if (new Set(regions.map((_, k) => clocked(between(0, k, id)))).size > 1) return { arms, candidates: [], unmade: [], refused: "open_differs" };
    }
    const takers = regions.map(region => region.arms.filter(id => metered.has(id) && clocked(id)));
    const opens = (id: string) => clock[id][0].start;
    // the landing region: the one whose first metered taker opens first, the lower-numbered on a tie
    let landing = 0;
    takers.forEach((ids, k) => {
        if (ids.length === 0) return;
        const first = Math.min(...ids.map(opens));
        const best = takers[landing].length === 0 ? Infinity : Math.min(...takers[landing].map(opens));
        if (first < best) landing = k;
    });
    const candidates: RegionCopyCandidate[] = [];
    const unmade: OrbitProposals["unmade"] = [];
    regions.forEach((region, j) => {
        const shift = shiftOnto(takers[j].map(id => ({ mine: clock[id], theirs: clock[between(j, landing, id)] })), period);
        if (shift === null || (shift !== 0 && region.arms.some(id => clocked(id) && enabledTicks(clock[id], period) === null))) {
            unmade.push({ from: region.key, reason: "uneven_shift" });
            return;
        }
        const changes: SerializableClockWindows = {};
        const copied: Record<string, Copied> = {};
        for (const id of region.arms) {
            if (!clocked(id)) continue;
            const moved = shift === 0 ? clock[id].map(range => ({ ...range })) : shiftedWindows(clock[id], mod(shift, period), period);
            regions.forEach((to, k) => {
                const target = between(j, k, id);
                changes[target] = moved.map(range => ({ ...range }));
                copied[target] = { kind: "copied", region: to.key, from: region.key, shift_ticks: shift };
            });
        }
        candidates.push({ from: region.key, shift_ticks: shift, changes, copied });
    });
    return { arms, candidates, unmade };
}

/**
 * The orbits of copied regions of a build (`regionOrbitsOfConfig`) and, for each, one candidate per region: every region takes
 * that region's windows through the map, moved by one shift that puts its metered takers on the turns of the landing region (the
 * region whose first metered taker opens first). The anchor's arms keep the clock's windows. Null where the build has no orbit.
 * Only the choice (`chooseRegionCopies`) decides what the clock takes.
 */
export function regionCopies(
    config: Config, clock: SerializableClockWindows, period: number, metered: ReadonlySet<string>, open: ReadonlySet<string>,
): { orbits: { found: FoundOrbit; proposals: OrbitProposals }[] } | null {
    const found = regionOrbitsOfConfig(config);
    if (found === null) return null;
    return { orbits: found.map(it => ({ found: it, proposals: it.kind === "refused"
        ? { arms: it.regions.flatMap(region => region.arms), candidates: [], unmade: [], refused: it.reason }
        : orbitProposals(it.orbit, clock, period, metered, open) })) };
}

/** A recovery reading's worse part: null where either part is null, else the larger */
export const worstRecovery = (recovery: { one_copy: number | null; copies: number | null }): number | null =>
    recovery.one_copy === null || recovery.copies === null ? null : Math.max(recovery.one_copy, recovery.copies);

/**
 * The candidate of one orbit the clock takes. A candidate is kept where it holds to the long run, its wake-ups (`costKey`) and its
 * deciders are each at most the clock's and one of them is fewer, it passes the whole check, and its recovery by the worse of its
 * two readings is no slower than the clock's. Of those kept: the fewest deciders, then the lowest cost, then the region order.
 * The orbit's code where none is kept: that of its candidate of the lowest cost (Infinity where it does not hold to the long run
 * or could not be made), the region order on a tie.
 */
export function chooseRegionCopy(proposals: OrbitProposals, base: SerializableClockWindows, period: number, judge: InputWindowJudge):
    { taken: RegionCopyCandidate | null; reason: RegionCopyRetained; stage?: InputJointStage } {
    if (proposals.refused !== undefined) return { taken: null, reason: proposals.refused };
    const current_cost = costKey({ wake_ups_per_minute: judge.longRun({}).wake_ups });
    const current_deciders = decidersOf(base, period);
    type Outcome = { candidate: RegionCopyCandidate | null; cost: number; deciders: number; reason: RegionCopyRetained | null; stage?: InputJointStage };
    const outcomes: Outcome[] = [];
    for (const candidate of proposals.candidates) {
        const run = judge.longRun(candidate.changes);
        if (!run.holds) { outcomes.push({ candidate, cost: Infinity, deciders: Infinity, reason: "joint_check_failed", stage: run.stage ?? "long_run" }); continue; }
        const cost = costKey({ wake_ups_per_minute: run.wake_ups });
        const deciders = decidersOf({ ...base, ...candidate.changes }, period);
        const outcome: Outcome = { candidate, cost, deciders, reason: null };
        outcomes.push(outcome);
        if (deciders > current_deciders) { outcome.reason = "more_deciders"; continue; }
        if (cost > current_cost || (cost === current_cost && deciders === current_deciders)) { outcome.reason = "not_better"; continue; }
        const stage = judge.wholeCheck(candidate.changes);
        if (stage !== null) { outcome.reason = "joint_check_failed"; outcome.stage = stage; continue; }
        if (recoveryWorse(worstRecovery(judge.recovery(candidate.changes)), worstRecovery(judge.recovery({})))) { outcome.reason = "recovery_worse"; continue; }
    }
    const kept = outcomes.filter(it => it.reason === null).sort((a, b) => a.deciders - b.deciders || a.cost - b.cost);
    if (kept.length > 0) return { taken: kept[0].candidate, reason: "not_better" };
    const unmade: Outcome[] = proposals.unmade.map(() => ({ candidate: null, cost: Infinity, deciders: Infinity, reason: "uneven_shift" }));
    const refused = [...outcomes, ...unmade]
        .sort((a, b) => a.cost - b.cost);
    const first = refused[0];
    if (first === undefined) return { taken: null, reason: "not_better" };
    return { taken: null, reason: first.reason!, ...(first.stage !== undefined && { stage: first.stage }) };
}

/**
 * The orbits judged one at a time, in their order, each against the clock the orbit before leaves (`judgeOn` gives the judge of a
 * clock): the clock at the end and every arm's decision. Every inserter of `inserters` outside every region is `no_orbit`; an arm
 * of a region is `copied` in the candidate taken, else its orbit's code. An arm copied by one orbit keeps that decision.
 */
export function chooseRegionCopies(
    proposed: NonNullable<ReturnType<typeof regionCopies>>, clock: SerializableClockWindows, period: number, inserters: readonly string[],
    judgeOn: (clock: SerializableClockWindows) => InputWindowJudge,
): { clock: SerializableClockWindows; decisions: Record<string, RegionCopyDecision> } {
    const decisions: Record<string, RegionCopyDecision> = {};
    for (const id of inserters) decisions[id] = { kind: "retained", reason: "no_orbit" };
    let current = clock;
    for (const { proposals } of proposed.orbits) {
        const choice = chooseRegionCopy(proposals, current, period, judgeOn(current));
        for (const id of proposals.arms) {
            if (choice.taken !== null && choice.taken.copied[id] !== undefined) { decisions[id] = choice.taken.copied[id]; continue; }
            if (decisions[id]?.kind === "copied") continue;
            decisions[id] = { kind: "retained", reason: choice.reason, ...(choice.stage !== undefined && { stage: choice.stage }) };
        }
        if (choice.taken !== null) current = { ...current, ...choice.taken.changes };
    }
    return { clock: current, decisions };
}
