/**
 * The switch of the swing backoff beside a subtick clock that holds on P (judged-period-switch.ts). On: where the first
 * clock of a swing backoff (`generateClockWithSwingBackoff`) is judged on P and holds, the backoff runs as it does after a
 * first clock that does not hold (the counts below, to the first whose clock holds), and that clock is kept where it wakes
 * its inserters fewer times a minute and gets back to its rate after the loss trials. On P a clock one hand short every
 * window cycle can hold where it fails on the whole ticks of its subtick clock, and the backoff, which tries fewer swings
 * only after a failure, then never makes the clocks of fewer swings. Off: the backoff stops at the first clock that holds,
 * as before. Off until the default is ruled.
 */
export const SUBTICK_BACKOFF_BESIDE_A_CLOCK_THAT_HOLDS: boolean = false;
