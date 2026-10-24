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

/**
 * How a target that counts the item destroyed says the count of trips a crafting cycle: the inserters bring the item in
 * (they are not output inserters), so what a machine is given is a number of hands brought in, as the clocks are named
 */
export const HANDS_TEXT = {
    /** "5 hands brought in": the clock in the list and in Install */
    clock: (hands: number) => `${hands} ${hands === 1 ? 'hand' : 'hands'} brought in`,
    /** Check only's plan, the first sentence */
    plan: (hands: number, cycleTicks: string) => `Each machine that destroys the item has ${hands} ${hands === 1 ? 'hand' : 'hands'} brought in per crafting `
        + `cycle of ${cycleTicks} ticks, shared equally across the inserters that bring them in`,
    /** The crafting cycle navigator's sentence */
    navigator: (hands: number, shown: string) => `Each machine that destroys the item has ${shown} ${hands === 1 ? 'hand' : 'hands'} brought in per crafting cycle.`,
    /** The compare table's column and its help */
    column: 'Hands brought in',
    columnHelp: 'Hands of the item brought into each machine that destroys it per crafting cycle, shared equally across the inserters '
        + 'that bring it in. Per-inserter counts may be fractional. The clock repeats after a whole number of crafting cycles (the clock period).',
} as const;

/** Advanced's forced count of trips a crafting cycle: the output swings of an output machine, or the hands brought into a machine that destroys the item */
export const FORCE_TEXT = {
    made: {
        label: 'Force Output Swings',
        helpLabel: 'About Force Output Swings',
        help: ['Uses exactly this many total output swings per crafting cycle of each output machine for every clock, even if the clock does not hold the rate.',
            'The total is divided equally among that machine\'s output inserters; each inserter\'s count may be fractional.',
            'Leave empty to let the generator pick the count, lower it until the output holds the rate, and offer other counts as clocks.'],
        field: 'Total output swings per crafting cycle of each output machine',
        note: 'Note: Each output machine’s total output swings are divided equally among its output inserters; per-inserter counts may be fractional.',
    },
    destroyed: {
        label: 'Force Hands Brought In',
        helpLabel: 'About Force Hands Brought In',
        help: ['Uses exactly this many hands of the item brought into each machine that destroys it per crafting cycle, for every clock, even if the clock does not hold the rate.',
            'The total is divided equally among the inserters that bring it in; each inserter\'s count may be fractional.',
            'Leave empty to let the generator pick the count and lower it until the clock holds the rate.'],
        field: 'Total hands brought into each machine that destroys the item per crafting cycle',
        note: 'Note: Each machine’s hands brought in are divided equally among the inserters that bring them in; per-inserter counts may be fractional.',
    },
} as const;
