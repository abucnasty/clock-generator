/**
 * The feasibility pass (P3 design section 3): one linear pass over a build's planner graph that refuses, before any
 * simulation, a build no clock could carry. It checks necessary conditions only, from true maxima and exact fractions,
 * and refuses only where a need is strictly above its bound; the simulator stays the judge of everything else.
 *
 * It runs right after the output transfer, coverage and copies guards (D10), so every config those refuse keeps its
 * error. What is not a feasibility question stays where it is (D3): a config whose facts or graph cannot be built,
 * whatever the error, passes here unchecked and is refused where it is today, with its text. A scope refusal that the
 * facts do not hit (the several placed sources of `createEntityRegistryFromConfig`, simulation-context.ts) is not
 * checked first: a config it refuses that is also over its target now gets this pass's refusal instead.
 */
import type { Config } from "../../config/schema";
import { FeasibilityError, FeasibilityIssue, FeasibilityRule } from "../../config/errors";
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { plannerGraphOf } from "../graph/build-graph";
import { Cut, cutsOf, refuses } from "./checks";
import { demandOf } from "./demand";
import { dutiesOf, GroupDuty } from "./duty";
import { loopTrapIssues, sharedHandIssues } from "./traps";

const RULE_ORDER: readonly FeasibilityRule[] = ["S1", "S2", "S3", "C1", "C2", "C3", "C4", "C5", "C6", "C7"];

export interface Feasibility {
    /** Every cut, refused or not, for tables and tests */
    readonly cuts: readonly Cut[];
    /** What the build is refused for; none where it passes */
    readonly issues: readonly FeasibilityIssue[];
    /** The duty of each machine group that must craft; recorded only, it decides nothing (duty.ts) */
    readonly duties: readonly GroupDuty[];
}

const sameNodes = (a: FeasibilityIssue, b: FeasibilityIssue): boolean =>
    a.nodes.length === b.nodes.length && a.nodes.every(node => b.nodes.includes(node));

/**
 * The cuts of a build and the issues it is refused for, the traps first, then by rule. A cut is said once: a recipe's
 * machines (C1) that destroy the target are judged by what they destroy (C7) where that refuses, those of a loop that
 * uses up all it makes by that loop (S3), machines held back only
 * by the inserters that take the target or an export out by those (C3, C6), and a lane (C5) that is the only supply of
 * an item from outside by that supply (C2).
 */
export function feasibilityOf(facts: PlannerFacts, graph: PlannerGraph): Feasibility {
    const demand = demandOf(facts, graph);
    const cuts = cutsOf(demand);
    const refused = cuts.filter(refuses);
    // groups whose crafts another refusal already speaks for: those that destroy the target (C7), those of a trapped loop (S3)
    const spoken = new Set([
        ...refused.filter(cut => cut.rule === "C7" && cut.group !== null).map(cut => cut.group),
        ...demand.loop_traps.flatMap(trap => trap.groups.map(group => group.key)),
    ]);
    const found = refused.filter(cut => !(cut.rule === "C1" && spoken.has(cut.group))).flatMap(cut => cut.issues());
    const supplies = found.filter(issue => issue.rule === "C2");
    const leaving = new Set(found.filter(issue => issue.rule === "C3" || issue.rule === "C6").flatMap(issue => issue.edges));
    const said = (issue: FeasibilityIssue): boolean =>
        (issue.rule === "C5" && supplies.some(supply => sameNodes(supply, issue)))
        || (issue.terms.rule === "C1" && issue.terms.limits.every(limit => limit.kind === "output") && issue.edges.every(edge => leaving.has(edge)));
    const issues = [
        ...sharedHandIssues(demand),
        ...loopTrapIssues(demand),
        ...found.filter(issue => !said(issue)),
    ];
    return { cuts, issues: issues.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule)), duties: dutiesOf(demand) };
}

const checked = new WeakMap<Config, { issues: readonly FeasibilityIssue[]; target: { items_per_second: number; copies: number } }>();

/**
 * The facts and graph of a config, or null where they cannot be built: the config is refused elsewhere, as today. Every
 * error is caught, an invariant's too, so such a config is not checked here; the facts and graph throw no error class
 * of their own to catch alone
 */
export function graphOf(config: Config): { facts: PlannerFacts; graph: PlannerGraph } | null {
    try {
        const facts = toPlannerFacts(config);
        return { facts, graph: plannerGraphOf(facts) };
    } catch {
        return null;
    }
}

/**
 * Throws a FeasibilityError where no clock can carry the config's target (P3 design 3.6). Once per config object: a
 * generation calls it on every run with the same config.
 */
export function assertFeasible(config: Config): void {
    let found = checked.get(config);
    if (found === undefined) {
        const built = graphOf(config);
        found = {
            issues: built === null ? [] : feasibilityOf(built.facts, built.graph).issues,
            target: { items_per_second: config.target_output.items_per_second, copies: config.target_output.copies },
        };
        checked.set(config, found);
    }
    if (found.issues.length > 0) {
        throw new FeasibilityError([...found.issues], found.target);
    }
}
