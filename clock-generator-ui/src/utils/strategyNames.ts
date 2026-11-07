import { catalogRowOf, routerRowOf, settingChipsOf, strategyRowOf } from 'clock-generator/light';
import type {
    AlwaysOnReason, ClockStrategy, EnableControl, Selection, SettingChip, StrategyCatalogRow, StrategyRef, TuningMethod,
} from 'clock-generator/browser';
import { entityLabel, type LabelKind } from './entityLabel';
import { modeText } from './wakeWindowCopy';

/**
 * The names of the ways to make a clock (the strategies), as the user reads them: each takes its name from a real
 * practice with a similar timing problem. The engine's strategy catalog holds the words of every strategy and router
 * (name, line, definition, practice) and the chip words of the clock settings (`settingChipsOf`); this file reads them
 * and adds the line each chip has in its hover and its (i).
 */

/** What a clock needs to be named: the engine's label is the name of a clock kept before its strategy was carried */
export interface NamedClock {
    label: string;
    strategy?: ClockStrategy;
}

/** A chip after the name: the tuning method and the selection of the strategy, then the settings of the clock */
interface ClockChip {
    /** 'tuning_method', 'selection', or the setting's field and value ("window_cycle:subtick_clock") */
    id: string;
    /** What the chip says; the name and the chips are joined by " · " */
    label: string;
    /** The line in its hover and its (i) */
    line: string;
}

/** The line of each value of the clock settings, in the hover of its chip and in the (i); the words of the chips are the catalog's */
const SETTING_LINES: Record<string, string> = {
    'output_count:output_swings': 'The output inserter makes this many swings each output cycle.',
    'output_count:hands_brought_in': 'The inserters bring in this many hands each time the output cycle repeats.',
    'shared_windows:shared_enable_windows': 'Inserters that open on the same tick share one enable window, the longest any needs. They share one decider.',
    'shared_windows:window_a_swing': 'The machine has room for more hands than the inserter needs. The inserter is enabled for one tick at each swing.',
    'window_cycle:shorter_window_cycle': 'Made from fewer swings each output cycle, so the whole window cycle is shorter.',
    'window_cycle:subtick_clock': 'The clock counts the window cycle in fractions of a tick. The build then runs at exactly your rate. '
        + 'Source: Wikipedia, "Direct digital synthesis" (the phase accumulator).',
    'window_cycle:rounded_clock': 'The same clock on a window cycle of whole ticks. It runs fast by the percent shown.',
    'loops:loop_windows': 'The inserters in a loop of machines get enable windows. So do the inserters that take out of the loop. '
        + 'Kanban is a pull system: a card shows that a container needs more items. Source: Wikipedia, "Kanban". '
        + 'Its latch is hysteresis: the switch-on and switch-off levels differ. Source: P. K. Janert, Feedback Control for Computer Systems, pp. 41-42.',
    'loops:loop_exits_only': 'Only the inserters that take out of the loop get enable windows.',
    'drill_windows:a_tick_longer': 'The mining drills that fill a chest get enable windows a tick longer than planned.',
    'belt_pickups:room_for_a_hand_of_fuel': 'An inserter takes fuel off a belt. It has room in its enable window for one more hand.',
    'belt_pickups:counted_from_entry': 'Belt pickups are counted from the time the inserter reaches the belt.',
    'window_cycle:harmonic_window_cycle': 'An inserter fills a machine. It needs a fraction of a hand each output cycle, such as 15/8. It plans the next whole number of hands. '
        + 'The window cycle is cut so the output inserters move whole hands. Each swing rate is then a whole multiple of one base rate. '
        + 'A harmonic is a whole multiple of a base frequency. Source: J. O. Smith III, Spectral Audio Signal Processing, "Periodic Signals" (https://ccrma.stanford.edu/~jos/sasp/Periodic_Signals.html).',
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The chip of a setting: the catalog's words and the line of its value */
function settingChip(chip: SettingChip): ClockChip {
    const id = `${chip.field}:${chip.value}`;
    return { id, label: chip.label, line: SETTING_LINES[id] ?? '' };
}

/** The name of the clock's strategy; the engine's label for a clock kept before the strategy was carried */
export function strategyNameOf(clock: NamedClock): string {
    return clock.strategy ? strategyRowOf(clock.strategy).name : clock.label;
}

/** The catalog row of the clock's strategy (name, line, definition, practice); null for a clock kept before the strategy was carried */
export function familyCopyOf(clock: NamedClock): StrategyCatalogRow | null {
    return clock.strategy ? strategyRowOf(clock.strategy) : null;
}

const TUNING_METHOD_COPY: Record<TuningMethod, Omit<ClockChip, 'id'>> = {
    calculated: { label: 'calculated', line: 'Windows calculated from the build\'s numbers.' },
    observed: { label: 'observed', line: 'Windows drawn around an unclocked run of the build.' },
};

const SELECTION_COPY: Record<Selection, Omit<ClockChip, 'id'>> = {
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

/** The chips after the name: the tuning method (none for Coordinated Sources) and the selection, then the settings of the clock in the order of the catalog */
export function clockChipsOf(clock: NamedClock): ClockChip[] {
    if (!clock.strategy) return [];
    const row = strategyRowOf(clock.strategy);
    return [
        ...(row.tuning_method === null ? [] : [{ id: 'tuning_method', ...TUNING_METHOD_COPY[row.tuning_method] }]),
        { id: 'selection', ...SELECTION_COPY[row.selection] },
        ...settingChipsOf(clock.strategy.settings).map(settingChip),
    ];
}

/** The separator between a name and its chips */
export const CHIP_SEPARATOR = ' · ';

/**
 * The whole name in one string, for a radio's label, an announcement, the install dialog, the saved pick:
 * "Takt Batches · calculated · one version · 2 output swings each output cycle · shared enable windows"
 */
export function fullClockName(clock: NamedClock): string {
    return [strategyNameOf(clock), ...clockChipsOf(clock).map(chip => chip.label)].join(CHIP_SEPARATOR);
}

/**
 * The name of a clock still being made, from its task: the strategies are known from the task's id, a count of output
 * swings (`swings-6`) only by its number, as a Takt Batches or a Round-Robin Polling clock is known only after the run.
 */
export function pendingClockName(task: { id: string; label: string }): string {
    const names: Record<string, StrategyRef> = {
        'fractional': { id: 'euclidean_swings', tuning_method: 'observed' },
        'even-hands': { id: 'time_division_windows', tuning_method: 'calculated' },
        'derived': { id: 'time_study_windows', tuning_method: 'observed' },
        'uneven-output': { id: 'moved_output_swing', tuning_method: 'observed' },
        'shifted-swings': { id: 'phase_shifted_batch', tuning_method: 'observed' },
        'full-hand': { id: 'pitch_pickups', tuning_method: 'observed' },
        'primitive-grouped': { id: 'round_robin_polling', tuning_method: 'calculated' },
    };
    if (task.id === 'per-branch') return routerRowOf('coordinated_sources').name;
    const known = names[task.id];
    if (known) return catalogRowOf(known).name;
    const swings = /^swings-(\d+)$/.exec(task.id);
    return swings ? `${plural(Number(swings[1]), 'output swing', 'output swings')} each output cycle` : task.label;
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
    const row = catalogRowOf({ id: control.id, tuning_method: control.tuning_method });
    return `${row.name}${CHIP_SEPARATOR}${control.tuning_method}`;
}

/** The reason in the words the Enable windows view uses, with its "Always on:" said "always enabled:" */
function alwaysEnabledText(reason: AlwaysOnReason): string {
    return (modeText({ mode: 'always-on', ownClock: undefined, alwaysOnReason: reason }) ?? '').replace(/^Always on: /, 'always enabled: ');
}
