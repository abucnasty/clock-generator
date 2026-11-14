import assert from "../../common/assert";
import { Config } from "../../config";
import { EntityId } from "../../entities";

/**
 * The copies of a build that one run holds, for the check of the lanes the copies share (crafting/shared-lane-verdict.ts):
 * copy 0 is the config's own entities, and each later copy is the config's entities again, or the part of them that a
 * part copy holds (`entity_ids`, by the config's ids). Every copy has machines, chests, drills and belts of its own; what
 * the copies share is put into the run after it is built (the shared lanes, crafting/shared-lane-model.ts).
 */
export interface BuildCopies {
    /** The copies after the config's own, in order: all of the config's entities, or the ids of those a part copy holds */
    readonly later: readonly ("whole" | ReadonlySet<string>)[];
}

/**
 * The number of copy `copy`'s entity: the config's number for copy 0, and a stride further for each later copy, so that
 * the numbers of the copies never meet and each copy's entities keep the config's order among themselves
 */
export const COPY_NUMBER_STRIDE = 100_000;

export function copyNumberOf(copy: number, number: number): number {
    return copy * COPY_NUMBER_STRIDE + number;
}

/** The entity of the config a copy's entity is a copy of: itself for the config's own */
export function twinOf(entity_id: EntityId): EntityId {
    return entity_id.number < COPY_NUMBER_STRIDE ? entity_id : EntityId.forEntity(entity_id.number % COPY_NUMBER_STRIDE, entity_id.type);
}

/** The entities of the config as one later copy has them, with the copy's numbers: none of them is a Config of its own */
export interface CopyEntries {
    belts: Config["belts"];
    machines: Config["machines"];
    chests: NonNullable<Config["chests"]>;
    inserters: { id: number; entry: Config["inserters"][number] }[];
    drills: NonNullable<Config["drills"]>["configs"];
}

/** Copy `copy`'s entries: the config's entries it holds, each id and each id it names moved to the copy's numbers */
export function copyEntriesOf(config: Config, copy: number, holds: "whole" | ReadonlySet<string>): CopyEntries {
    assert(copy > 0, "Copy 0 is the config's own entities");
    const largest = Math.max(0, ...config.belts.map(it => it.id), ...config.machines.map(it => it.id), ...(config.chests ?? []).map(it => it.id),
        ...config.inserters.map((it, index) => it.id ?? index + 1), ...(config.drills?.configs ?? []).map(it => it.id));
    assert(largest < COPY_NUMBER_STRIDE, `The copies of a run need the config's ids below ${COPY_NUMBER_STRIDE}`);
    const has = (id: EntityId) => holds === "whole" || holds.has(id.id);
    const moved = (id: number) => copyNumberOf(copy, id);
    const end = <T extends { type: string; id: number }>(end: T): T => ({ ...end, id: moved(end.id) });
    return {
        belts: config.belts.filter(belt => has(EntityId.forBelt(belt.id))).map(belt => ({ ...belt, id: moved(belt.id) })),
        machines: config.machines.filter(machine => has(EntityId.forMachine(machine.id))).map(machine => ({ ...machine, id: moved(machine.id),
            ...(machine.result_target !== undefined && { result_target: end(machine.result_target) }) })),
        chests: (config.chests ?? []).filter(chest => has(EntityId.forChest(chest.id))).map(chest => ({ ...chest, id: moved(chest.id) })),
        inserters: config.inserters.flatMap((inserter, index) => {
            const id = inserter.id ?? index + 1;
            if (!has(EntityId.forInserter(id))) return [];
            return [{ id: moved(id), entry: { ...inserter, id: moved(id), source: end(inserter.source), sink: end(inserter.sink) } as Config["inserters"][number] }];
        }),
        drills: (config.drills?.configs ?? []).filter(drill => has(EntityId.forDrill(drill.id))).map(drill => ({ ...drill, id: moved(drill.id), target: end(drill.target) })),
    };
}
