import { catalogRowOf, routerRowOf } from 'clock-generator/light';
import type {
    AlwaysOnReason, ClockStrategy, EnableControl, Selection, StrategyCatalogRow, StrategyQualifier, TuningMethod,
} from 'clock-generator/browser';
import { entityLabel, type LabelKind } from './entityLabel';
import { modeText } from './wakeWindowCopy';

/**
 * The names of the ways to make a clock (the strategies), as the user reads them: each takes its name from a real
 * practice with a similar timing problem. The engine's strategy catalog holds the words of every strategy and router
 * (name, line, definition, practice); this file reads them (`catalogRowOf`, `routerRowOf`) and words the chips.
 */

/** What a clock needs to be named: the engine's label is the name of a clock kept before its strategy was carried */
export interface NamedClock {
    label: string;
    strategy?: ClockStrategy;
    /** The ticks of a clock rounded down to whole ticks, and how much faster than the setpoint it runs, as a share */
    roundedPeriodTicks?: number;
    roundedRunsFast?: number;
}

/** The catalog row of a clock's strategy: the router's for Coordinated Sources, the family's for the rest */
function rowOfStrategy(strategy: ClockStrategy): StrategyCatalogRow {
    return strategy.routing?.router === 'coordinated_sources' ? routerRowOf('coordinated_sources') : catalogRowOf(strategy);
}

/** A chip after the name: the tuning method and the selection of the strategy, then what qualifies the clock */
interface QualifierChip {
    id: StrategyQualifier | 'tuning_method' | 'selection';
    /** What the chip says; the name and the chips are joined by " · " */
    label: string;
    /** The line in its hover and its (i) */
    line: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A share the way the engine's labels print it: "2.32%", "under 0.01%" */
const fastPercent = (share: number) => share * 100 < 0.005 ? 'under 0.01%' : `${Number((share * 100).toFixed(2))}%`;

type QualifierCopy = (clock: NamedClock) => Omit<QualifierChip, 'id'>;

const QUALIFIER_COPY: Record<Exclude<StrategyQualifier, 'found-by-search'>, QualifierCopy> = {
    'output-swings': clock => ({
        label: `${plural(clock.strategy?.output_swings ?? 0, 'output swing', 'output swings')} a cycle`,
        line: 'The output inserter makes this many swings each output cycle.',
    }),
    'hands-brought-in': clock => ({
        label: `${plural(clock.strategy?.output_swings ?? 0, 'hand', 'hands')} brought in a cycle`,
        line: 'The inserters bring in this many hands each time the output cycle repeats.',
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
        line: 'Made from fewer swings each output cycle, so the whole window cycle is shorter.',
    }),
    'phase-accumulator': () => ({
        label: 'subtick clock',
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
    'pickups-from-entry': () => ({
        label: 'pickups counted from entry',
        line: 'Belt pickups are counted from the time the inserter reaches the belt.',
    }),
    'harmonic-window-cycle': () => ({
        label: 'harmonic window cycle',
        line: 'An inserter fills a machine. It needs a fraction of a hand each output cycle, such as 15/8. It plans the next whole number of hands. '
            + 'The window cycle is cut so the output inserters move whole hands. Each swing rate is then a whole multiple of one base rate. '
            + 'A harmonic is a whole multiple of a base frequency. Source: J. O. Smith III, Spectral Audio Signal Processing, "Periodic Signals" (https://ccrma.stanford.edu/~jos/sasp/Periodic_Signals.html).',
    }),
};

/** The name of the clock's strategy; the engine's label for a clock kept before the strategy was carried */
export function strategyNameOf(clock: NamedClock): string {
    return clock.strategy ? rowOfStrategy(clock.strategy).name : clock.label;
}

/** The catalog row of the clock's strategy (name, line, definition, practice); null for a clock kept before the strategy was carried */
export function familyCopyOf(clock: NamedClock): StrategyCatalogRow | null {
    return clock.strategy ? rowOfStrategy(clock.strategy) : null;
}

const TUNING_METHOD_COPY: Record<TuningMethod, Omit<QualifierChip, 'id'>> = {
    calculated: { label: 'calculated', line: 'Windows calculated from the build\'s numbers.' },
    observed: { label: 'observed', line: 'Windows drawn around an unclocked run of the build.' },
};

const SELECTION_COPY: Record<Selection, Omit<QualifierChip, 'id'>> = {
    one_version: { label: 'one version', line: 'One clock is made.' },
    // the engine does not carry how many versions were made, so the chip says several
    best_of_versions: {
        label: 'best of several versions',
        line: 'Several clocks are made. The simulation keeps the one with the fewest wakeups that holds.',
    },
    found_by_search: {
        label: 'found by search',
        line: 'Windows are moved through many placements in the simulator; the best that holds is kept.',
    },
};

/** The chips after the name: the tuning method (none for Coordinated Sources) and the selection, then the qualifiers in the order the engine lists them */
export function qualifierChipsOf(clock: NamedClock): QualifierChip[] {
    if (!clock.strategy) return [];
    const row = rowOfStrategy(clock.strategy);
    const qualifiers = clock.strategy.qualifiers.filter((id): id is Exclude<StrategyQualifier, 'found-by-search'> => id !== 'found-by-search');
    return [
        ...(row.tuning_method === null ? [] : [{ id: 'tuning_method' as const, ...TUNING_METHOD_COPY[row.tuning_method] }]),
        { id: 'selection' as const, ...SELECTION_COPY[row.selection] },
        ...qualifiers.map(id => ({ id, ...QUALIFIER_COPY[id](clock) })),
    ];
}

/** The separator between a name and its chips */
export const CHIP_SEPARATOR = ' · ';

/**
 * The whole name in one string, for a radio's label, an announcement, the install dialog, the saved pick:
 * "Takt Batches · calculated · one version · 2 output swings a cycle · shared enable windows"
 */
export function fullClockName(clock: NamedClock): string {
    return [strategyNameOf(clock), ...qualifierChipsOf(clock).map(chip => chip.label)].join(CHIP_SEPARATOR);
}

/**
 * The name of a clock still being made, from its task: the strategies are known from the task's id, a count of output
 * swings (`swings-6`) only by its number, as a Takt Batches or a Round-Robin Polling clock is known only after the run.
 */
export function pendingClockName(task: { id: string; label: string }): string {
    const names: Record<string, Pick<ClockStrategy, 'family' | 'construction'>> = {
        'fractional': { family: 'euclidean-swings' },
        'even-hands': { family: 'time-division-slots' },
        'derived': { family: 'time-study-windows' },
        'uneven-output': { family: 'moved-output-swing' },
        'shifted-swings': { family: 'signal-offset' },
        'full-hand': { family: 'pitch-pickups' },
        'primitive-grouped': { family: 'round-robin-polling', construction: 'grouped-hands' },
    };
    if (task.id === 'per-branch') return routerRowOf('coordinated_sources').name;
    const known = names[task.id];
    if (known) return catalogRowOf(known).name;
    const swings = /^swings-(\d+)$/.exec(task.id);
    return swings ? `${plural(Number(swings[1]), 'output swing', 'output swings')} a cycle` : task.label;
}

/** The router of a clock that follows one strategy, Direct, with its definition; null for any other clock */
export function directRouterOf(clock: NamedClock): { name: string; definition: string } | null {
    return clock.strategy?.routing?.router === 'direct' ? routerRowOf('direct') : null;
}

/** The lines of the (i) of a Coordinated Sources clock: each source and what the router gave its entities; none for any other clock */
export function sourceLinesOf(clock: NamedClock): string[] {
    const sources = clock.strategy?.routing?.sources ?? [];
    return sources.map(({ source, entities }) => {
        const gave = Object.entries(entities).map(([entity, control]) => ({ entity, text: controlText(control) }));
        const texts = new Set(gave.map(({ text }) => text));
        // one text for every entity of the source is said once; else each entity says its own
        const what = texts.size === 1 ? [...texts][0] : gave.map(({ entity, text }) => `${idLabel(entity)}: ${text}`).join('; ');
        return `${idLabel(source)} \u2192 ${what}`;
    });
}

/** "machine:2" as the views name it, "Machine 2" */
function idLabel(id: string): string {
    const [kind, number] = id.split(':');
    return kind in ENTITY_KINDS && /^\d+$/.test(number ?? '') ? entityLabel(kind as LabelKind, Number(number)) : id;
}

const ENTITY_KINDS: Record<LabelKind, true> = { machine: true, inserter: true, belt: true, chest: true, drill: true };

/** What the router gave one entity: the name of its strategy and its tuning method, or "always enabled: <reason>" */
function controlText(control: EnableControl): string {
    if (control.kind === 'always_on') return alwaysEnabledText(control.reason);
    const row = catalogRowOf({ family: control.family, construction: control.construction });
    return row.tuning_method === null ? row.name : `${row.name}${CHIP_SEPARATOR}${row.tuning_method}`;
}

/** The reason in the words the Enable windows view uses, with its "Always on:" said "always enabled:" */
function alwaysEnabledText(reason: AlwaysOnReason): string {
    return (modeText({ mode: 'always-on', ownClock: undefined, alwaysOnReason: reason }) ?? '').replace(/^Always on: /, 'always enabled: ');
}
