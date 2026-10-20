import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { EntityId } from "../../entities";
import { Logger } from "../../common/logger";
import { StockRecording } from "../machine-stock";
import { TrialRun } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltRun, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck } from "../trial";

/**
 * The one search every transform of a clock's windows goes through, with the one policy for trying its candidates.
 *
 * A candidate is one setting of a transform (a padding, a shift, an offset). Every candidate gets the quick trial: the
 * clock-only check of the candidate's windows from a dozen start phases, without the long run. Of the candidates that
 * pass it, one whose neighbours on both sides pass too is confirmed before one whose do not: its neighbours in the
 * candidate list are neighbours in time or in size, so its timing has room to slip a step either way, which is margin
 * over precision (GOALS.md, Working Rules). Among those, the search's own order decides: the smallest padding, the
 * smallest shift, the fewest waits. The widest neighbourhood is not preferred beyond that: for a padding it would pick
 * the middle of the range that passes and lengthen every window for nothing (tried on the samples on 2026-10-11, the
 * selected clock's wake-ups rose on five of them). The confirmation is the clock-only check from a hundred and twelve
 * start phases with the long run; a search may put a check of its own before it. The first candidate whose
 * confirmation passes is the result, and at most five are confirmed before the search gives up.
 */

/** How many of the ranked candidates are confirmed before the search gives up */
const MAX_CONFIRMATIONS = 5;

/** One candidate with what its quick trial found */
interface Tried<C, Q extends QuickTrial> {
    candidate: C;
    index: number;
    quick: Q;
}

/** What the quick trial of a candidate found: at least whether the clock holds its expected output from the generator's start */
export interface QuickTrial {
    holds: boolean;
}

interface Search<C, Q extends QuickTrial, R> {
    candidates: readonly C[];
    /** The quick trial of a candidate: `quickTrial`, or a search of its own whose pick is the candidate's windows */
    quick: (candidate: C, index: number) => Q;
    /** Whether two candidates of the list belong to the same row of settings, so that one next to the other is its neighbour */
    neighbours: (a: C, b: C) => boolean;
    /** Whether a candidate may be picked (default: every one); whether it counts as a neighbour is for `neighbours` to say */
    eligible?: (candidate: C) => boolean;
    /** True when the settings of a row go round: the last offset of a window length is next to the first (default: false) */
    wraps?: boolean;
    /** The search's own order between candidates of the same margin: negative when `a` comes first */
    tieBreak: (a: Tried<C, Q>, b: Tried<C, Q>) => number;
    /** The confirming trial (see `confirm`); null when the candidate does not pass it */
    confirm: (pick: Tried<C, Q>) => R | null;
}

interface SearchResult<C, Q extends QuickTrial, R> {
    /** What the first confirmed candidate yielded, or null when none passed */
    picked: R | null;
    /** The candidate that was picked, when one was */
    pick: Tried<C, Q> | null;
    /** Every candidate with its quick trial, in the order of the candidate list */
    tried: Tried<C, Q>[];
}

/** The indexes of the row a candidate belongs to: the unbroken stretch of the list that `neighbours` puts with it */
function rowOf<C, Q extends QuickTrial>(tried: readonly Tried<C, Q>[], index: number, neighbours: (a: C, b: C) => boolean): { first: number; last: number } {
    let first = index;
    let last = index;
    while (tried[first - 1] !== undefined && neighbours(tried[first - 1].candidate, tried[index].candidate)) first--;
    while (tried[last + 1] !== undefined && neighbours(tried[last + 1].candidate, tried[index].candidate)) last++;
    return { first, last };
}

/** The passing neighbours a candidate has on one side, counted along its row of the candidate list, round the row when it wraps */
function neighboursPassing<C, Q extends QuickTrial>(tried: readonly Tried<C, Q>[], index: number, direction: 1 | -1, neighbours: (a: C, b: C) => boolean, wraps: boolean): number {
    const row = rowOf(tried, index, neighbours);
    const size = row.last - row.first + 1;
    let run = 0;
    for (let step = 1; step < size; step++) {
        let next = index + direction * step;
        if (next < row.first || next > row.last) {
            if (!wraps) break;
            next = row.first + ((next - row.first) % size + size) % size;
        }
        if (!tried[next].quick.holds) break;
        run++;
    }
    return run;
}

/** The margin of a candidate: the fewer of its passing neighbours on either side */
function marginOf<C, Q extends QuickTrial>(tried: readonly Tried<C, Q>[], index: number, neighbours: (a: C, b: C) => boolean, wraps = false): number {
    return Math.min(neighboursPassing(tried, index, 1, neighbours, wraps), neighboursPassing(tried, index, -1, neighbours, wraps));
}

/** The passing neighbours on each side a candidate needs to come before one without them; more are not preferred */
const MARGIN_WANTED = 1;

export function search<C, Q extends QuickTrial, R>(it: Search<C, Q, R>): SearchResult<C, Q, R> {
    const tried: Tried<C, Q>[] = it.candidates.map((candidate, index) => ({ candidate, index, quick: it.quick(candidate, index) }));
    const rank = (t: Tried<C, Q>) => Math.min(MARGIN_WANTED, marginOf(tried, t.index, it.neighbours, it.wraps ?? false));
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

/**
 * The quick trial of every search: the clock-only check from a dozen start phases, without the long run. It stops at
 * the first phase that fails, so a candidate that does not hold costs one run. One unshifted run was tried instead on
 * 2026-10-11: it let paddings and timings through that the dozen phases reject, and two of the picks it led to failed
 * in the game on automation science; the dozen phases keep every clock the game has confirmed, at more runs on the
 * full-hand search, whose scan had used one run.
 */
export function quickTrial(config: Config, windows: Map<string, OpenRange[]>, period: number, logger: Logger): QuickTrial & { result: TrialRun; run: AsBuiltRun } {
    const run = runAsBuiltCheck(config, windows, period, logger, AS_BUILT_START_PHASES, undefined, 0);
    return { holds: run.check.holds, result: run.result, run };
}

/** What a confirmation yields: the clock-only check that passed, with its run and the long run's stock */
export interface Confirmed {
    result: TrialRun;
    check: AsBuiltStabilityCheck;
    stock?: StockRecording;
}

/**
 * The confirming trial of every search: the clock-only check from a hundred and twelve start phases with the long run,
 * which the quick trial's dozen phases are the first of. Null when it fails. `label` names the candidate in the
 * progress shown.
 */
export function confirm(config: Config, windows: Map<string, OpenRange[]>, period: number, logger: Logger, label: string, report?: (detail: string) => void,
    /** The quick trial that passed on exactly these windows, whose unshifted run and pickup phase starts the confirmation takes over */
    passed?: AsBuiltRun,
): Confirmed | null {
    const full = runAsBuiltCheck(config, windows, period, logger, FULL_CHECK_START_PHASES,
        (n, total) => report?.(`Confirming ${label}, clock start ${n}/${total}`), undefined,
        passed === undefined ? undefined : { run: passed, long_run_ticks: 0 });
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
    moved?: { entity_id: EntityId; item_names: string[] }[];
}
