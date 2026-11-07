import type { AlwaysOnReason } from "./always-on-reasons";
import type { ClockStrategy, StrategyId } from "./clock-strategy";

/**
 * The words of every enable control strategy and router: one source for the engine's own text and the site (0.28.0 step 5.1,
 * packages/s5-per-part-clock/CATALOG.md and DECISIONS.md, questions 9-31). An enable control strategy is how an entity the clock
 * enables (an inserter or a mining drill) is controlled; a router gives each such entity either a strategy or its always-on reason.
 * A strategy is identified by its id and its tuning method (the two Takt Batches); a row is found by both.
 */

/** How a strategy's enable windows are found: calculated from the build's numbers, or drawn around an unclocked run of the build */
export type TuningMethod = "calculated" | "observed";

/** How the generator settles on a clock: it makes one version, the best of several versions by simulation, or searches placements */
export type Selection = "one_version" | "best_of_versions" | "found_by_search";

/** The words of one enable control strategy (or of a router, whose tuning method is that of the strategies it gives) */
export interface StrategyCatalogRow {
    /** The name, in Title Case */
    name: string;
    /** null for a router: each entity takes the tuning method of the strategy it is given */
    tuning_method: TuningMethod | null;
    selection: Selection;
    /** The line under the name */
    line: string;
    /** The definition, first in the (i) */
    definition: string;
    /** The practice the name comes from, its meaning here and its source */
    practice: string;
}

/** Which router gave a clock's entities their strategies */
export type EnableControlStrategyRouter = "direct" | "coordinated_sources";

/** What a router gives one entity: a strategy, or no enable windows and the reason it stays always enabled */
export type EnableControl =
    | { kind: "strategy"; id: StrategyId; tuning_method: TuningMethod }
    | { kind: "always_on"; reason: AlwaysOnReason };

/** The entities that take from one source and what the router gave each, by entity id ("inserter:3") */
export interface SourceControl {
    /** The source entity's id ("machine:2", "belt:1", "chest:1") */
    source: string;
    entities: Record<string, EnableControl>;
}

/** The router of a clock and, for Coordinated Sources, what it gave each source's entities */
export interface ClockRouting {
    router: EnableControlStrategyRouter;
    /** Set for coordinated_sources only: every source group, in the order the router took them (from the output upstream) */
    sources?: SourceControl[];
}

/** How many swings the output inserter makes each crafting cycle; for a target that counts an item destroyed, how many hands the inserters bring in */
export type OutputCountSetting = { kind: "output_swings"; count: number } | { kind: "hands_brought_in"; count: number };

/** What sets the window cycle of a clock apart from the plain one */
export type WindowCycleSetting =
    /** A window cycle that is not a whole number of ticks is counted in fractions of a tick */
    | { kind: "subtick_clock" }
    /** The window cycle is rounded down to whole ticks and runs fast by `runs_fast`, as a share (0.0002 for 0.02%) */
    | { kind: "rounded_clock"; window_cycle_ticks: number; runs_fast: number }
    /** The window cycle is cut to the crafting cycles after which the output inserters move whole hands */
    | { kind: "harmonic_window_cycle" }
    /** The same construction at the generator's own swing count, so the whole window cycle is shorter */
    | { kind: "shorter_window_cycle" };

/** Which inserters share enable windows, or get one window a swing */
export type SharedWindowsSetting = "shared_enable_windows" | "window_a_swing";

/** Which entities of a loop of machines have enable windows */
export type LoopsSetting = "loop_windows" | "loop_exits_only";

/** The windows of the drills that fill a chest were made a tick longer than planned (a drill left always enabled is an `AlwaysOnReason`, not a setting) */
export type DrillWindowsSetting = "a_tick_longer";

/** How the windows of the inserters that take off a belt are counted */
export type BeltPickupSetting = "counted_from_entry" | "room_for_a_hand_of_fuel";

/**
 * The settings of a clock beyond its strategy: what the makers set on it. A field holds one value only where the makers never set two
 * together (`output_count`, `shared_windows`, `loops`, `drill_windows`); `window_cycle` and `belt_pickups` are lists, since a clock can
 * have a shorter or harmonic window cycle and also a subtick or rounded one, and counted-from-entry pickups with room for a hand of fuel.
 * Found by search is the strategy's selection, not a setting.
 */
export interface ClockSettings {
    output_count: OutputCountSetting;
    window_cycle: WindowCycleSetting[];
    shared_windows?: SharedWindowsSetting;
    loops?: LoopsSetting;
    drill_windows?: DrillWindowsSetting;
    belt_pickups: BeltPickupSetting[];
}

/** One chip of a clock's settings: the field and the value it shows, and its words (lower case) */
export interface SettingChip {
    field: keyof ClockSettings;
    /** The value's own id: the `kind` of an object value, else the value */
    value: string;
    label: string;
}

/** A share the way the engine's labels print it: "2.32%", "under 0.01%" */
const fastPercent = (share: number): string => share * 100 < 0.005 ? "under 0.01%" : `${Number((share * 100).toFixed(2))}%`;

/**
 * The chip words of the settings of a clock, in the order of the fields. A clock with the whole window cycle and no other setting has
 * the output count only. The words are CATALOG.md's "Clock settings".
 */
export function settingChipsOf(settings: ClockSettings): SettingChip[] {
    const chips: SettingChip[] = [];
    const { output_count } = settings;
    const { count } = output_count;
    chips.push({ field: "output_count", value: output_count.kind,
        label: output_count.kind === "output_swings" ? `${count} output ${count === 1 ? "swing" : "swings"} each output cycle`
            : `${count} ${count === 1 ? "hand" : "hands"} brought in each output cycle` });
    for (const cycle of settings.window_cycle) {
        const label = cycle.kind === "subtick_clock" ? "subtick clock"
            : cycle.kind === "rounded_clock" ? `rounded to ${cycle.window_cycle_ticks} ticks, ${fastPercent(cycle.runs_fast)} fast`
            : cycle.kind === "harmonic_window_cycle" ? "harmonic window cycle" : "shorter window cycle";
        chips.push({ field: "window_cycle", value: cycle.kind, label });
    }
    if (settings.shared_windows !== undefined) {
        chips.push({ field: "shared_windows", value: settings.shared_windows,
            label: settings.shared_windows === "shared_enable_windows" ? "shared enable windows" : "one enable window a swing" });
    }
    if (settings.loops !== undefined) {
        chips.push({ field: "loops", value: settings.loops, label: settings.loops === "loop_windows" ? "kanban pull: loop windows" : "kanban pull: loop exits only" });
    }
    if (settings.drill_windows !== undefined) chips.push({ field: "drill_windows", value: settings.drill_windows, label: "drill windows a tick longer" });
    for (const pickup of settings.belt_pickups) {
        chips.push({ field: "belt_pickups", value: pickup, label: pickup === "counted_from_entry" ? "pickups counted from entry" : "room for a hand of fuel" });
    }
    return chips;
}

/** The words of a strategy: by its id, then its tuning method (the two Takt Batches) */
export function catalogRowOf(strategy: { id: StrategyId; tuning_method: TuningMethod }): StrategyCatalogRow {
    if (strategy.id === "takt_batches" && strategy.tuning_method === "observed") return TAKT_BATCHES_OBSERVED;
    return STRATEGY_ROWS[strategy.id];
}

/** The tuning method every clock of a strategy has; null for Takt Batches, which has both */
export function fixedTuningMethodOf(id: StrategyId): TuningMethod | null {
    const method = STRATEGY_ROWS[id].tuning_method;
    return id === "takt_batches" ? null : method;
}

/** The words of a clock's strategy: its router's for Coordinated Sources, which has no strategy of its own, else its strategy's */
export function strategyRowOf(strategy: Pick<ClockStrategy, "id" | "tuning_method" | "routing">): StrategyCatalogRow {
    return strategy.id === null || strategy.tuning_method === null ? routerRowOf(strategy.routing.router) : catalogRowOf({ id: strategy.id, tuning_method: strategy.tuning_method });
}

/** The words of a router */
export function routerRowOf(router: EnableControlStrategyRouter): StrategyCatalogRow {
    return ROUTER_ROWS[router];
}

const TAKT_PRACTICE = "Takt time is the available production time divided by customer demand. Lean production uses it to set how fast work moves. "
    + "Here the setpoint sets the output cycle. The work comes in one batch each output cycle. "
    + "Source: Lean Enterprise Institute, Lean Lexicon, \"Takt time\" (https://www.lean.org/lexicon-terms/takt-time/).";

const TAKT_BATCHES_OBSERVED: StrategyCatalogRow = {
    name: "Takt Batches",
    tuning_method: "observed",
    selection: "one_version",
    line: "Named after takt time: one batch of swings each output cycle.",
    definition: "Each inserter gets one enable window each output cycle. The window is long enough for the swings the inserter makes in that output cycle. "
        + "The windows are read off a test run of the build at your setpoint.",
    practice: TAKT_PRACTICE,
};

const STRATEGY_ROWS: Record<StrategyId, StrategyCatalogRow> = {
    takt_batches: {
        name: "Takt Batches",
        tuning_method: "calculated",
        selection: "one_version",
        line: "Named after takt time: one batch of swings each output cycle.",
        definition: "Each inserter gets one enable window each output cycle. The window is long enough for the swings the inserter makes in that output cycle. "
            + "The windows are calculated from the hands, the output cycle and the stock each machine holds.",
        practice: TAKT_PRACTICE,
    },
    round_robin_polling: {
        name: "Round-Robin Polling",
        tuning_method: "calculated",
        selection: "best_of_versions",
        line: "Named after polling systems: groups of machines take their hands in turn.",
        definition: "The machines that take from one source are divided into groups. The groups take their hands one after another. "
            + "So the source is never asked for more than it holds.",
        practice: "In a polling system, one server visits several queues in a fixed order. Here the source is the server and the groups are the queues. "
            + "Each visit takes at most what the source holds. Source: Wikipedia, \"Polling system\".",
    },
    euclidean_swings: {
        name: "Euclidean Swings",
        tuning_method: "observed",
        selection: "one_version",
        line: "Named after Euclidean rhythms: whole swings take turns, so the average equals the plan.",
        definition: "An inserter needs 3/2 swings each output cycle. It makes 1, 2, 1, 2 swings in turn. Its average is then 3/2.",
        practice: "A Euclidean rhythm spreads its beats as evenly as possible, using the Euclidean algorithm. "
            + "Source: G. Toussaint, \"The Euclidean Algorithm Generates Traditional Musical Rhythms\", Bridges 2005. "
            + "In control, the same average is made by the split-time controller: it makes a fractional control value from whole outputs. "
            + "It switches between the two neighbouring values in proportion. Source: P. K. Janert, Feedback Control for Computer Systems, pp. 110-111.",
    },
    time_division_windows: {
        name: "Time-Division Windows",
        tuning_method: "calculated",
        selection: "one_version",
        line: "Named after time-division multiple access: one short enable window for each hand, spread evenly.",
        definition: "The generator calculates these windows from the hands. It does not watch a run. "
            + "Each inserter gets one short enable window for every hand it moves. The windows are spread evenly over the window cycle. "
            + "Inserters that move the same hands share enable windows.",
        practice: "In time-division multiple access, each station sends in its own slot of a repeating frame. "
            + "Source: Wikipedia, \"Time-division multiple access\".",
    },
    time_study_windows: {
        name: "Time-Study Windows",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after time study: enable windows set by watching a run of the build.",
        definition: "The generator runs the build with only the output inserters on a clock. Every other inserter then gets an enable window. "
            + "It covers the ticks the inserter was seen moving items. A few ticks of padding are added.",
        practice: "A time study is the timed observation of a task to set a work standard. F. W. Taylor was an early user. "
            + "Source: Wikipedia, \"Time and motion study\".",
    },
    moved_output_swing: {
        name: "Moved Output Swing",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Time-Study Windows with one output swing moved.",
        definition: "Time-Study Windows, with one output swing started earlier or later than even spacing. "
            + "The machine holds the difference in its output slot.",
        practice: "This name is plain. No real practice fits it.",
    },
    phase_shifted_batch: {
        name: "Phase-Shifted Batch",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after phase shift in signal processing: one batch of swings moved in time.",
        definition: "Takt Batches with one set of swings moved to another place in the window cycle. "
            + "The set is an output swing and the input swings planned with it. The limits of the machine set how far it can move.",
        practice: "A phase shift moves one repeating signal along the time axis against another that repeats as often. "
            + "Source: Wikipedia, \"Phase (waves)\"; J. O. Smith III, Introduction to Digital Filters, \"Phase Delay\".",
    },
    pitch_pickups: {
        name: "Pitch Pickups",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after pitch in lean production: one full hand at a time.",
        definition: "Each output inserter swings once each enable window. The window is timed so the machine holds a full hand when the inserter arrives.",
        practice: "Pitch is the time needed in a production area to make one container of products. Here the container is a full hand. "
            + "Source: Lean Enterprise Institute, Lean Lexicon, \"Pitch\" (https://www.lean.org/lexicon-terms/pitch/).",
    },
    exhaust: {
        name: "Exhaust",
        tuning_method: "calculated",
        selection: "one_version",
        line: "Clears byproducts out of the machine that makes them.",
        definition: "Clears the byproducts the build no longer needs out of the machine that makes them. "
            + "Each inserter that takes one away gets one enable window a window cycle. The windows come one after another. "
            + "Each window is long enough for the hands the machine gives. This holds in all but 1 window cycle in 740.",
        practice: "Set the window cycle so the container can hold its results at the worst time. That time is just before an enable window opens. "
            + "Like exhaustive service in a polling system, it tries to empty the container. Its enable window has a fixed length. "
            + "The length is chosen to empty the container in almost every window cycle. Source: Wikipedia, \"Polling system\".",
    },
};

const COORDINATED_SOURCES_ROW: StrategyCatalogRow = {
    name: "Coordinated Sources",
    tuning_method: null,
    selection: "best_of_versions",
    line: "The inserters of each source get their own enable windows, on one shared window cycle.",
    definition: "A source is a machine, belt or chest that inserters take from. The inserters of one source use the enable windows of one other clock made for the build. "
        + "All sources use the window cycle of the recommended clock. The generator sets the sources one at a time, from the output upstream. "
        + "It keeps the setting with the smallest number of wakeups for the full clock.",
    practice: "Traffic signals along a road work together in a coordination plan. All signals of the plan use the same cycle length. "
        + "The split and the offset are set for each intersection. "
        + "Source: FHWA, Traffic Signal Timing Manual (https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter6.htm).",
};

const ROUTER_ROWS: Record<EnableControlStrategyRouter, StrategyCatalogRow> = {
    direct: {
        name: "Direct",
        tuning_method: null,
        selection: "one_version",
        line: "Every inserter and mining drill follows one strategy.",
        definition: "The router that gives every inserter and mining drill of the clock the one chosen strategy. An entity the strategy does not control stays always enabled, with its reason.",
        practice: "This name is plain. No real practice fits it.",
    },
    coordinated_sources: COORDINATED_SOURCES_ROW,
};
