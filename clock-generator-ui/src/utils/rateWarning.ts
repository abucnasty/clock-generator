import type { ClockAlternativeView } from '../worker/types';
import { STALE_COPY_LABEL } from './resultsStaleness';

/** A rate as the sentences about it print it: at most two decimals, no trailing zeros ("192", "12.5", "0.33") */
const figure = (rate: number) => Number(rate.toFixed(2)).toString();

/**
 * The smallest shortfall a Copy button names. A clock less than this under the target prints as the target itself at
 * two decimals, and "240/s, below target" would read as nonsense.
 */
const MIN_SHORTFALL = 0.005;

const COPY_BLUEPRINT_LABEL = 'Copy blueprint';

/** The causes a clock does not recover from, in a sentence part: "coal stops arriving, or after iron-plate is not taken away" */
export function lossesOf(alternative: Pick<ClockAlternativeView, 'assessment'>): string {
    return alternative.assessment.backpressure_loss?.broken_by.join(', or after ') ?? '';
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
    if (alternative.verdict === 'no recovery') {
        const losses = lossesOf(alternative);
        return 'This clock does not recover: '
            + (losses ? `after ${losses} for a while, the build does not get back to its rate by itself` : 'the build was off its rate in the run that starves and jams it')
            + ' in the simulator, and has to be restarted.';
    }
    if (alternative.ranking.meets_target_rate) {
        return null;
    }
    const { items_per_second } = alternative.assessment;
    return `This clock does not hold the target rate: it runs at ${figure(items_per_second)} of `
        + `${figure(items_per_second - alternative.ranking.rate_off_target)} a second in the simulator.`;
}

/** Whether a clock runs short of the target rate by enough to say so on the Copy button */
export function isBelowTarget(alternative: Pick<ClockAlternativeView, 'ranking'> | undefined): boolean {
    return alternative !== undefined
        && !alternative.ranking.meets_target_rate
        && alternative.ranking.rate_off_target <= -MIN_SHORTFALL;
}

/**
 * What the workflow bar's Copy button says when it has not just been used: "Copy old clock…" while the clocks are for
 * an earlier build, "Copy blueprint (192/s, below target)" with the clock's own rate when it runs short of the target,
 * and "Copy blueprint" otherwise. The other warnings are shown by the button's colour, its icon and its tooltip.
 */
export function copyBlueprintLabelOf(
    alternative: Pick<ClockAlternativeView, 'assessment' | 'ranking'> | undefined,
    stale: boolean,
): string {
    if (stale) {
        return STALE_COPY_LABEL;
    }
    if (alternative && isBelowTarget(alternative)) {
        return `${COPY_BLUEPRINT_LABEL} (${figure(alternative.assessment.items_per_second)}/s, below target)`;
    }
    return COPY_BLUEPRINT_LABEL;
}
