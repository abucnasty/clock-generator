/**
 * What the feasibility tests share: a config's cuts and issues, and the parts of the small configs they build by hand
 * (a turbo belt of stack 4, whose sides carry 120 items a second each; inserters of the default kind, a hand of 16 and
 * rotations of 3 ticks).
 */
import { describeFeasibilityIssue } from "../../config/errors";
import { Config } from "../../config/schema";
import type { PlannerFacts } from "../../data-types/planner-facts";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { plannerGraphOf } from "../graph/build-graph";
import { feasibilityOf } from "./assert-feasible";
import { Cut } from "./checks";

type Belt = Config["belts"][number];
type Inserter = Config["inserters"][number];
type Chest = NonNullable<Config["chests"]>[number];

/** The feasibility of facts: every cut, the issues and their texts, and one cut by its name */
export function feasibilityOfFacts(facts: PlannerFacts) {
    const { cuts, issues } = feasibilityOf(facts, plannerGraphOf(facts));
    return {
        cuts,
        issues,
        rules: issues.map(issue => issue.rule),
        texts: issues.map(describeFeasibilityIssue),
        cut: (name: string): Cut => {
            const found = cuts.find(cut => cut.name === name);
            if (found === undefined) throw new Error(`No cut ${name} among ${cuts.map(cut => cut.name).join(", ")}`);
            return found;
        },
    };
}

export const feasibilityOfConfig = (config: Config) => feasibilityOfFacts(toPlannerFacts(config));

/** The config with another target: so many items a second over so many copies */
export const withTarget = (config: Config, items_per_second: number, copies = 1): Config =>
    ({ ...structuredClone(config), target_output: { ...config.target_output, items_per_second, copies } });

export const belt = (id: number, lanes: readonly Belt["lanes"][number][], extra: Partial<Belt> = {}): Belt =>
    ({ id, type: "turbo-transport-belt", lanes: lanes as Belt["lanes"], ...extra });

export const lane = (ingredient: string, extra: Partial<Belt["lanes"][number]> = {}): Belt["lanes"][number] =>
    ({ ingredient, stack_size: 4, ...extra });

export const inserter = (id: number, source: Inserter["source"], sink: Inserter["sink"], extra: Partial<Inserter> = {}): Inserter =>
    ({ id, source, sink, ...extra } as Inserter);

/** An infinity chest that gives these items (and takes whatever is put into it) */
export const infinityChest = (id: number, items: readonly string[]): Chest =>
    ({ id, type: "infinity-chest", item_filter: items.map(item_name => ({ item_name, request_count: 100 })) } as Chest);
