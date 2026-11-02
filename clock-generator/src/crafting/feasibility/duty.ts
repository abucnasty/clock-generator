/**
 * The duty of a machine group: the crafts a second it must make over the crafts a second its machines can make at
 * their own speed. The crafts are the feasibility demand's (`DemandResult.crafts`); the speed is only the machines'
 * crafting speed (the "crafts" limit of cut C1), not the limits of the inserters and belts around them.
 *
 * It is recorded only: reported with the feasibility result and never used to skip a check, refuse a build or change
 * a clock. A duty of 100% can still clock (BIOCHAMBER_FUEL asks its one machine for exactly the 0.5 crafts a second
 * it makes), and a duty below 100% proves nothing about the build's other limits.
 */
import type Fraction from "../../data-types/fraction";
import { DemandResult, exact, ZERO } from "./demand";
import { numberOf } from "./traps";

export interface GroupDuty {
    /** The producer group's key */
    readonly group: string;
    /** The numbers of its machines (or drills) */
    readonly machines: readonly number[];
    /** The crafts a second the group must make at the target, at least */
    readonly crafts_needed: Fraction;
    /** The crafts a second its machines can make at their speed */
    readonly crafts_capacity: Fraction;
    /** Needed over capacity: 1 is all the machines can make; above 1 their speed alone cannot carry the target */
    readonly duty: Fraction;
}

/** One duty for each producer group that must craft above zero */
export function dutiesOf(demand: DemandResult): GroupDuty[] {
    return demand.view.groups.flatMap((group): GroupDuty[] => {
        const needed = demand.crafts.get(group.key) ?? ZERO;
        if (!(needed.getNumerator > 0)) return [];
        const capacity = group.members.reduce((sum, member) => sum.add(exact(member.production.crafts_per_second)), ZERO);
        // a group of no crafting speed has no duty to report
        if (!(capacity.getNumerator > 0)) return [];
        return [{
            group: group.key,
            machines: group.members.map(member => numberOf(member.key)),
            crafts_needed: needed,
            crafts_capacity: capacity,
            duty: needed.divide(capacity),
        }];
    });
}
