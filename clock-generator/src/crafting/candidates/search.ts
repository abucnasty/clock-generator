import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { Logger } from "../../common/logger";
import { StockRecording } from "../machine-stock";
import { TrialRun } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild } from "../trial";

/**
 * The one search every transform of a clock's windows goes through, with the one policy for trying its candidates.
 *
 * A candidate is one setting of a transform (a padding, a shift, an offset). Every candidate gets the quick trial: the
 * build run on the candidate's windows alone from the generator's start, one period, unshifted. Of the candidates that
 * pass it, one whose neighbours on both sides pass too is confirmed before one whose do not: its neighbours in the
 * candidate list are neighbours in time or in size, so its timing has room to slip a step either way, which is margin
 * over precision (GOALS.md, Working Rules). Among those, the search's own order decides: the smallest padding, the
 * smallest shift, the fewest waits. The widest neighbourhood is not preferred beyond that: for a padding it would pick
 * the middle of the range that passes and lengthen every window for nothing (tried on the samples on 2026-10-11, the
 * selected clock's wake-ups rose on five of them). The confirmation is the clock-only check from a dozen start phases
 * without the long run, so a candidate that fails is let go cheaply, and then from a hundred and twelve with the long
 * run; a search may put a check of its own before it. The first candidate whose confirmation passes is the result, and
 * at most five are confirmed before the search gives up.
 */

/** How many of the ranked candidates are confirmed before the search gives up */
export const MAX_CONFIRMATIONS = 5;

/** One candidate with what its quick trial found */
export interface Tried<C, Q extends QuickTrial> {
    candidate: C;
    index: number;
    quick: Q;
}

/** What the quick trial of a candidate found: at least whether the clock holds its expected output from the generator's start */
export interface QuickTrial {
    holds: boolean;
}

export interface Search<C, Q extends QuickTrial, R> {
    candidates: readonly C[];
    /** The quick trial of a candidate: `quickTrial`, or a search of its own whose pick is the candidate's windows */
    quick: (candidate: C, index: number) => Q;
    /** Whether two candidates of the list belong to the same row of settings, so that one next to the other is its neighbour */
    neighbours: (a: C, b: C) => boolean;
    /** Whether a candidate may be picked (default: every one); whether it counts as a neighbour is for `neighbours` to say */
    eligible?: (candidate: C) => boolean;
    /** The search's own order between candidates of the same margin: negative when `a` comes first */
    tieBreak: (a: Tried<C, Q>, b: Tried<C, Q>) => number;
    /** The confirming trial (see `confirm`); null when the candidate does not pass it */
    confirm: (pick: Tried<C, Q>) => R | null;
}

export interface SearchResult<C, Q extends QuickTrial, R> {
    /** What the first confirmed candidate yielded, or null when none passed */
    picked: R | null;
    /** The candidate that was picked, when one was */
    pick: Tried<C, Q> | null;
    /** Every candidate with its quick trial, in the order of the candidate list */
    tried: Tried<C, Q>[];
}

/** The passing neighbours a candidate has on one side, counted along the candidate list */
function neighboursPassing<C, Q extends QuickTrial>(tried: readonly Tried<C, Q>[], index: number, direction: 1 | -1, neighbours: (a: C, b: C) => boolean): number {
    let run = 0;
    for (let next = index + direction; tried[next]?.quick.holds && neighbours(tried[next].candidate, tried[index].candidate); next += direction) {
        run++;
    }
    return run;
}

/** The margin of a candidate: the fewer of its passing neighbours on either side */
export function marginOf<C, Q extends QuickTrial>(tried: readonly Tried<C, Q>[], index: number, neighbours: (a: C, b: C) => boolean): number {
    return Math.min(neighboursPassing(tried, index, 1, neighbours), neighboursPassing(tried, index, -1, neighbours));
}

/** The passing neighbours on each side a candidate needs to come before one without them; more are not preferred */
const MARGIN_WANTED = 1;

export function search<C, Q extends QuickTrial, R>(it: Search<C, Q, R>): SearchResult<C, Q, R> {
    const tried: Tried<C, Q>[] = it.candidates.map((candidate, index) => ({ candidate, index, quick: it.quick(candidate, index) }));
    const rank = (t: Tried<C, Q>) => Math.min(MARGIN_WANTED, marginOf(tried, t.index, it.neighbours));
    const ranked = tried.filter(t => t.quick.holds && (it.eligible?.(t.candidate) ?? true))
        .sort((a, b) => rank(b) - rank(a) || it.tieBreak(a, b));
    for (const pick of ranked.slice(0, MAX_CONFIRMATIONS)) {
        const result = it.confirm(pick);
        if (result !== null) {
            return { picked: result, pick, tried };
        }
    }
    return { picked: null, pick: null, tried };
}

/** The quick trial of every search: the build on the windows alone, one period from the generator's start */
export function quickTrial(config: Config, windows: Map<string, OpenRange[]>, period: number, logger: Logger): QuickTrial & { result: TrialRun } {
    const result = runClockOnBuild(config, windows, period, logger);
    return { holds: result.stability_check.holds, result };
}

/** What a confirmation yields: the clock-only check that passed, with its run and the long run's stock */
export interface Confirmed {
    result: TrialRun;
    check: AsBuiltStabilityCheck;
    stock?: StockRecording;
}

/**
 * The confirming trial of every search: the clock-only check from a dozen start phases, without the long run, so a
 * candidate that fails is let go cheaply; then from a hundred and twelve with the long run. Null when either fails.
 * `label` names the candidate in the progress shown.
 */
export function confirm(config: Config, windows: Map<string, OpenRange[]>, period: number, logger: Logger, label: string, report?: (detail: string) => void): Confirmed | null {
    const quick = runAsBuiltCheck(config, windows, period, logger, AS_BUILT_START_PHASES,
        (n, total) => report?.(`Checking ${label}, clock start ${n}/${total}`), 0);
    if (!quick.check.holds) {
        logger.log(`Search: ${label} fails the clock-only check from ${quick.check.start_phases_checked} start phases (${quick.check.actual_output_items})`);
        return null;
    }
    const full = runAsBuiltCheck(config, windows, period, logger, FULL_CHECK_START_PHASES,
        (n, total) => report?.(`Confirming ${label}, clock start ${n}/${total}`));
    logger.log(`Search: ${label} confirmed from ${full.check.start_phases_checked} start phases -> stable=${full.check.holds}`);
    return full.check.holds ? full : null;
}

/** One end of the unbroken range of candidates that pass around the pick */
export interface SearchRangeEdge {
    /** The setting at the edge: a shift in ticks, a padding, an offset */
    setting: number;
    /** No setting further out was tried: the moved windows would meet other windows or the end of the period */
    is_search_limit: boolean;
    /** What the inserters and machines are waiting on at this edge, the limits that stop the setting from going further */
    notes: string[];
}

/** One candidate as the report lists it */
export interface SearchCandidate {
    /** Which row of settings it belongs to: the crafting cycle or output swing moved (1-based), the window length tried */
    row: number;
    /** The setting: a shift in ticks (negative is earlier), a padding, an offset */
    setting: number;
    /** Passed the quick trial */
    holds: boolean;
}

/**
 * What a search tried and picked, for the description of the clock and the UI's panel of the range that works. One
 * type for every transform: what differs is the kind and what a row and a setting mean for it.
 */
export interface SearchReport {
    kind: "shifted cycle" | "moved output swing" | "padding" | "full-hand timing";
    candidates: SearchCandidate[];
    /** The candidate picked and confirmed, when one was */
    picked: { row: number; setting: number } | null;
    /** For a shifted cycle: the ends of the range that works around the pick */
    earliest?: SearchRangeEdge;
    latest?: SearchRangeEdge;
    /** For a shifted cycle: the clock ticks the moved windows were planned in, and what moved */
    planned_ticks?: { start: number; end: number };
    moved?: { entity_id: string; item_names: string[] }[];
}
