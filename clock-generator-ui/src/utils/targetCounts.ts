import type { Config } from 'clock-generator/browser';

/** What a target's rate counts: the item made and taken out of the build, or the item brought in and destroyed */
export type TargetCounts = NonNullable<Config['target_output']['counts']>;

/** The Counts field of Target Output, its choices and its help: every text of it, in one place */
export const COUNTS_TEXT = {
    label: 'Counts',
    made: 'Items made',
    destroyed: 'Items destroyed',
    helpLabel: 'About made and destroyed',
    helpMade: 'Items made: the build makes the item and its inserters take it out.',
    helpDestroyed: 'Items destroyed: inserters bring the item into the build and a recycler destroys it, as in an ore voider. '
        + 'The rate is what they bring in. What the recycler gives back and the build puts back into it is not counted.',
} as const;

/** What a target counts; a target without `counts` counts the item made */
export function countsOf(target: Pick<Config['target_output'], 'counts'>): TargetCounts {
    return target.counts ?? 'made';
}

/** The choices of the Counts field, the default first */
export const COUNTS_CHOICES: readonly { value: TargetCounts; label: string }[] = [
    { value: 'made', label: COUNTS_TEXT.made },
    { value: 'destroyed', label: COUNTS_TEXT.destroyed },
];

/** "Items destroyed" */
export function countsLabel(counts: TargetCounts): string {
    return COUNTS_TEXT[counts];
}

/**
 * The verb the results use for the target's rate: a target that counts the item made says what the clock makes, one that
 * counts the item destroyed says what it destroys (the build brings the item in and a recycler destroys it)
 */
export function rateVerbs(counts: TargetCounts | undefined): { title: string; third: string; base: string; ing: string } {
    return counts === 'destroyed'
        ? { title: 'Destroys', third: 'destroys', base: 'destroy', ing: 'destroying' }
        : { title: 'Makes', third: 'makes', base: 'make', ing: 'making' };
}
