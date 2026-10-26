import { Chest, Entity, type ReadableEntityRegistry } from "../entities";
import type { EntityTransferCountMap } from "./sequence/cycle/swing-counts";

// ============================================================================
// The target as a rate over the cycle, for terminal outputs into sinks that never block
// ============================================================================
//
// To the inserter that drops into it, a chest with room and an infinity chest are the same: neither ever refuses a hand.
// Where every terminal output drops into an infinity chest, the target is judged as a rate: each branch (the terminal
// outputs that take from one machine or one container) has to carry its share of the target over the cycle in whole
// hands, not an exact count in every period. A branch may run a hand behind (none in one period, 32 in the next): it
// carries its share from a bin on where its running total from there never falls further behind its share than its
// hands, and, where the run repeats forever, the repeating cycle carries its share to less than an item, so that it never
// falls further behind. What it carries over its share is a surplus the sink takes, as a buffer with room takes it, and
// is not held against it. Anything else (a belt, a machine's insertion limit, a chest that can fill) cannot take lumps
// or a surplus, and its output stays judged exactly in every period: a branch with no hand and no surplus.

/** Room for the rounding of shares that are not whole */
const EPSILON = 1e-9;

/** The terminal outputs that take from one machine or container, and the share of the target they carry */
export interface TerminalBranch {
    /** Where the branch takes from */
    source_id: string;
    /** The terminal output inserters of the branch, by id */
    inserter_ids: string[];
    /** Items the branch is planned to carry in a clock period */
    share_per_period: number;
    /** Items the branch's inserters move in one hand each: how far it may fall behind its share */
    hand: number;
}

/** One branch's items in each bin, with the share a bin expects of it */
export interface BranchBins {
    bins: readonly number[];
    share_per_bin: number;
    /** How far it may fall behind its share */
    hand: number;
    /** Its sink takes what it carries over its share; without that it may run no further ahead than its hand */
    takes_surplus: boolean;
}

/** Whether an inserter's sink never refuses a hand: an infinity chest (a chest with room for the whole run is not told apart yet) */
export function isNeverBlockingSink(sink: Entity): boolean {
    return Entity.isChest(sink) && Chest.isInfinityChest(sink);
}

/**
 * The branches of the terminal outputs `output_inserter_ids`, each with its planned share of a period (the plan's hands
 * of its inserters, `total_transfer_count` x hand, over `recipe_lcm` cycles), in the order of their sources' ids. Only
 * where every one of them drops into a sink that never blocks (an infinity chest) and has a planned share: otherwise
 * none, and the output is judged exactly in every period.
 */
export function neverBlockingBranchesOf(
    registry: Pick<ReadableEntityRegistry, "getAll">,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    output_inserter_ids: ReadonlySet<string>,
): TerminalBranch[] {
    const planned = new Map<string, { share: number; hand: number }>();
    for (const [entity_id, transfer] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            planned.set(entity_id.id, { share: transfer.total_transfer_count.toDecimal() * transfer.stack_size * recipe_lcm, hand: transfer.stack_size });
        }
    }
    const outputs = registry.getAll().filter(Entity.isInserter).filter(inserter => output_inserter_ids.has(inserter.entity_id.id));
    const never_blocks = outputs.length > 0 && outputs.every(inserter => {
        const sink = registry.getAll().find(entity => entity.entity_id.id === inserter.sink.entity_id.id);
        return sink !== undefined && isNeverBlockingSink(sink) && planned.has(inserter.entity_id.id);
    });
    if (!never_blocks) return [];
    const branches = new Map<string, TerminalBranch>();
    for (const inserter of outputs) {
        const id = inserter.entity_id.id;
        const source_id = inserter.source.entity_id.id;
        const branch = branches.get(source_id) ?? { source_id, inserter_ids: [], share_per_period: 0, hand: 0 };
        branch.inserter_ids.push(id);
        branch.share_per_period += planned.get(id)!.share;
        branch.hand += planned.get(id)!.hand;
        branches.set(source_id, branch);
    }
    return [...branches.values()].sort((a, b) => a.source_id.localeCompare(b.source_id, undefined, { numeric: true }));
}

/**
 * The branches with their shares scaled so that they add up to `expected_per_period`: a clock judged on another count
 * than its plan's (a period rounded to whole ticks) keeps each branch's part of it. Unchanged where the shares add up to
 * nothing.
 */
export function branchesScaledTo(branches: readonly TerminalBranch[], expected_per_period: number): TerminalBranch[] {
    const planned = branches.reduce((sum, branch) => sum + branch.share_per_period, 0);
    if (!(planned > 0) || Math.abs(planned - expected_per_period) < EPSILON) return [...branches];
    return branches.map(branch => ({ ...branch, share_per_period: branch.share_per_period * expected_per_period / planned }));
}

/** How far a branch may run ahead of its share */
const aheadLimit = (branch: BranchBins): number => branch.takes_surplus ? Infinity : branch.hand;

/** Whether a branch carries its share from bin `from` to its last bin: its running total from there stays within its limits */
function branchAtRateFrom(branch: BranchBins, from: number): boolean {
    let ahead = 0;
    for (let index = from; index < branch.bins.length; index++) {
        ahead += branch.bins[index] - branch.share_per_bin;
        if (ahead < -branch.hand - EPSILON || ahead > aheadLimit(branch) + EPSILON) return false;
    }
    return true;
}

/** Whether every branch carries its share from bin `from` to the end (see branchAtRateFrom); with no hand and no surplus, every bin exactly */
export function atRateFrom(branches: readonly BranchBins[], from: number): boolean {
    return branches.every(branch => branchAtRateFrom(branch, from));
}

/**
 * The first bin from which every branch carries its share to the end: the bins before it were not at the rate (what a
 * loss left behind). With no hand, the bin after the last one that was off. The number of bins where there is none.
 */
export function firstBinAtRate(branches: readonly BranchBins[]): number {
    const bins = Math.max(0, ...branches.map(branch => branch.bins.length));
    // from bin r a branch is at the rate where its running total P (P[0] = 0, P[k + 1] = P[k] + bin k - share) after r
    // stays within its limits of P[r]: max(P[k], k > r) - ahead limit <= P[r] <= min(P[k], k > r) + hand
    const valid = new Uint8Array(bins).fill(1);
    for (const branch of branches) {
        const prefix = new Float64Array(bins + 1);
        for (let index = 0; index < bins; index++) prefix[index + 1] = prefix[index] + (branch.bins[index] ?? 0) - branch.share_per_bin;
        let lowest_after = Infinity;
        let highest_after = -Infinity;
        for (let from = bins - 1; from >= 0; from--) {
            lowest_after = Math.min(lowest_after, prefix[from + 1]);
            highest_after = Math.max(highest_after, prefix[from + 1]);
            if (prefix[from] > lowest_after + branch.hand + EPSILON || prefix[from] < highest_after - aheadLimit(branch) - EPSILON) valid[from] = 0;
        }
    }
    const first = valid.indexOf(1);
    return first === -1 ? bins : first;
}

/**
 * Whether bins that repeat forever carry every branch's share: from the start of the cycle no branch falls more than its
 * hands behind (or runs further ahead than its limit), and over the cycle each carries its share to less than an item, so
 * it falls no further behind in the cycles after (and, without a surplus, runs no further ahead). With no hand and no
 * surplus, every bin exactly.
 */
export function cycleAtRate(branches: readonly BranchBins[]): boolean {
    return branches.every(branch => {
        const over = branch.bins.reduce((sum, items) => sum + items, 0) - branch.share_per_bin * branch.bins.length;
        return branchAtRateFrom(branch, 0) && over > -1 && (branch.takes_surplus || over < 1);
    });
}
