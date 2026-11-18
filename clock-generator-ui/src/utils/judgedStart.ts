import type { Config } from 'clock-generator/browser';

/** The start a result was judged from: what `overrides.judged_start` names */
export type JudgedStart = NonNullable<NonNullable<Config['overrides']>['judged_start']>;

/** The start of a result whose config names none: the backpressure start is the engine's default */
export const DEFAULT_JUDGED_START: JudgedStart = 'backpressure';

/** The start a config's clocks are judged from */
export const judgedStartOf = (overrides: Config['overrides']): JudgedStart => overrides?.judged_start ?? DEFAULT_JUDGED_START;

/** The start by its name in the glossary: "the cold start", "the backpressure start" */
export const startNameOf = (start: JudgedStart): string => (start === 'cold' ? 'the cold start' : 'the backpressure start');
