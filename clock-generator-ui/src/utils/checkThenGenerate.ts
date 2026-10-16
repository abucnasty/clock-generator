import type { Config, ConfigValidation } from 'clock-generator/browser';
import type { ValidationState } from '../hooks/useSimulationWorker';
import type { Problem } from './firstProblem';
import { configKeyOf } from './resultsStaleness';

/** Every word this flow puts on screen: the buttons, their tooltips, the result chip, the alert and the swing plan */
export const CHECK_TEXT = {
    generate: 'Generate',
    generating: 'Generating...',
    checking: 'Checking...',
    checkOnly: 'Check only',
    generateTooltip: 'Checks your build, then makes the clocks.',
    checkOnlyTooltip: 'Checks that your build can be clocked, without making any clocks.',
    chipPassed: 'Check passed',
    chipFailed: 'Check failed',
    errorTitle: "The build can't be clocked yet",
    planEmpty: 'Check your build to see its swing plan. Generate does this too.',
    planFailed: 'The last check failed, so there is no swing plan. The reason is at the top of Configure.',
    planOutOfDate: 'You changed the build since this plan was made. Check only (or Generate) makes a new one.',
} as const;

/** Where the check stands for the build as it is now */
export type CheckStatus = 'none' | 'running' | 'valid' | 'invalid' | 'out-of-date';

// read only by the clock search after the plan, never by the check (`validateConfig`), so turning one does not
// make a check out of date
const GENERATION_ONLY_OVERRIDES = ['search_for_fewer_wake_ups', 'non_moving_belts'] as const;

/**
 * The key a check is for: the config's key without the settings only the clock search reads. A switch turned on and
 * off again gives the key it started with.
 */
export function checkKeyOf(config: Config): string {
    const { overrides, ...rest } = config;
    if (!overrides) {
        return configKeyOf(config);
    }
    const kept = Object.fromEntries(Object.entries(overrides).filter(([key, value]) =>
        value !== undefined && !(GENERATION_ONLY_OVERRIDES as readonly string[]).includes(key)));
    // the overrides go last on both sides of a comparison, wherever the config had them
    return configKeyOf((Object.keys(kept).length > 0 ? { ...rest, overrides: kept } : rest) as Config);
}

/** Where the last check stands for the build with `currentCheckKey` */
export function checkStatusOf(validation: ValidationState, currentCheckKey: string): CheckStatus {
    if (validation.status === 'none' || validation.status === 'running') {
        return validation.status;
    }
    return checkKeyOf(validation.config) !== currentCheckKey ? 'out-of-date' : validation.status;
}

/** How a check ended; `dropped` when Import, Paste, Reset or a newer check replaced it */
export type CheckOutcome =
    | { kind: 'valid'; validation: ConfigValidation }
    | { kind: 'invalid'; message: string }
    | { kind: 'dropped' };

type GenerateDecision =
    | { kind: 'wait' }
    | { kind: 'go-to-problem'; problem: Problem }
    | { kind: 'go-to-check-error' }
    | { kind: 'generate' }
    | { kind: 'check-first' };

interface DecisionInput {
    initialized: boolean;
    /** A generation, or a check started by Generate, is running */
    generating: boolean;
    checkStatus: CheckStatus;
    problems: Problem[];
}

/** What pressing Generate does. First match wins */
export function decideGenerate({ initialized, generating, checkStatus, problems }: DecisionInput): GenerateDecision {
    if (!initialized || generating || checkStatus === 'running') {
        return { kind: 'wait' };
    }
    if (problems.length > 0) {
        return { kind: 'go-to-problem', problem: problems[0] };
    }
    switch (checkStatus) {
        case 'invalid':
            return { kind: 'go-to-check-error' };
        case 'valid':
            return { kind: 'generate' };
        case 'none':
        case 'out-of-date':
            return { kind: 'check-first' };
    }
}

type CheckOnlyDecision = { kind: 'wait' } | { kind: 'show-problems' } | { kind: 'check' };

/** What pressing Check only does: never a view change or a scroll */
export function decideCheckOnly({ initialized, generating, checkStatus, problems }: DecisionInput): CheckOnlyDecision {
    if (!initialized || generating || checkStatus === 'running') {
        return { kind: 'wait' };
    }
    if (problems.length > 0) {
        return { kind: 'show-problems' };
    }
    return { kind: 'check' };
}

const STARTS_RUN: Record<GenerateDecision['kind'] | CheckOnlyDecision['kind'], boolean> = {
    'generate': true,
    'check-first': true,
    'check': true,
    'wait': false,
    'go-to-problem': false,
    'go-to-check-error': false,
    'show-problems': false,
};

/**
 * Whether a press of Generate or Check only runs something, which ends an Undo offer: running the build accepts it (the
 * owner, 2026-10-14). Going to a problem, or waiting for a run already going, runs nothing.
 */
export function startsRun(decision: GenerateDecision | CheckOnlyDecision): boolean {
    return STARTS_RUN[decision.kind];
}

/** What Generate does once the check it started has ended */
export function afterCheck(outcome: CheckOutcome): 'generate' | 'go-to-check-error' | 'stop' {
    switch (outcome.kind) {
        case 'valid':
            return 'generate';
        case 'invalid':
            return 'go-to-check-error';
        case 'dropped':
            return 'stop';
    }
}

/**
 * The chip in the workflow bar: a failed check, or a passed one while no clocks for this build are on screen (with
 * them, the check has plainly passed). Null otherwise.
 */
export function checkChipOf({ checkStatus, clocksAreForThisBuild }: {
    checkStatus: CheckStatus;
    clocksAreForThisBuild: boolean;
}): { label: string; color: 'success' | 'error' } | null {
    if (checkStatus === 'invalid') {
        return { label: CHECK_TEXT.chipFailed, color: 'error' };
    }
    if (checkStatus === 'valid' && !clocksAreForThisBuild) {
        return { label: CHECK_TEXT.chipPassed, color: 'success' };
    }
    return null;
}

/**
 * The checks waiting for an answer, as promises. Only the latest one is kept: beginning another drops the earlier
 * one. Every promise resolves, never rejects.
 */
export class PendingChecks {
    private pending = new Map<number, (outcome: CheckOutcome) => void>();

    begin(requestId: number): Promise<CheckOutcome> {
        this.dropAll();
        return new Promise((resolve) => {
            this.pending.set(requestId, resolve);
        });
    }

    settle(requestId: number, outcome: CheckOutcome): void {
        const resolve = this.pending.get(requestId);
        if (resolve) {
            this.pending.delete(requestId);
            resolve(outcome);
        }
    }

    dropAll(): void {
        const waiting = [...this.pending.values()];
        this.pending.clear();
        waiting.forEach((resolve) => resolve({ kind: 'dropped' }));
    }
}
