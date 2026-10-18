import type { Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { recommendedIndexOf } from './recommendedClock';

/** What the player says of the belts their inserters pick up from */
export type BeltAnswer = 'moving' | 'standing';

/** Whether the belt question means anything for a build, and its answer as the build stores it */
export interface BeltQuestion {
    /** An inserter takes from a belt of the build, so the answer can change a clock */
    ask: boolean;
    answer: BeltAnswer;
}

/** Every player-facing string of the belt question, in one place for the glossary */
export const BELT_COPY = {
    question: 'Your input belts are:',
    moving: 'Moving',
    movingLine: 'Items continuously pass the pickup. With a known pickup type, timing accounts for the stacks within reach. '
        + 'Clocks also leave a few extra ticks (belt slack) for late pickups.',
    standing: 'Backed up',
    standingLine: 'Items stop between pickups. The belt moves to refill the gaps. Clocks use backed-up timing without belt slack.',
    help: 'Not sure? Leave it on Moving.',
    /** The heading of the question's card under the diagram */
    diagramHeading: 'Belts',
    resultsMoving: 'This run used your Moving belt setting.',
    actionMoving: 'My belts are backed up. Generate again',
    resultsStanding: 'This run used your Backed up belt setting.',
    actionStanding: 'My belts move. Generate again',
    hint: (standing: number, moving: number) =>
        `On backed-up belts, this build may do with ${standing} wake-ups a minute instead of ${moving}; fewer is better, as each one costs a little UPS.`,
    /** Under the Belt column of a clock made without belt slack, in a run for moving belts */
    onlyIfStanding: 'Only if your input belts are backed up',
} as const;

/** The parts of a build the question is asked of: the form, or the config a generation ran with */
interface BeltBuild {
    inserters: ReadonlyArray<{ source: { type: string; id: number } }>;
    belts: ReadonlyArray<{ id: number }>;
    overrides?: { non_moving_belts?: boolean };
}

/**
 * Asked when a belt of the build feeds an inserter: only then does a clock get belt slack. The answer is read either
 * way, `non_moving_belts: true` being Standing.
 */
export function beltQuestionOf(build: BeltBuild): BeltQuestion {
    const beltIds = new Set(build.belts.map(belt => belt.id));
    return {
        ask: build.inserters.some(inserter => inserter.source.type === 'belt' && beltIds.has(inserter.source.id)),
        answer: build.overrides?.non_moving_belts === true ? 'standing' : 'moving',
    };
}

/** What `overrides.non_moving_belts` stores for an answer: Moving stores nothing, never `false` */
export function nonMovingBeltsFor(answer: BeltAnswer): true | undefined {
    return answer === 'standing' ? true : undefined;
}

/**
 * `config` with `answer` stored as the form stores it (`updateOverrides`), so a generation started from it has the key
 * the form has once the answer is set, and is not taken for out of date. Moving takes the key away, and the overrides
 * with it when it was the only one.
 */
export function withBeltAnswer(config: Config, answer: BeltAnswer): Config {
    const overrides: NonNullable<Config['overrides']> = { ...config.overrides, non_moving_belts: nonMovingBeltsFor(answer) };
    if (overrides.non_moving_belts === undefined) {
        delete overrides.non_moving_belts;
    }
    if (Object.keys(overrides).length === 0) {
        const { overrides: _overrides, ...rest } = config;
        void _overrides;
        return rest;
    }
    return { ...config, overrides };
}

export function otherAnswer(answer: BeltAnswer): BeltAnswer {
    return answer === 'moving' ? 'standing' : 'moving';
}

/** The saved run's belt setting, and the action that generates clocks for the other answer */
export function beltResultsLine(answer: BeltAnswer): { text: string; actionLabel: string; switchTo: BeltAnswer } {
    return answer === 'moving'
        ? { text: BELT_COPY.resultsMoving, actionLabel: BELT_COPY.actionMoving, switchTo: otherAnswer(answer) }
        : { text: BELT_COPY.resultsStanding, actionLabel: BELT_COPY.actionStanding, switchTo: otherAnswer(answer) };
}

/** Wake-ups as the selection compares them: to a thousandth */
const wakeUpsKey = (wakeUps: number) => Math.round(wakeUps * 1000);

/**
 * On a moving-belt result, what the pick would be on backed-up belts, worked out from the clocks on screen: a
 * standing-belts run counts every clock as made for the belt. The sentence only when that clock holds the target rate
 * with fewer wake-ups than the pick. "May": a standing-belts run can make its clocks slightly differently.
 */
export function standingBeltsHint(
    alternatives: Pick<ClockAlternativeView, 'ranking'>[],
    recommendedIndex: number | null,
    used: BeltAnswer,
): string | null {
    const pick = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    if (used !== 'moving' || !pick) {
        return null;
    }
    const standingIndex = recommendedIndexOf(alternatives.map(clock => ({ ranking: { ...clock.ranking, matches_belt_choice: true } })));
    const standing = standingIndex === null ? undefined : alternatives[standingIndex];
    if (!standing || !standing.ranking.meets_target_rate) {
        return null;
    }
    const standingWakeUps = standing.ranking.wake_ups_per_minute;
    const pickWakeUps = pick.ranking.wake_ups_per_minute;
    if (standingWakeUps === null || pickWakeUps === null || wakeUpsKey(standingWakeUps) >= wakeUpsKey(pickWakeUps)) {
        return null;
    }
    // printed as the table prints them; a difference that rounds away is not worth a sentence
    const [fewer, more] = [Math.round(standingWakeUps), Math.round(pickWakeUps)];
    return fewer < more ? BELT_COPY.hint(fewer, more) : null;
}
