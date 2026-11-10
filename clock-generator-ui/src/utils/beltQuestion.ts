import type { Config } from 'clock-generator/browser';

/** What the player says of the belts their inserters pick up from */
export type BeltAnswer = 'moving' | 'backed_up';

/** Whether the belt question means anything for a build, and its answer as the build stores it */
export interface BeltQuestion {
    /** An inserter takes from a belt of the build, so the answer can change a clock */
    ask: boolean;
    answer: BeltAnswer;
}

/** Every player-facing string of the belt question, in one place for the glossary */
export const BELT_COPY = {
    question: 'At your input pickups, items are:',
    moving: 'Moving',
    movingLine: 'Items continuously pass the pickup. Timing accounts for the stacks within reach; straight belt is the default pickup type. '
        + 'Clocks also leave a few extra ticks (belt slack) for late pickups.',
    backedUp: 'Backed up',
    backedUpLine: 'Items stop between pickups. Upstream supply refills the gaps, so a stack is available each pickup tick. Clocks omit belt slack.',
    help: 'Not sure? Leave it on Moving.',
    /** The heading of the question's card under the diagram */
    diagramHeading: 'Belts',
    resultsMoving: 'This run used your Moving belt setting.',
    actionMoving: 'My belts are backed up. Generate again',
    resultsBackedUp: 'This run used your Backed up belt setting.',
    actionBackedUp: 'My belts move. Generate again',
} as const;

/** The parts of a build the question is asked of: the form, or the config a generation ran with */
interface BeltBuild {
    inserters: ReadonlyArray<{ source: { type: string; id: number } }>;
    belts: ReadonlyArray<{ id: number }>;
    overrides?: { backed_up_belts?: boolean };
}

/**
 * Asked when a belt of the build feeds an inserter: only then does a clock get belt slack. The answer is read either
 * way, `backed_up_belts: true` being Backed up.
 */
export function beltQuestionOf(build: BeltBuild): BeltQuestion {
    const beltIds = new Set(build.belts.map(belt => belt.id));
    return {
        ask: build.inserters.some(inserter => inserter.source.type === 'belt' && beltIds.has(inserter.source.id)),
        answer: build.overrides?.backed_up_belts === true ? 'backed_up' : 'moving',
    };
}

/** What `overrides.backed_up_belts` stores for an answer: Moving stores nothing, never `false` */
export function backedUpBeltsFor(answer: BeltAnswer): true | undefined {
    return answer === 'backed_up' ? true : undefined;
}

/**
 * `config` with `answer` stored as the form stores it (`updateOverrides`), so a generation started from it has the key
 * the form has once the answer is set, and is not taken for out of date. Moving takes the key away, and the overrides
 * with it when it was the only one.
 */
export function withBeltAnswer(config: Config, answer: BeltAnswer): Config {
    const overrides: NonNullable<Config['overrides']> = { ...config.overrides, backed_up_belts: backedUpBeltsFor(answer) };
    if (overrides.backed_up_belts === undefined) {
        delete overrides.backed_up_belts;
    }
    if (Object.keys(overrides).length === 0) {
        const { overrides: _overrides, ...rest } = config;
        void _overrides;
        return rest;
    }
    return { ...config, overrides };
}

export function otherAnswer(answer: BeltAnswer): BeltAnswer {
    return answer === 'moving' ? 'backed_up' : 'moving';
}

/** The saved run's belt setting, and the action that generates clocks for the other answer */
export function beltResultsLine(answer: BeltAnswer): { text: string; actionLabel: string; switchTo: BeltAnswer } {
    return answer === 'moving'
        ? { text: BELT_COPY.resultsMoving, actionLabel: BELT_COPY.actionMoving, switchTo: otherAnswer(answer) }
        : { text: BELT_COPY.resultsBackedUp, actionLabel: BELT_COPY.actionBackedUp, switchTo: otherAnswer(answer) };
}

