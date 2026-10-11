/**
 * The one search every transform of a clock's windows goes through: a list of candidates, a quick trial of each, a
 * pick rule that names which of the tried candidates to confirm and when, and the confirming trial. The first
 * candidate whose confirmation passes is the result.
 *
 * The pick rule is asked after every quick trial, with every candidate tried so far, and once more when all are tried.
 * That lets one rule confirm a candidate as soon as it and its neighbour pass (the padding of observed windows),
 * another confirm a candidate at once when nothing could beat it (a full-hand timing with no wait), and a third rank
 * every candidate once all are tried (a shifted round of swings, a moved output swing). A candidate is confirmed at
 * most once; one whose confirmation failed is marked, so the rule can treat it as failed from then on.
 */

/** One candidate with what its quick trial found; `confirmed` is set once its confirmation was tried */
export interface Tried<C, Q> {
    candidate: C;
    index: number;
    quick: Q;
    /** True when the confirmation passed, false when it failed, undefined while it was not tried */
    confirmed?: boolean;
}

export interface Search<C, Q, R> {
    candidates: readonly C[];
    /** The quick trial of a candidate */
    quick: (candidate: C, index: number) => Q;
    /**
     * The indexes of the tried candidates to confirm now, in order. Called after each quick trial with every candidate
     * tried so far, `done` false, and once more after the last with `done` true. Candidates already confirmed or failed
     * are skipped, so a rule may name them again.
     */
    picks: (tried: readonly Tried<C, Q>[], done: boolean) => number[];
    /** The confirming trial, given every candidate tried so far as well; null when the candidate does not pass it */
    confirm: (pick: Tried<C, Q>, tried: readonly Tried<C, Q>[]) => R | null;
}

export interface SearchResult<C, Q, R> {
    /** What the first confirmed candidate yielded, or null when none passed */
    picked: R | null;
    /** Every candidate tried, in the order tried, with the outcome of its confirmation where one was tried */
    tried: Tried<C, Q>[];
}

export function search<C, Q, R>(it: Search<C, Q, R>): SearchResult<C, Q, R> {
    const tried: Tried<C, Q>[] = [];
    const confirmPicks = (done: boolean): R | null => {
        for (const index of it.picks(tried, done)) {
            const pick = tried[index];
            if (pick === undefined || pick.confirmed !== undefined) {
                continue;
            }
            const result = it.confirm(pick, tried);
            pick.confirmed = result !== null;
            if (result !== null) {
                return result;
            }
        }
        return null;
    };
    for (let index = 0; index < it.candidates.length; index++) {
        const candidate = it.candidates[index];
        tried.push({ candidate, index, quick: it.quick(candidate, index) });
        const picked = confirmPicks(false);
        if (picked !== null) {
            return { picked, tried };
        }
    }
    return { picked: confirmPicks(true), tried };
}
