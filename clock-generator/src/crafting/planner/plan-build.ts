/**
 * The plan of a build (data-types/build-plan.ts): one arithmetic pass after the feasibility pass and before any
 * simulation, over the planner facts, the planner graph and today's cycle arithmetic. It finds the groups, each group's
 * main-period choices kept or pruned, the utilization of the machine groups in it, the composition into the main period, and,
 * for a target that counts an item destroyed, whether its results get windows of their own.
 *
 * Only that last decision is read by a generation (`buildPlanOfConfig`, made once per config object); the rest is
 * recorded for the tests and for the planner steps to come.
 */
import type { Config } from "../../config";
import type { BuildPlan, PlanUtilization, PlanGroup, ExhaustDecision } from "../../data-types/build-plan";
import type Fraction from "../../data-types/fraction";
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import type { ReadableEntityRegistry } from "../../entities";
import { feasibilityOf, graphOf, type Feasibility } from "../feasibility/assert-feasible";
import { TargetProductionRate } from "../target-production-rate";
import { compositionOf, transferKeyOf } from "./composition";
import { GroupShape, groupsOf } from "./groups";
import { CycleArithmetic, plannedPeriodsOf } from "./periods";
import { exhaustDecisionOf } from "./exhaust";

const ratioOf = (value: Fraction) => ({ numerator: value.getNumerator, denominator: value.getDenominator });

/**
 * The utilizations of the machine groups (feasibility/utilization.ts) whose machines are in a group: a machine group of one recipe
 * can have machines in several groups, and is listed in each with those machines
 */
function dutiesIn(group: GroupShape, feasibility: Feasibility): PlanUtilization[] {
    const inside = new Set(group.vertices);
    return feasibility.utilizations.flatMap(utilization => {
        // a machine group's key starts with the kind of its members, as the feasibility demand names it
        const kind = utilization.group.slice(0, utilization.group.indexOf(":"));
        const members = utilization.machines.map(number => `${kind}:${number}`).filter(member => inside.has(member));
        return members.length === 0 ? [] : [{
            producer: utilization.group,
            members,
            crafts_needed: ratioOf(utilization.crafts_needed),
            crafts_capacity: ratioOf(utilization.crafts_capacity),
            utilization: ratioOf(utilization.utilization),
        }];
    });
}

/**
 * The plan of a build. `cycle` is today's cycle arithmetic of the build (planner/periods.ts); without it (a build
 * refused before any cycle is planned) the plan holds the groups and their utilization only.
 */
export function planBuild(facts: PlannerFacts, graph: PlannerGraph, feasibility: Feasibility, cycle: CycleArithmetic | null): BuildPlan {
    const { unbounded_sources, groups } = groupsOf(facts, graph);
    const exhaust: ExhaustDecision | null = cycle === null || cycle.config.setpoint.counts !== "destroyed" ? null
        : exhaustDecisionOf(TargetProductionRate.fromConfig(cycle.config.setpoint), cycle.registry, cycle.config, cycle.config.overrides ?? {});
    const group_of = new Map<string, number>();
    const edge = new Map(graph.edges.map(it => [it.key, it]));
    groups.forEach((group, at) => group.edges.forEach(key => group_of.set(transferKeyOf(edge.get(key)!.entity, edge.get(key)!.item), at)));
    const periods = cycle === null ? null : plannedPeriodsOf(cycle, groups, group_of, exhaust);
    return {
        schema: 1,
        target: graph.target,
        unbounded_sources,
        groups: groups.map((group, at): PlanGroup => ({
            key: group.key,
            members: group.members,
            edges: group.edges,
            periods: periods?.per_group[at] ?? [],
            utilization: dutiesIn(group, feasibility),
        })),
        composition: periods === null ? null : compositionOf(periods, groups),
        exhaust,
    };
}

const planned = new WeakMap<Config, BuildPlan | null>();

/**
 * The plan of a config whose target counts an item destroyed, as a generation reads it: once per config object, on the
 * registry of its run. Null where the config's facts or graph cannot be built (it is refused elsewhere, as today) or
 * its target counts an item made: a made target's plan needs its prepare step's swings, and nothing reads it yet.
 */
export function buildPlanOfConfig(config: Config, registry: ReadableEntityRegistry): BuildPlan | null {
    if (config.setpoint.counts !== "destroyed") return null;
    let plan = planned.get(config);
    if (plan === undefined) {
        const built = graphOf(config);
        plan = built === null ? null
            : planBuild(built.facts, built.graph, feasibilityOf(built.facts, built.graph), { config, registry, max_swings: null });
        planned.set(config, plan);
    }
    return plan;
}
