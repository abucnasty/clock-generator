import type { ClockAlternativeView } from '../worker/types';

/** The losses a clock does not get back from, in a sentence part: "coal stops arriving, or after iron-plate is not taken away" */
export function lossesOf(alternative: Pick<ClockAlternativeView, 'backpressureLoss'>): string {
    return alternative.backpressureLoss?.broken_by.join(', or after ') ?? '';
}

/**
 * What to tell whoever copies the blueprint of a clock that does not hold the target rate, as happens when no
 * potential clock does and the one nearest to it is selected, or of one that holds it and does not survive
 * backpressure loss; null for a clock that is stable at the target rate.
 */
export function rateWarningOf(
    alternative: Pick<ClockAlternativeView, 'meetsTargetRate' | 'itemsPerSecond' | 'rateOffTarget' | 'holdsExpectedOutput' | 'backpressureLoss'> | undefined,
): string | null {
    if (!alternative || alternative.meetsTargetRate) {
        return null;
    }
    if (alternative.holdsExpectedOutput && alternative.backpressureLoss?.survives === false) {
        const losses = lossesOf(alternative);
        return 'This clock does not survive backpressure loss: '
            + (losses ? `after ${losses} for a while, the build does not get back to its rate by itself` : 'it was off its rate in the run the losses are tried on')
            + ' in the simulator, and has to be restarted.';
    }
    const figure = (rate: number) => Number(rate.toFixed(2)).toString();
    return `This clock does not hold the target rate: it runs at ${figure(alternative.itemsPerSecond)} of `
        + `${figure(alternative.itemsPerSecond - alternative.rateOffTarget)} a second in the simulator.`;
}
