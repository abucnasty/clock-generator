import type { BuildPlan } from "../../data-types/build-plan";

/**
 * The snapshot of a sample's build plan, one file a sample: the plan as it is, with the sample's key after the schema.
 * Every decision is in it with its terms, so a change of a rule or of a figure it reads shows in its diff. A
 * main-period choice takes one line: a build that plans hundreds of output swings a cycle lists as many lower counts.
 */
export function planSnapshotOf(plan: BuildPlan, sample: string): string {
    const { schema, ...rest } = plan;
    const choices: string[] = [];
    const groups = rest.groups.map(group => ({ ...group, periods: group.periods.map(choice => {
        choices.push(JSON.stringify(choice));
        return `\u0000${choices.length - 1}`;
    }) }));
    const json = JSON.stringify({ schema, sample, ...rest, groups }, null, 2);
    return `${json.replace(/"\\u0000(\d+)"/g, (_, at: string) => choices[Number(at)])}\n`;
}
