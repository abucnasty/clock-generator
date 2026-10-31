/**
 * The plan of a build (data-types/build-plan.ts): one arithmetic pass after the feasibility pass and before any
 * simulation, over the planner facts, the planner graph and today's cycle arithmetic. It finds the groups, each group's
 * main-period choices kept or pruned, the duty of the machine groups in it, the composition into the main period, and,
 * for a target that counts an item destroyed, whether its results get windows of their own.
 *
 * Nothing reads it yet: it is recorded for the tests and for the planner steps to come.
 */
import type { BuildPlan, PlanDuty, PlanGroup, ResultWindowsDecision } from "../../data-types/build-plan";
import type Fraction from "../../data-types/fraction";
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import type { Feasibility } from "../feasibility/assert-feasible";
import { TargetProductionRate } from "../target-production-rate";
import { compositionOf, transferKeyOf } from "./composition";
import { GroupShape, groupsOf } from "./groups";
import { CycleArithmetic, plannedPeriodsOf } from "./periods";
import { resultWindowsDecisionOf } from "./result-windows";

const ratioOf = (value: Fraction) => ({ numerator: value.getNumerator, denominator: value.getDenominator });

/**
 * The duties of the machine groups (feasibility/duty.ts) whose machines are in a group: a machine group of one recipe
 * can have machines in several groups, and is listed in each with those machines
 */
function dutiesIn(group: GroupShape, feasibility: Feasibility): PlanDuty[] {
    const inside = new Set(group.vertices);
    return feasibility.duties.flatMap(duty => {
        // a machine group's key starts with the kind of its members, as the feasibility demand names it
        const kind = duty.group.slice(0, duty.group.indexOf(":"));
        const members = duty.machines.map(number => `${kind}:${number}`).filter(member => inside.has(member));
        return members.length === 0 ? [] : [{
            producer: duty.group,
            members,
            crafts_needed: ratioOf(duty.crafts_needed),
            crafts_capacity: ratioOf(duty.crafts_capacity),
            duty: ratioOf(duty.duty),
        }];
    });
}

/**
 * The plan of a build. `cycle` is today's cycle arithmetic of the build (planner/periods.ts); without it (a build
 * refused before any cycle is planned) the plan holds the groups and their duty only.
 */
export function planBuild(facts: PlannerFacts, graph: PlannerGraph, feasibility: Feasibility, cycle: CycleArithmetic | null): BuildPlan {
    const { unbounded_sources, groups } = groupsOf(facts, graph);
    const result_windows: ResultWindowsDecision | null = cycle === null || cycle.config.target_output.counts !== "destroyed" ? null
        : resultWindowsDecisionOf(TargetProductionRate.fromConfig(cycle.config.target_output), cycle.registry, cycle.config.overrides ?? {});
    const group_of = new Map<string, number>();
    const edge = new Map(graph.edges.map(it => [it.key, it]));
    groups.forEach((group, at) => group.edges.forEach(key => group_of.set(transferKeyOf(edge.get(key)!.entity, edge.get(key)!.item), at)));
    const periods = cycle === null ? null : plannedPeriodsOf(cycle, groups, group_of, result_windows);
    return {
        schema: 1,
        target: graph.target,
        unbounded_sources,
        groups: groups.map((group, at): PlanGroup => ({
            key: group.key,
            members: group.members,
            edges: group.edges,
            periods: periods?.per_group[at] ?? [],
            duty: dutiesIn(group, feasibility),
        })),
        composition: periods === null ? null : compositionOf(periods, groups),
        result_windows,
    };
}
