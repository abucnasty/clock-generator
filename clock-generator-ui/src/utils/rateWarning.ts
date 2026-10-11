import type { ClockAlternativeView } from '../worker/types';

/** The losses a clock does not get back from, in a sentence part: "coal stops arriving, or after iron-plate is not taken away" */
export function lossesOf(alternative: Pick<ClockAlternativeView, 'assessment'>): string {
    return alternative.assessment.backpressure_loss?.broken_by.join(', or after ') ?? '';
}

/**
 * What to tell whoever copies the blueprint of a clock: that it does not hold the target rate, as happens when no
 * potential clock does and the one nearest to it is selected; that it holds it and does not survive backpressure
 * loss; and that its build has a deadlock risk, with the two inserters that share an item. Null for a stable clock
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
        return 'This clock does not survive backpressure loss: '
            + (losses ? `after ${losses} for a while, the build does not get back to its rate by itself` : 'it was off its rate in the run the losses are tried on')
            + ' in the simulator, and has to be restarted.';
    }
    if (alternative.ranking.meets_target_rate) {
        return null;
    }
    const figure = (rate: number) => Number(rate.toFixed(2)).toString();
    const { items_per_second } = alternative.assessment;
    return `This clock does not hold the target rate: it runs at ${figure(items_per_second)} of `
        + `${figure(items_per_second - alternative.ranking.rate_off_target)} a second in the simulator.`;
}
