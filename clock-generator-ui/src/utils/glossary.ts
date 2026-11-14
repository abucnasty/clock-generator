/**
 * The words of the UI: one word per idea in every string a user reads, and what each means. The Terms popover (⋮ >
 * Terms, and the (i) by the clock table's headers) lists these, so this file is the one source; new copy uses these
 * terms, and `insteadOf` lists the words they replace.
 *
 * Kept as they are: tick, UPS, combinator, insertion limit, Sidecar mod, Configure and Results, Generate, Stack size and
 * "Copy old clock…".
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
    | 'strategy'
    | 'enable_control_strategy'
    | 'belt_strategy'
    | 'router'
    | 'direct'
    | 'coordinated_sources'
    | 'tuning_method'
    | 'selection'
    | 'unclocked_run'
    | 'window-cycle-time'
    | 'enable-window'
    | 'full-duty-cycle'
    | 'wakeup'
    | 'start-point'
    | 'copies'
    | 'build'
    | 'configuration'
    | 'your-configurations'
    | 'share-link'
    | 'clock'
    | 'rank'
    | 'blueprint'
    | 'check'
    | 'enable-rule'
    | 'assembling-machine'
    | 'holds-the-rate'
    | 'supply-stop'
    | 'output-blockage'
    | 'recovery'
    | 'simulator'
    | 'hand'
    | 'lcm'
    | 'setpoint'
    | 'stable'
    | 'steady-state'
    | 'oscillates'
    | 'signal';

/**
 * The glossary's wakeup, in the user's words (the repo glossary's alarm and sleep are maintainer words). Its case of a
 * switched-off inserter is provisional; edit it here, and only here.
 */
export const WAKEUP_DEFINITION: string = 'One time the game checks an inserter that is waiting. This happens because a machine it waits on started a '
    + 'craft (inputs), or finished a craft or paid out productivity (outputs). Each is a small check that moves little or nothing. '
    + 'Fewer wakeups cost less UPS. It counts also when the clock has switched the inserter off. The clock switching an '
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
        definition: 'How many swings each inserter makes each output cycle.',
        insteadOf: 'transfer plan',
    },
    {
        id: 'crafting-cycle',
        term: 'output cycle',
        definition: 'The time in which each output inserter makes its set number of swings at your setpoint. A window cycle is '
            + 'a whole number of output cycles.',
        insteadOf: 'crafting cycle, cycle',
    },
    {
        id: 'window-cycle-time',
        term: 'window cycle time',
        definition: 'The time of one window cycle, in ticks. A window cycle is one complete sequence of all the enable windows '
            + 'of a clock, after which the sequence starts again. The time is a whole number of output cycles, and can be a '
            + 'fraction of a tick.',
        insteadOf: 'clock period, period, LCM period',
    },
    {
        id: 'enable-window',
        term: 'enable window',
        definition: 'The ticks of the window cycle in which the clock makes the Enable if condition of an inserter true. '
            + 'The inserter is then switched on. A stretch that runs over the end of the window cycle is one enable window.',
        insteadOf: 'wake window, window, clock window, inserter window, enable range',
    },
    {
        id: 'full-duty-cycle',
        term: 'full duty cycle',
        definition: 'An inserter or drill whose swings take the whole window cycle, or all of it but its window\'s offset. Its '
            + 'enable windows would have a duty cycle of 1, so the clock leaves it always enabled.',
        insteadOf: 'busy',
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
        definition: 'How many identical builds you put in the game. It can be partial, such as 0.5 or 2.25. Describe only one of them.',
        insteadOf: 'units (as the count), copy as any other noun ("Copy" stays a verb: "Copy blueprint")',
    },
    {
        id: 'build',
        term: 'build',
        definition: 'A group of entities in the game, of any number, that together make one product.',
        insteadOf: 'setup, structure, cell, "build" as a verb',
    },
    {
        id: 'configuration',
        term: 'configuration',
        definition: 'A build, with its setpoint, copies and overrides: what the site saves and what clocks are made '
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
        definition: 'The set of combinators that switches your inserters and mining drills on in their enable windows. It repeats '
            + 'every window cycle. The tool makes several and recommends one.',
        insteadOf: 'potential clock, alternative, candidate, solution',
    },
    {
        id: 'rank',
        term: 'rank',
        definition: 'The place of a clock in the generator\'s order for a build. Rank 1 is the recommended clock.',
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
        definition: 'A test of a configuration that shows whether it can be clocked. It makes no clocks.',
        insteadOf: 'check as a verb, validation, "run a simulation", "re-run the simulation" (in sentences)',
    },
    {
        id: 'enable-rule',
        term: 'Enable Control Strategy override ("override" for short)',
        definition: 'The setting that overrides the Enable Control Strategy of one inserter or drill. Auto lets the generator '
            + 'choose the strategy. Always on, Clocked and Conditional decide the control instead.',
        insteadOf: 'enable rule, rule, enable control, AUTO, ALWAYS, CLOCKED, CONDITIONAL',
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
            + 'A start-dependent clock can hold here. It can still settle differently from other sampled starts, and be ranked unstable.',
        insteadOf: '"meets the target rate", "holds the target rate" (say "holds the setpoint")',
    },
    {
        id: 'supply-stop',
        term: 'supply stop',
        definition: 'A time when one item stops arriving from the belts or chests of a build.',
        insteadOf: 'starved, starvation, input loss',
    },
    {
        id: 'output-blockage',
        term: 'output blockage',
        definition: 'A time when one product of a build is not taken away.',
        insteadOf: 'jammed, jam, output loss',
    },
    {
        id: 'recovery',
        term: 'recovery',
        definition: 'In the simulator\'s loss trials, the clock goes back to its rate by itself. The trials are a supply stop '
            + 'and an output blockage. A clock that fails one loss is not tried on the others. '
            + 'This is separate from holding the modeled rate and from checks of other sampled starts.',
        insteadOf: 'gets back',
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
        definition: 'A clock is stable when it holds your setpoint at steady state. The build also goes back to its '
            + 'rate by itself after a supply stop or an output blockage.',
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
        id: 'oscillates',
        term: 'Oscillates',
        definition: 'The status of a clock that makes the setpoint on average, but the output of one or more window cycles is '
            + 'more than a hand off it. An output that repeats over a few window cycles, each within a hand, is a steady state '
            + 'and does not have this status.',
        insteadOf: 'Underproduces, for a clock that makes the setpoint on average',
    },
    {
        id: 'strategy',
        term: 'strategy',
        definition: 'One of several ways to do a job. The generator chooses the one that fits your build. The full form names '
            + 'the job, for example enable control strategy.',
        insteadOf: 'algorithm, clock type',
    },
    {
        id: 'enable_control_strategy',
        term: 'Enable Control Strategy',
        definition: 'How the clock controls one inserter or mining drill: the rule that places its enable windows. Each strategy '
            + 'is named after a practice with a similar timing problem. A router gives each entity its strategy. The site shows '
            + 'a strategy by its name, its tuning method and its selection.',
        insteadOf: 'clocking strategy',
    },
    {
        id: 'belt_strategy',
        term: 'belt strategy',
        definition: 'How a belt works in the simulator: Normal or Export. It is not an enable control strategy.',
    },
    {
        id: 'router',
        term: 'Enable Control Strategy Router ("router" for short)',
        definition: 'The rule above the strategies. It gives each inserter and mining drill of the clock an Enable Control Strategy. '
            + 'Or it gives the reason the entity stays always enabled. There are two: Direct and Coordinated Sources. '
            + 'An override other than Auto decides the entity\'s control before any strategy.',
    },
    {
        id: 'direct',
        term: 'Direct',
        definition: 'The router that gives every inserter and mining drill of the clock the one chosen strategy. An entity the '
            + 'strategy does not control stays always enabled, with its reason.',
    },
    {
        id: 'coordinated_sources',
        term: 'Coordinated Sources',
        definition: 'A source is a machine, belt or chest that inserters take from. The inserters of one source use the enable '
            + 'windows of another clock of the build. All sources use the window cycle of the recommended clock. The generator '
            + 'sets the sources one at a time, from the output upstream. It keeps the setting with the smallest number of '
            + 'wakeups for the full clock.',
    },
    {
        id: 'tuning_method',
        term: 'tuning method',
        definition: 'How the generator finds the enable windows. Calculated: from the numbers of your build. Observed: around an '
            + 'unclocked run of your build.',
    },
    {
        id: 'selection',
        term: 'selection',
        definition: 'How the generator gets the clock of a strategy. One version: it makes one clock. Best of N versions: it makes '
            + 'N clocks. It keeps the one with the fewest wakeups that holds the rate. Found by search: it moves the windows '
            + 'through many placements in the simulator. It keeps the best one that holds the rate.',
    },
    {
        id: 'unclocked_run',
        term: 'unclocked run',
        definition: 'A run of your build with no clock: all inserters and mining drills stay on. The generator watches what they do.',
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
        definition: 'The number of output cycles in one window cycle.',
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
} as const satisfies Record<string, readonly GlossaryId[]>;
