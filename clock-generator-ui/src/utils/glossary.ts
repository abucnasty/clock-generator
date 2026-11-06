/**
 * The words of the UI: one word per idea in every string a user reads, and what each means. The Terms popover (⋮ >
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
    | 'window-cycle-time'
    | 'enable-window'
    | 'wakeup'
    | 'start-point'
    | 'copies'
    | 'build'
    | 'configuration'
    | 'your-configurations'
    | 'share-link'
    | 'clock'
    | 'blueprint'
    | 'check'
    | 'enable-rule'
    | 'assembling-machine'
    | 'holds-the-rate'
    | 'supply-stop'
    | 'output-blockage'
    | 'recovery'
    | 'belt-slack'
    | 'simulator'
    | 'hand'
    | 'lcm'
    | 'setpoint'
    | 'stable'
    | 'steady-state'
    | 'signal';

/**
 * The glossary's wakeup, in the user's words (the repo glossary's alarm and sleep are maintainer words). Its case of a
 * switched-off inserter is provisional; edit it here, and only here.
 */
export const WAKEUP_DEFINITION: string = 'One time the game checks an inserter that is waiting, because a machine it waits on started a '
    + 'craft (inputs), or finished a craft or paid out productivity (outputs). Each is a small check that moves little or nothing, '
    + 'so fewer wakeups cost less UPS. It counts also when the clock has switched the inserter off; the clock switching an '
    + 'inserter on is not a wakeup. Only the switched-off case is provisional: seen on three builds in Factorio 2.1.24, its '
    + 'cost not measured.';

/**
 * The signals a clock sends, in the user's words. A signal here is the game's: the output a decider combinator sends. It is
 * counted once for each enable window that opens on a decider, as the engine counts it (`signalsPerMinuteOf`).
 */
export const SIGNAL_DEFINITION: string = 'A signal is the output a decider sends when one of its enable windows opens. It switches on every '
    + 'inserter wired to that decider. Inserters that share a decider share its signals. Each signal costs the game time. '
    + 'How a signal compares with a wakeup is not measured.';

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
        id: 'window-cycle-time',
        term: 'window cycle time',
        definition: 'The time of one window cycle: one complete sequence of all the enable windows of a clock, after which '
            + 'the sequence starts again. A whole number of crafting cycles, which can be a fraction of a tick. Shown in ticks.',
        insteadOf: 'clock period, period, LCM period',
    },
    {
        id: 'enable-window',
        term: 'enable window',
        definition: 'The ticks of the window cycle during which the clock makes an inserter\'s Enable if condition true, so '
            + 'that the inserter is switched on. A stretch that runs over the end of the window cycle is one enable window.',
        insteadOf: 'wake window, window, clock window, inserter window, enable range',
    },
    {
        id: 'wakeup',
        term: 'wakeup',
        definition: WAKEUP_DEFINITION,
        insteadOf: 'wake-up, wake up (as a noun), "one start of an enable window"',
        provisional: true,
    },
    {
        id: 'start-point',
        term: 'start point',
        definition: 'The place in the window cycle where the clock starts.',
        insteadOf: '"one start of the clock"',
    },
    {
        id: 'copies',
        term: 'copies',
        definition: 'How many identical builds you put in the game, including partial ones such as 0.5 or 2.25. Describe only one of them.',
        insteadOf: 'units (as the count), copy as any other noun ("Copy" stays a verb: "Copy blueprint")',
    },
    {
        id: 'build',
        term: 'build',
        definition: 'A group of entities in the game, of any number, that together make one product.',
        insteadOf: 'setup, structure, "build" as a verb',
    },
    {
        id: 'configuration',
        term: 'configuration',
        definition: 'A build, with its setpoint, copies and enable rules: what the site saves and what clocks are made '
            + 'for. Saved as a configuration file (Open configuration file…, Save configuration file, Reset configuration).',
        insteadOf: 'config, build file, "build" for what the site saves',
    },
    {
        id: 'your-configurations',
        term: 'Your configurations',
        definition: 'The configurations kept in this browser, one per name.',
        insteadOf: 'Your builds, library, saved configs',
    },
    {
        id: 'share-link',
        term: 'share link',
        definition: 'A link that carries a configuration; opening it adds the configuration to Your configurations.',
        insteadOf: 'permalink, URL',
    },
    {
        id: 'clock',
        term: 'clock',
        definition: 'The set of combinators that switches your inserters and mining drills on in their enable windows and repeats every '
            + 'window cycle. The tool makes several and recommends one.',
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
        definition: 'A test of a configuration that shows whether it can be clocked, without making any clocks.',
        insteadOf: 'check as a verb, validation, "run a simulation", "re-run the simulation" (in sentences)',
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
        insteadOf: '"meets the target rate", "holds the target rate" (say "holds the setpoint")',
    },
    {
        id: 'supply-stop',
        term: 'supply stop',
        definition: 'A time when one item stops arriving from the belts or chests of a build.',
        insteadOf: 'starved, input loss',
    },
    {
        id: 'output-blockage',
        term: 'output blockage',
        definition: 'A time when one product of a build is not taken away.',
        insteadOf: 'jammed, backpressure loss',
    },
    {
        id: 'recovery',
        term: 'recovery',
        definition: 'In the simulator\'s evaluated loss trials, the clock goes back to its rate by itself after a supply stop '
            + 'or an output blockage. A clock that fails one loss is not tried on the others. '
            + 'This is separate from holding the modeled rate and from checks of other sampled starts.',
        insteadOf: 'recovers, survives backpressure loss, gets back',
    },
    {
        id: 'belt-slack',
        term: 'belt slack',
        definition: 'Extra ticks added to an enable window so a late pickup from a moving belt can still finish.',
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
        id: 'setpoint',
        term: 'setpoint',
        definition: 'The product your build must make, and the rate it must hold, for all copies. The rate is in items per second. '
            + 'You set it. The clock never changes it.',
        insteadOf: 'target output, target rate, goal',
    },
    {
        id: 'stable',
        term: 'stable',
        definition: 'A clock is stable when it holds your setpoint at steady state. After a supply stop or an output blockage, '
            + 'the build also goes back to its rate by itself.',
        insteadOf: 'survives backpressure loss',
    },
    {
        id: 'steady-state',
        term: 'steady state',
        definition: 'The condition after the startup period. The build repeats the same pattern in each window cycle. '
            + 'The output repeats. It is not constant.',
        insteadOf: 'warm, warmed up, settled',
    },
    {
        id: 'signal',
        term: 'signal',
        definition: SIGNAL_DEFINITION,
        insteadOf: 'pulse, activation pulse',
    },
    {
        id: 'lcm',
        term: 'LCM',
        // only in the Swing Plan and Advanced, glossed where it first appears
        definition: 'The number of crafting cycles in one window cycle.',
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
    wakeUps: ['wakeup', 'enable-window'],
    signals: ['signal', 'wakeup', 'enable-window'],
    works: ['holds-the-rate', 'recovery', 'output-blockage', 'supply-stop'],
} as const satisfies Record<string, readonly GlossaryId[]>;
