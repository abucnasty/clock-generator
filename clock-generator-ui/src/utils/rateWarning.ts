import type { ClockAlternativeView } from '../worker/types';
import { STALE_COPY_LABEL } from './resultsStaleness';

/** A rate as the sentences about it print it: at most two decimals, no trailing zeros ("192", "12.5", "0.33") */
const figure = (rate: number) => Number(rate.toFixed(2)).toString();

/** A share as a percentage, as the engine's labels print it: "0.02%", "under 0.01%" */
const fastPercent = (share: number) => share * 100 < 0.005 ? 'under 0.01%' : `${Number((share * 100).toFixed(2))}%`;

/**
 * The smallest shortfall a Copy button names. A clock less than this under the target prints as the target itself at
 * two decimals, and "240/s, below target" would read as nonsense.
 */
const MIN_SHORTFALL = 0.005;

const COPY_BLUEPRINT_LABEL = 'Copy blueprint';

/** Label of every Copy button while a generation is still making clocks */
const COPY_CURRENT_BEST_LABEL = 'Copy current best';

/** Tooltip of the Copy buttons while a generation is still making clocks */
export const COPY_CURRENT_BEST_TOOLTIP = 'More clocks are still being made. This copies the best one so far.';

/** The causes a clock does not recover from, in a sentence part: "coal stops arriving, or after iron-plate is not taken away" */
export function lossesOf(alternative: Pick<ClockAlternativeView, 'assessment'>): string {
    return alternative.assessment.backpressure_loss?.broken_by.join(', or after ') ?? '';
}

/**
 * The sentence for the losses that were not tried because the clock already failed one, to follow another sentence
 * (" Not tried, since one failure is enough: coal stops arriving, iron-plate is not taken away."); empty when all were tried
 */
export function notTriedOf(alternative: Pick<ClockAlternativeView, 'assessment'>): string {
    const notTried = alternative.assessment.backpressure_loss?.not_tried ?? [];
    return notTried.length === 0 ? '' : ` Not tried, since one failure is enough: ${notTried.join(', ')}.`;
}

/**
 * What to tell whoever copies the blueprint of a clock: that it does not hold the target rate, as happens when no
 * clock does and the one nearest to it is selected; that it holds it and does not recover after the build is
 * starved or jammed; and that its build has a deadlock risk, with the two inserters that share an item. Null for a stable clock
 * at the target rate on a build without the risk.
 */
export function rateWarningOf(
    alternative: Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking' | 'deadlockRisk'> | undefined,
): string | null {
    if (!alternative) {
        return null;
    }
    const of_the_clock = clockWarningOf(alternative);
    return [of_the_clock, alternative.deadlockRisk].filter(part => part !== null).join(' ') || null;
}

function clockWarningOf(
    alternative: Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking'>,
): string | null {
    const warnings: string[] = [];
    if (alternative.assessment.start_dependence?.verdict === 'start-dependent') {
        warnings.push('This clock depends on how it is started: it reaches the target from some sampled starts and settles differently from others. See Model and tested starts.');
    } else if (alternative.assessment.start_dependence?.verdict === 'unstable') {
        warnings.push('This clock did not reach the target from any sampled start.');
    }
    if (alternative.assessment.backpressure_loss?.survives === false || alternative.verdict === 'no recovery') {
        const losses = lossesOf(alternative);
        warnings.push(losses
            ? `This clock does not recover: after ${losses} for a while, the build does not get back to its rate by itself in the simulator.${notTriedOf(alternative)}`
            : alternative.assessment.backpressure_loss === null
                ? 'No usable recovery result is available for this clock.'
                : 'Recovery could not be assessed: the simulator baseline for the loss trials was off its expected output.');
    }
    const { items_per_second } = alternative.assessment;
    const runsFast = alternative.ranking.runs_fast;
    if (runsFast !== undefined) {
        warnings.push(`This clock’s period is rounded down to whole ticks, so it runs ${fastPercent(runsFast)} fast: `
            // to three decimals: a rate 0.1% fast prints as the target at two
            + `${Number(items_per_second.toFixed(3))}/s for the ${Number((items_per_second - alternative.ranking.rate_off_target).toFixed(3))}/s requested, `
            + 'within the 0.1% a rounded clock may run and what the machines can make.');
    } else if (Math.abs(alternative.ranking.rate_off_target) >= MIN_SHORTFALL) {
        warnings.push(`This clock’s output rate differs from the target: it runs at ${figure(items_per_second)}/s; requested `
            + `${figure(items_per_second - alternative.ranking.rate_off_target)}/s in the simulator.`);
    }
    if (alternative.assessment.holds === false) {
        warnings.push('This clock does not hold its expected output in the modeled clock checks.');
    }
    return warnings.join(' ') || null;
}

/** Whether a clock runs short of the target rate by enough to say so on the Copy button */
export function isBelowTarget(alternative: Pick<ClockAlternativeView, 'ranking'> | undefined): boolean {
    return alternative !== undefined
        && !alternative.ranking.meets_target_rate
        && alternative.ranking.rate_off_target <= -MIN_SHORTFALL;
}

/**
 * What the workflow bar's Copy button says when it has not just been used: "Copy old clock…" while the clocks are for
 * an earlier build; "Copy current best" while a generation is still making clocks; with the clock's own rate when it
 * runs short of the target ("Copy blueprint (192/s, below target)", "Copy current best (192/s, below target)"); and
 * "Copy blueprint" otherwise. The other warnings are shown by the button's colour, its icon and its tooltip.
 */
export function copyBlueprintLabelOf(
    alternative: Pick<ClockAlternativeView, 'assessment' | 'ranking'> | undefined,
    stale: boolean,
    running = false,
): string {
    if (stale) {
        return STALE_COPY_LABEL;
    }
    const label = running ? COPY_CURRENT_BEST_LABEL : COPY_BLUEPRINT_LABEL;
    if (alternative && isBelowTarget(alternative)) {
        return `${label} (${figure(alternative.assessment.items_per_second)}/s, below target)`;
    }
    return label;
}
