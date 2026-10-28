import { Mode } from "./mode";
import { reasonId, reasonText } from "./reason-table";

export type ModeTransition<M extends Mode = Mode> = Transition<M> | null;

const NoTransition: ModeTransition<any> = null;

export class Transition<M extends Mode> {
    /** The text of the reason, one copy for every transition that gives it (see reason-table.ts) */
    public readonly reason: string;
    /** The number the histories record for the reason */
    public readonly reason_id: number;

    constructor(
        public readonly toMode: M,
        reason: string,
    ) {
        this.reason_id = reasonId(reason);
        this.reason = reasonText(this.reason_id);
    }
}


function fold<M extends Mode>(transition: ModeTransition<M>, onNoTransition: () => M, onTransition: (transition: Transition<M>) => M): M {
    if (transition instanceof Transition) {
        return onTransition(transition);
    } else {
        return onNoTransition();
    }
}

function createTransition<M extends Mode>(toMode: M, reason: string): Transition<M> {
    return new Transition(toMode, reason);
}

export const ModeTransition = {
    fold: fold,
    NONE: NoTransition,
    transition: createTransition
}

