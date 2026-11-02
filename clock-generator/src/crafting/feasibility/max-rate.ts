/**
 * The most a build's target rate can be before the feasibility pass refuses it: the same cuts, asked for the largest
 * target none of them is above. One source of truth for the page's "At most N/s" and the engine's refusal.
 */
import { describeFeasibilityIssue } from "../../config/errors";
import type { Config } from "../../config/schema";
import Fraction, { fraction } from "../../data-types/fraction";
import type { PlannerFacts } from "../../data-types/planner-facts";
import { plannerGraphOf } from "../graph/build-graph";
import { fractionOf, ratioOf, type Ratio } from "../../entities/traits/ratio";
import { graphOf } from "./assert-feasible";
import { Cut, cutsOf, refuses } from "./checks";
import { above, demandOf } from "./demand";

/** The rounds that settle a cut whose need is not in proportion to the target (what a lane gives up to the others is not) */
const ROUNDS = 40;

export interface TargetRateMax {
    /** The most one copy's target can be, exact */
    readonly per_copy: Ratio;
    /** `per_copy` as a decimal */
    readonly per_copy_per_second: number;
    /** The cut that stops the target there, as the pass names it ("C7 inserters") */
    readonly cut: string;
    /** What that cut says of the config's own target, as a player reads it, where the target is above the maximum; else null */
    readonly limit: string | null;
}

const cutsAt = (facts: PlannerFacts, per_copy: Fraction): Cut[] => {
    const at: PlannerFacts = { ...facts, target: { ...facts.target, per_copy: ratioOf(per_copy) } };
    return cutsOf(demandOf(at, plannerGraphOf(at)));
};

/** The tightest bounded cut with a need: the one with the least capacity over need, and that ratio */
function tightestOf(cuts: readonly Cut[]): { cut: Cut; ratio: Fraction } | null {
    let best: { cut: Cut; ratio: Fraction } | null = null;
    for (const cut of cuts) {
        if (cut.capacity === null || !(cut.need.getNumerator > 0)) continue;
        const ratio = cut.capacity.divide(cut.need);
        if (best === null || above(best.ratio, ratio)) best = { cut, ratio };
    }
    return best;
}

/**
 * The largest target per copy that no cut of the feasibility pass is above, found by scaling the target to the tightest
 * cut until it holds (one round where every need is in proportion to the target). Null where the config's facts or
 * graph cannot be built, nothing bounds the target, or the figures cannot be worked out exactly: the config is then
 * checked where it is today.
 */
export function targetRateMaxOf(config: Config): TargetRateMax | null {
    try {
        const built = graphOf(config);
        if (built === null) return null;
        const { facts } = built;
        let per_copy = facts.target.per_copy.numerator > 0 ? fractionOf(facts.target.per_copy) : fraction(1);
        let tightest = tightestOf(cutsAt(facts, per_copy));
        for (let round = 0; tightest !== null && round < ROUNDS && tightest.ratio.subtract(1).getNumerator !== 0; round++) {
            per_copy = per_copy.multiply(tightest.ratio);
            tightest = tightestOf(cutsAt(facts, per_copy));
        }
        if (tightest === null || tightest.ratio.subtract(1).getNumerator !== 0) return null;
        // the maximum is the target at which no cut is refused: it holds, and a hair above it does not
        if (cutsAt(facts, per_copy).some(refuses)) return null;
        const configured = cutsAt(facts, fractionOf(facts.target.per_copy)).find(cut => cut.name === tightest!.cut.name);
        const limit = configured !== undefined && refuses(configured) ? configured.issues().map(describeFeasibilityIssue).join(" ") : null;
        return { per_copy: ratioOf(per_copy), per_copy_per_second: per_copy.toDecimal(), cut: tightest.cut.name, limit };
    } catch {
        return null;
    }
}
