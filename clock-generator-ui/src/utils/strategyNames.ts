import type { ClockStrategy, StrategyFamily, StrategyQualifier } from 'clock-generator/browser';

/**
 * The names of the ways to make a clock (the strategies), as the user reads them: each takes its name from a real
 * practice with a similar timing problem. The engine carries ids only (`ClockStrategy`); every word is here. The
 * wording was approved with the strategy names (0.28.0), and uses the glossary's words.
 */

/** What a clock needs to be named: the engine's label is the name of a clock kept before its strategy was carried */
export interface NamedClock {
    label: string;
    strategy?: ClockStrategy;
    /** The ticks of a clock rounded down to whole ticks, and how much faster than the setpoint it runs, as a share */
    roundedPeriodTicks?: number;
    roundedRunsFast?: number;
}

interface FamilyCopy {
    /** The name */
    name: string;
    /** The line under the name: where the name comes from, in a few words */
    line: string;
    /** The definition, first in the (i) */
    definition: string;
    /** The practice, its meaning here and its source, in the (i) */
    practice: string;
}

export const FAMILY_COPY: Record<StrategyFamily, FamilyCopy> = {
    'takt-batches': {
        name: 'Takt batches',
        line: 'Named after takt time: one batch of swings each crafting cycle.',
        definition: 'Each inserter gets one enable window each crafting cycle. The window is long enough for the swings the inserter makes in that cycle. '
            + 'The windows are read off a test run of the build at your setpoint.',
        practice: 'Takt time is the available production time divided by customer demand. Lean production uses it to set how fast work moves. '
            + 'Here the setpoint sets the crafting cycle. The work comes in one batch each cycle. '
            + 'Source: Lean Enterprise Institute, Lean Lexicon, "Takt time" (https://www.lean.org/lexicon-terms/takt-time/).',
    },
    'round-robin-polling': {
        name: 'Round-robin polling',
        line: 'Named after polling systems: groups of machines take their hands in turn.',
        definition: 'The machines that take from one source are divided into groups. The groups take their hands one after another. '
            + 'So the source is never asked for more than it holds.',
        practice: 'In a polling system, one server visits several queues in a fixed order. Here the source is the server and the groups are the queues. '
            + 'Each visit takes at most what the source holds. Source: Wikipedia, "Polling system".',
    },
    'euclidean-swings': {
        name: 'Euclidean swings',
        line: 'Named after Euclidean rhythms: whole swings take turns, so the average equals the plan.',
        definition: 'An inserter needs 3/2 swings each crafting cycle. It makes 1, 2, 1, 2 swings in turn. Its average is then 3/2.',
        practice: 'A Euclidean rhythm spreads its beats as evenly as possible, using the Euclidean algorithm. '
            + 'Source: G. Toussaint, "The Euclidean Algorithm Generates Traditional Musical Rhythms", Bridges 2005. '
            + 'In control, the same average is made by the split-time controller: it makes a fractional control value from whole outputs. '
            + 'It switches between the two neighbouring values in proportion. Source: P. K. Janert, Feedback Control for Computer Systems, pp. 110-111.',
    },
    'time-division-slots': {
        name: 'Time-division slots',
        line: 'Named after time-division multiple access: each inserter has its own slots.',
        definition: 'Each inserter gets one short enable window for every hand it moves. The windows are spread evenly over the window cycle. '
            + 'Inserters that move the same hands share enable windows.',
        practice: 'In time-division multiple access, each station sends in its own slot of a repeating frame. '
            + 'Source: Wikipedia, "Time-division multiple access".',
    },
    'time-study-windows': {
        name: 'Time-study windows',
        line: 'Named after time study: enable windows set by watching the work.',
        definition: 'The generator runs the build with only the output inserters on a clock. Every other inserter then gets an enable window. '
            + 'It covers the ticks the inserter was seen moving items. A few ticks of padding are added.',
        practice: 'A time study is the timed observation of a task to set a work standard. F. W. Taylor was an early user. '
            + 'Source: Wikipedia, "Time and motion study".',
    },
    'moved-output-swing': {
        name: 'Moved output swing',
        line: 'Time-study windows with one output swing moved.',
        definition: 'Time-study windows, with one output swing started earlier or later than even spacing. '
            + 'The machine holds the difference in its output slot.',
        practice: 'This name is plain. No real practice fits it.',
    },
    'signal-offset': {
        name: 'Signal offset',
        line: 'Named after offset in traffic signal timing: one set of swings moved in time.',
        definition: 'Takt batches with one set of swings moved to another place in the window cycle. '
            + 'The set is an output swing and the input swings planned with it. The limits of the machine set how far it can move.',
        practice: 'Traffic signals along a road work together. The offset is the timing difference between their phases. '
            + 'Source: FHWA, Traffic Signal Timing Manual, section 6.3.4 (https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter6.htm).',
    },
    'pitch-pickups': {
        name: 'Pitch pickups',
        line: 'Named after pitch in lean production: one full hand at a time.',
        definition: 'Each output inserter swings once each enable window. The window is timed so the machine holds a full hand when the inserter arrives.',
        practice: 'Pitch is the time needed in a production area to make one container of products. Here the container is a full hand. '
            + 'Source: Lean Enterprise Institute, Lean Lexicon, "Pitch" (https://www.lean.org/lexicon-terms/pitch/).',
    },
    'exhaust': {
        name: 'Exhaust',
        line: 'Clears byproducts out of the machine that makes them.',
        definition: 'Clears the byproducts the build no longer needs out of the machine that makes them. '
            + 'Each inserter that takes one away gets one enable window a window cycle. The windows come one after another. '
            + 'Each window is long enough for the hands the machine gives. This holds in all but 1 window cycle in 740.',
        practice: 'Set the window cycle so the container can hold its results at the worst time. That time is just before an enable window opens. '
            + 'Like exhaustive service in a polling system, it tries to empty the container. Its enable window has a fixed length. '
            + 'The length is chosen to empty the container in almost every window cycle. Source: Wikipedia, "Polling system".',
    },
};

interface QualifierChip {
    id: StrategyQualifier;
    /** What the chip says; the name and the chips are joined by " · " */
    label: string;
    /** The line in its hover and its (i) */
    line: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A share the way the engine's labels print it: "2.32%", "under 0.01%" */
const fastPercent = (share: number) => share * 100 < 0.005 ? 'under 0.01%' : `${Number((share * 100).toFixed(2))}%`;

type QualifierCopy = (clock: NamedClock) => Omit<QualifierChip, 'id'>;

const QUALIFIER_COPY: Record<StrategyQualifier, QualifierCopy> = {
    'output-swings': clock => ({
        label: `${plural(clock.strategy?.output_swings ?? 0, 'output swing', 'output swings')} a cycle`,
        line: 'The output inserter makes this many swings each crafting cycle.',
    }),
    'hands-brought-in': clock => ({
        label: `${plural(clock.strategy?.output_swings ?? 0, 'hand', 'hands')} brought in a cycle`,
        line: 'The inserters bring in this many hands each time the crafting cycle repeats.',
    }),
    'shared-enable-windows': () => ({
        label: 'shared enable windows',
        line: 'Inserters that open on the same tick share one enable window, the longest any needs. They share one decider.',
    }),
    'window-a-swing': () => ({
        label: 'one enable window a swing',
        line: 'The machine has room for more hands than the inserter needs. The inserter is enabled for one tick at each swing.',
    }),
    'shorter-window-cycle': () => ({
        label: 'shorter window cycle',
        line: 'Made from fewer swings each crafting cycle, so the whole window cycle is shorter.',
    }),
    'phase-accumulator': () => ({
        label: 'phase accumulator (subtick clock)',
        line: 'The clock counts the window cycle in fractions of a tick. The build then runs at exactly your rate. '
            + 'Source: Wikipedia, "Direct digital synthesis" (the phase accumulator).',
    }),
    'rounded-clock': clock => ({
        label: `rounded to ${clock.roundedPeriodTicks ?? '?'} ticks${clock.roundedRunsFast === undefined ? '' : `, ${fastPercent(clock.roundedRunsFast)} fast`}`,
        line: 'The same clock on a window cycle of whole ticks. It runs fast by the percent shown.',
    }),
    'loop-windows': () => ({
        label: 'kanban pull: loop windows',
        line: 'The inserters in a loop of machines get enable windows. So do the inserters that take out of the loop. '
            + 'Kanban is a pull system: a card shows that a container needs more items. Source: Wikipedia, "Kanban". '
            + 'Its latch is hysteresis: the switch-on and switch-off levels differ. Source: P. K. Janert, Feedback Control for Computer Systems, pp. 41-42.',
    }),
    'loop-exits-only': () => ({
        label: 'kanban pull: loop exits only',
        line: 'Only the inserters that take out of the loop get enable windows.',
    }),
    'drill-windows-longer': () => ({
        label: 'drill windows a tick longer',
        line: 'The mining drills that fill a chest get enable windows a tick longer than planned.',
    }),
    'drills-always-on': () => ({
        label: 'drills always on',
        line: 'The mining drills that fill a chest stay on. Their enable windows did not hold.',
    }),
    'fuel-hand-room': () => ({
        label: 'room for a hand of fuel',
        line: 'An inserter takes fuel off a belt. It has room in its enable window for one more hand.',
    }),
    'found-by-search': () => ({
        label: 'found by search',
        line: 'Found by trying placements in the simulator. It is not worked out from the numbers of the build.',
    }),
    'pickups-from-entry': () => ({
        label: 'pickups counted from entry',
        line: 'Belt pickups are counted from the time the inserter reaches the belt.',
    }),
    'harmonic-window-cycle': () => ({
        label: 'harmonic window cycle',
        line: 'An inserter fills a machine. It needs a fraction of a hand each crafting cycle, such as 15/8. It plans the next whole number of hands. '
            + 'The window cycle is cut so the output inserters move whole hands. Each swing rate is then a whole multiple of one base rate. '
            + 'A harmonic is a whole multiple of a base frequency. Source: J. O. Smith III, Spectral Audio Signal Processing, "Periodic Signals" (https://ccrma.stanford.edu/~jos/sasp/Periodic_Signals.html).',
    }),
};

/** The name of the clock's strategy; the engine's label for a clock kept before the strategy was carried */
export function strategyNameOf(clock: NamedClock): string {
    return clock.strategy ? FAMILY_COPY[clock.strategy.family].name : clock.label;
}

/** The copy of the clock's family; null for a clock kept before the strategy was carried */
export function familyCopyOf(clock: NamedClock): FamilyCopy | null {
    return clock.strategy ? FAMILY_COPY[clock.strategy.family] : null;
}

/** The chips after the name, in the order the engine lists the qualifiers */
export function qualifierChipsOf(clock: NamedClock): QualifierChip[] {
    return (clock.strategy?.qualifiers ?? []).map(id => ({ id, ...QUALIFIER_COPY[id](clock) }));
}

/** The separator between a name and its chips */
export const CHIP_SEPARATOR = ' · ';

/**
 * The whole name in one string, for a radio's label, an announcement, the install dialog, the saved pick:
 * "Takt batches · 2 output swings a cycle · shared enable windows"
 */
export function fullClockName(clock: NamedClock): string {
    return [strategyNameOf(clock), ...qualifierChipsOf(clock).map(chip => chip.label)].join(CHIP_SEPARATOR);
}

/**
 * The name of a clock still being made, from its task: the families are known from the task's id, a count of output
 * swings (`swings-6`) only by its number, as a takt batches or a round-robin polling clock is known only after the run.
 */
export function pendingClockName(task: { id: string; label: string }): string {
    const names: Record<string, StrategyFamily> = {
        'fractional': 'euclidean-swings',
        'even-hands': 'time-division-slots',
        'derived': 'time-study-windows',
        'uneven-output': 'moved-output-swing',
        'shifted-swings': 'signal-offset',
        'full-hand': 'pitch-pickups',
        'primitive-grouped': 'round-robin-polling',
    };
    const family = names[task.id];
    if (family) return FAMILY_COPY[family].name;
    const swings = /^swings-(\d+)$/.exec(task.id);
    return swings ? `${plural(Number(swings[1]), 'output swing', 'output swings')} a cycle` : task.label;
}
