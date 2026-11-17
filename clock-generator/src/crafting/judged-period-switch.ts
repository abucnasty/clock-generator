/**
 * The switch of the judged period of a subtick clock. On: a clock whose window cycle is a fraction of a tick, with a subtick
 * clock, is judged on P, its window cycle rounded to the nearest whole tick (`roundedPeriodOf`), in place of the whole ticks
 * its subtick clock repeats in, and its rate is read over the whole window cycles a span of P stands for (`judgedPeriodOf`,
 * long-run.ts). Off: the whole ticks of the subtick clock, as before. Off until the default is ruled.
 */
export const SUBTICK_CLOCK_JUDGED_ON_ROUNDED_PERIOD: boolean = false;
