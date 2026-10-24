/**
 * The words of the UI: one word per idea in every string a player reads, and what each means. The Terms popover (⋮ >
 * Terms, and the (i) by the clock table's headers) lists these, so this file is the one source; new copy uses these
 * terms, and `insteadOf` lists the words they replace.
 *
 * Kept as they are: tick, UPS, combinator, insertion limit, Sidecar mod, Configure and Results, Generate, Stack size and
 * "Copy old clock…". The engine's own text (the clocks' names and descriptions, the Insights prose) is shown as it comes
 * and is not covered yet.
 */

export interface GlossaryEntry {
    id: GlossaryId;
    term: string;
    definition: string;
    /** The words the term replaces in the UI's own text: for whoever writes copy, not shown */
    insteadOf?: string;
    /** A word the page uses only where an expert looks; listed last */
    expert?: true;
    /** The definition is not settled yet; the popover says so after the term */
    provisional?: true;
}

export type GlossaryId =
    | 'swing'
    | 'swing-plan'
    | 'crafting-cycle'
    | 'clock-period'
    | 'wake-window'
    | 'wake-up'
    | 'start-point'
    | 'copies'
    | 'build'
    | 'your-builds'
    | 'share-link'
    | 'clock'
    | 'blueprint'
    | 'check'
    | 'enable-rule'
    | 'assembling-machine'
    | 'holds-the-rate'
    | 'starved'
    | 'jammed'
    | 'recovers'
    | 'belt-slack'
    | 'simulator'
    | 'hand'
    | 'lcm';

/** Provisional: the strict definition is written after an experiment; edit it here, and only here. */
export const PROVISIONAL_WAKE_UP_DEFINITION: string = 'One time the game wakes an inserter that is switched on and waiting, because a machine started a '
    + 'craft (inputs), or finished a craft or paid out productivity (outputs). Each is a small check that moves little or nothing, so fewer wake-ups cost less UPS.';

/** In the order the popover lists them; the expert terms last */
export const GLOSSARY: readonly GlossaryEntry[] = [
    {
        id: 'swing',
        term: 'swing',
        definition: 'One trip of an inserter: it picks something up and drops it.',
        insteadOf: 'transfer, trip, "hand" for a trip',
    },
    {
        id: 'swing-plan',
        term: 'swing plan',
        definition: 'How many swings each inserter makes per crafting cycle.',
        insteadOf: 'transfer plan',
    },
    {
        id: 'crafting-cycle',
        term: 'crafting cycle',
        definition: 'The short stretch of time the plan is built around. In one crafting cycle each output inserter makes a '
            + 'set number of swings.',
        insteadOf: 'cycle, output cycle',
    },
    {
        id: 'clock-period',
        term: 'clock period',
        definition: 'How long until the clock repeats: a whole number of crafting cycles. Shown in ticks.',
        insteadOf: 'period, LCM period',
    },
    {
        id: 'wake-window',
        term: 'wake window',
        definition: 'A stretch of ticks during which the clock switches an inserter on.',
        insteadOf: 'window, clock window, inserter window, enable range',
    },
    {
        id: 'wake-up',
        term: 'wake-up',
        definition: PROVISIONAL_WAKE_UP_DEFINITION,
        insteadOf: '"one start of a wake window"',
        provisional: true,
    },
    {
        id: 'start-point',
        term: 'start point',
        definition: 'The place in the clock period where the clock starts.',
        insteadOf: '"one start of the clock"',
    },
    {
        id: 'copies',
        term: 'copies',
        definition: 'How many identical units of your build you will place, including partial units such as 0.5 or 2.25. Describe one unit in the build.',
        insteadOf: 'copy as any other noun ("Copy" stays a verb: "Copy blueprint")',
    },
    {
        id: 'build',
        term: 'build',
        definition: 'The machines, inserters, belts and chests you set up, which the clocks are made for. Saved as a build '
            + 'file (Open build file…, Save build file, Reset build).',
        insteadOf: 'configuration, config',
    },
    {
        id: 'your-builds',
        term: 'Your builds',
        definition: 'The builds kept in this browser, one per name.',
        insteadOf: 'library, saved configs',
    },
    {
        id: 'share-link',
        term: 'share link',
        definition: 'A link that carries a copy of a build; opening it adds the build to Your builds.',
        insteadOf: 'permalink, URL',
    },
    {
        id: 'clock',
        term: 'clock',
        definition: 'The set of combinators that switches your inserters and mining drills on in their wake windows and repeats every clock '
            + 'period. The tool makes several and recommends one.',
        insteadOf: 'potential clock',
    },
    {
        id: 'blueprint',
        term: 'blueprint',
        definition: 'The Factorio string you paste in the game. It holds a clock\'s combinators, not your build.',
        insteadOf: '"blueprint" for a clock or a build',
    },
    {
        id: 'check',
        term: 'check',
        definition: 'Test that your build can be clocked, without making any clocks.',
        insteadOf: 'validation, "run a simulation", "re-run the simulation" (in sentences)',
    },
    {
        id: 'enable-rule',
        term: 'enable rule ("rule" for short)',
        definition: 'The rule that says when an inserter or drill is switched on. Modes: Auto, Always on, Never on, '
            + 'Clocked, Conditional.',
        insteadOf: 'enable control, override (only the Advanced section keeps "override"), AUTO, ALWAYS, NEVER, CLOCKED, CONDITIONAL',
    },
    {
        id: 'assembling-machine',
        term: 'assembling machine',
        definition: 'The Type option for an ordinary crafting machine (the others are Furnace and Biochamber). "Machine" '
            + 'stays the word for any of the three.',
        insteadOf: 'assembler, machine as a type',
    },
    {
        id: 'holds-the-rate',
        term: 'holds the rate',
        definition: 'The clock holds its expected output in the modeled cold-start checks while supplies remain available. '
            + 'A start-dependent clock can hold here yet settle differently from other sampled starts and be ranked unstable.',
        insteadOf: '"meets the target rate"',
    },
    {
        id: 'starved',
        term: 'starved',
        definition: 'An input runs out.',
        insteadOf: 'input loss',
    },
    {
        id: 'jammed',
        term: 'jammed',
        definition: 'The output is blocked and backs up.',
        insteadOf: 'backpressure loss',
    },
    {
        id: 'recovers',
        term: 'recovers',
        definition: 'In the simulator\'s evaluated loss trials, after the build is starved or jammed it gets back to its rate by itself. '
            + 'A clock that fails one loss is not tried on the others. '
            + 'This is separate from holding the modeled rate and from checks of other sampled starts.',
        insteadOf: 'survives backpressure loss, no recovery',
    },
    {
        id: 'belt-slack',
        term: 'belt slack',
        definition: 'Extra ticks added to a wake window so a late pickup from a moving belt can still finish.',
        insteadOf: 'belt pickup slack',
    },
    {
        id: 'simulator',
        term: 'simulator',
        definition: 'The tool\'s own model of your build, used to test each clock. It is not Factorio.',
        insteadOf: 'simulation, for a button press',
    },
    {
        id: 'hand',
        term: 'hand',
        definition: 'What an inserter is holding right now. Only for the load, never for the trip.',
        insteadOf: 'hand for a swing',
    },
    {
        id: 'lcm',
        term: 'LCM',
        // only in the Swing Plan and Advanced, glossed where it first appears
        definition: 'The number of crafting cycles in one clock period.',
        insteadOf: 'LCM cycles, LCM period',
        expert: true,
    },
];

/** The entries of `focus` first, in that order, then every other entry in the glossary's order */
export function glossaryWithFocus(focus: readonly GlossaryId[]): { related: GlossaryEntry[]; rest: GlossaryEntry[] } {
    const wanted = new Set(focus);
    return {
        related: focus.flatMap(id => GLOSSARY.filter(entry => entry.id === id)),
        rest: GLOSSARY.filter(entry => !wanted.has(entry.id)),
    };
}

/** The terms the clock table's (i) buttons open the Terms with, first */
export const TERMS_FOCUS = {
    wakeUps: ['wake-up', 'wake-window'],
    works: ['holds-the-rate', 'recovers', 'jammed', 'starved'],
} as const satisfies Record<string, readonly GlossaryId[]>;
