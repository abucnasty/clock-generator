/**
 * A deadlock a build can get into whatever its clock is (GOALS.md, "Two inserters that bring the same item"): when
 * two inserters bring the same item to a machine, one of them can be left holding it, with the item at its insertion
 * limit in the machine. Where that inserter brings another item as well, it takes nothing else off the belt while it
 * holds the first, and once the machine has run out of what it is not bringing, nothing moves again.
 *
 * The risk is read off the build alone: a machine with an inserter that brings two items or more, where another
 * inserter brings one of the same items. Whether it happens is a matter of the timing of the two against each other.
 */
import { ItemName } from "../data";
import { Entity, EntityId, ReadableEntityRegistry } from "../entities";

/** Two inserters that bring the same item to a machine, at least one of which brings another item too */
export interface SharedItemDeadlockRisk {
    machine_id: number;
    /** The item both inserters bring */
    item: ItemName;
    /** The two inserters, by id, and whatever else each brings to the machine: at least one of them brings something */
    inserters: [SharedItemInserter, SharedItemInserter];
}

export interface SharedItemInserter {
    inserter_id: number;
    /** The items it brings to the machine besides the shared one; it gets stuck with them missing when this is not empty */
    other_items: ItemName[];
}

/**
 * The deadlock risks of a build: one for each item two inserters bring to the same machine, where one of the two
 * brings another item as well. The items of an inserter are its filters, or without filters what its source has
 * of what its machine takes, as the entity has them.
 */
export function sharedItemDeadlockRisks(entity_registry: Pick<ReadableEntityRegistry, "getAll">): SharedItemDeadlockRisk[] {
    const feeders = entity_registry.getAll().filter(Entity.isInserter).filter(inserter => EntityId.isMachine(inserter.sink.entity_id));
    const risks: SharedItemDeadlockRisk[] = [];
    feeders.forEach((first, index) => {
        for (const second of feeders.slice(index + 1)) {
            if (first.sink.entity_id.id !== second.sink.entity_id.id || (first.filtered_items.size < 2 && second.filtered_items.size < 2)) {
                continue;
            }
            for (const item of first.filtered_items) {
                if (!second.filtered_items.has(item)) {
                    continue;
                }
                const sharing = (inserter: typeof first): SharedItemInserter => ({
                    inserter_id: inserter.entity_id.number,
                    other_items: Array.from(inserter.filtered_items).filter(other => other !== item),
                });
                const inserters = [sharing(first), sharing(second)].sort((a, b) => a.inserter_id - b.inserter_id) as [SharedItemInserter, SharedItemInserter];
                risks.push({ machine_id: first.sink.entity_id.number, item, inserters });
            }
        }
    });
    return risks.sort((a, b) => a.machine_id - b.machine_id || a.inserters[0].inserter_id - b.inserters[0].inserter_id || a.item.localeCompare(b.item));
}

/** "Inserters 1 and 2 both bring low-density-structure to machine 1; inserter 1 also brings flying-robot-frame, inserter 2 processing-unit." */
export function describeSharedItem(risk: SharedItemDeadlockRisk): string {
    const [first, second] = risk.inserters;
    const also = risk.inserters.filter(inserter => inserter.other_items.length > 0)
        .map((inserter, index) => `inserter ${inserter.inserter_id}${index === 0 ? " also brings" : ""} ${inserter.other_items.join(" and ")}`);
    return `Inserters ${first.inserter_id} and ${second.inserter_id} both bring ${risk.item} to machine ${risk.machine_id}; ${also.join(", ")}.`;
}

/**
 * What to tell whoever reads the clocks of a build with a deadlock risk, or copies one: which inserters share which
 * item, and what can come of it. Null for a build without one.
 */
export function deadlockRiskNote(risks: readonly SharedItemDeadlockRisk[]): string | null {
    if (risks.length === 0) {
        return null;
    }
    return `Deadlock risk: ${risks.map(describeSharedItem).join(" ")} An inserter that starts picking up an item the other has already `
        + "filled the machine with holds its hand until the machine has room, and brings nothing else while it does. If the machine "
        + "then runs out of what only that inserter brings, the build stops for good, whatever the clock does afterwards. "
        + "Whether that happens depends on the timing of the two inserters against each other.";
}
