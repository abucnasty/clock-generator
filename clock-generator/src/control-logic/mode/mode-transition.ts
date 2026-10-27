import { Mode } from "./mode";

export type ModeTransition<M extends Mode = Mode> = Transition<M> | null;

const NoTransition: ModeTransition<any> = null;

/**
 * One copy of each reason text: a reason made from a template ("machine has 12 of iron-plate to pickup") is a new string
 * on every transition, and the histories keep one per transition they record (hundreds of MB on a long run)
 */
const REASONS = new Map<string, string>();

function shared(reason: string): string {
    const kept = REASONS.get(reason);
    if (kept !== undefined) return kept;
    REASONS.set(reason, reason);
    return reason;
}

export class Transition<M extends Mode> {
    public readonly reason: string;

    constructor(
        public readonly toMode: M,
        reason: string,
    ) {
        this.reason = shared(reason);
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

