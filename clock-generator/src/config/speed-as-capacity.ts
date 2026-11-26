/**
 * Machine and drill speed read as a capacity, not as part of what makes two units the same. Two units that differ only in a
 * machine's `crafting_speed` or a drill's `speed_bonus` are copies where each one makes its share: for each producer group of the
 * build (`feasibilityOf(graphOf(config)).utilizations`) whose machines all lie in the units compared, each unit's members make at
 * least the group's crafts needed over the number of units. The region finder reads speed the same way (`graph/regions.ts`,
 * `capacity_short`).
 */
import type { Config } from "./schema";
import { feasibilityOf, graphOf } from "../crafting/feasibility/assert-feasible";
import { exact } from "../crafting/feasibility/demand";
import { fraction } from "../data-types/fraction";
import type Fraction from "../data-types/fraction";

interface CapacityFacts { capacity: Map<string, Fraction>; utilizations: { keys: string[]; needed: Fraction }[] }

const facts_memo = new WeakMap<Config, CapacityFacts | null>();

function capacityFactsOf(config: Config): CapacityFacts | null {
    if (facts_memo.has(config)) return facts_memo.get(config)!;
    let out: CapacityFacts | null = null;
    try {
        const built = graphOf(config);
        if (built !== null) {
            const capacity = new Map(built.facts.nodes.flatMap(node => node.kind === "machine" || node.kind === "drill"
                ? [[node.key, exact(node.production.crafts_per_second)] as const] : []));
            const utilizations = feasibilityOf(built.facts, built.graph).utilizations.map(use => {
                const kind = use.group.split(":")[0];
                return { keys: use.machines.map(n => `${kind}:${n}`), needed: use.crafts_needed };
            });
            out = { capacity, utilizations };
        }
    } catch {
        // a build whose facts cannot be made has no capacity to read: its units are compared with their speed
        out = null;
    }
    facts_memo.set(config, out);
    return out;
}

/** Whether the build's capacity can be read; where it cannot, units that differ in speed are never copies */
export function capacityKnown(config: Config): boolean {
    return capacityFactsOf(config) !== null;
}

/**
 * For each unit of one set of units that match without their speed (each unit by its member keys, "machine:3", "drill:1"),
 * whether it makes its share of every producer group whose machines all lie in the set. All false where the capacity cannot be
 * read.
 */
export function unitsMakeTheirShare(config: Config, units: readonly (readonly string[])[]): boolean[] {
    const facts = capacityFactsOf(config);
    if (facts === null) return units.map(() => false);
    if (units.length < 2) return units.map(() => true);
    const all = new Set(units.flat());
    const ok = units.map(() => true);
    for (const use of facts.utilizations) {
        if (!use.keys.every(key => all.has(key))) continue;
        const share = use.needed.divide(units.length);
        units.forEach((unit, i) => {
            const made = use.keys.filter(key => unit.includes(key)).reduce((sum, key) => sum.add(facts.capacity.get(key) ?? fraction(0)), fraction(0));
            if (made.subtract(share).getNumerator < 0) ok[i] = false;
        });
    }
    return ok;
}

/** A unit's capacity: the sum of its machines' crafts a second, then of its drills' (the order of the unit a conversion keeps) */
export function unitCapacity(config: Config, unit: readonly string[]): [number, number] {
    const facts = capacityFactsOf(config);
    const sum = (kind: string) => unit.filter(key => key.startsWith(`${kind}:`))
        .reduce((total, key) => total + (facts?.capacity.get(key)?.toDecimal() ?? 0), 0);
    return [sum("machine"), sum("drill")];
}
