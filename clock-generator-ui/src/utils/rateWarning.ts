import type { ClockAlternativeView } from '../worker/types';

/**
 * What to tell whoever copies the blueprint of a clock that does not hold the target rate, as happens when no
 * potential clock does and the one nearest to it is selected; null for a clock that holds it.
 */
export function rateWarningOf(alternative: Pick<ClockAlternativeView, 'meetsTargetRate' | 'itemsPerSecond' | 'rateOffTarget'> | undefined): string | null {
    if (!alternative || alternative.meetsTargetRate) {
        return null;
    }
    const figure = (rate: number) => Number(rate.toFixed(2)).toString();
    return `This clock does not hold the target rate: it runs at ${figure(alternative.itemsPerSecond)} of `
        + `${figure(alternative.itemsPerSecond - alternative.rateOffTarget)} a second in the simulator.`;
}
