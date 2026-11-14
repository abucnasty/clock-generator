import type { ClockModelAssumptions } from '../worker/types';
import { entityLabel, nameInSentence } from './entityLabel';

/**
 * How the texts of a build of one copy name an inserter that takes from a lane: "Inserter 8 into machine 2", by the labels
 * the page uses elsewhere; "Inserter 8" where the machine it puts into is not known. A build of more copies, or fewer, names
 * them by copy and has no namer.
 */
export type InserterNamer = (inserterId: number) => string;

export function inserterNamerOf(copies: number, assumptions: Pick<ClockModelAssumptions, 'machineOfInserter'> | undefined): InserterNamer | null {
    if (copies !== 1) return null;
    return inserterId => {
        const machine = assumptions?.machineOfInserter?.[inserterId];
        const inserter = entityLabel('inserter', inserterId);
        return machine === undefined ? inserter : `${inserter} into ${nameInSentence(entityLabel('machine', machine))}`;
    };
}
