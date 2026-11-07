import type { AlwaysOnReason } from "./always-on-reasons";
import type { ClockStrategy, StrategyConstruction, StrategyFamily } from "./clock-strategy";

/**
 * The words of every enable control strategy and router: one source for the engine's own text and the site (0.28.0 step 5.1,
 * packages/s5-per-part-clock/CATALOG.md and DECISIONS.md, questions 9-31). An enable control strategy is how an entity the clock
 * enables (an inserter or a mining drill) is controlled; a router gives each such entity either a strategy or its always-on reason.
 * Today's ids and fields stay as they are (their renames are the post-release retro); a row is found by the family, then the
 * construction.
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
export type Router = "direct" | "coordinated_sources";

/** What a router gives one entity: a strategy, or no enable windows and the reason it stays always enabled */
export type EnableControl =
    | { kind: "strategy"; family: StrategyFamily; construction?: StrategyConstruction }
    | { kind: "always_on"; reason: AlwaysOnReason };

/** The entities that take from one source and what the router gave each, by entity id ("inserter:3") */
export interface SourceControl {
    /** The source entity's id ("machine:2", "belt:1", "chest:1") */
    source: string;
    entities: Record<string, EnableControl>;
}

/** The router of a clock and, for Coordinated Sources, what it gave each source's entities */
export interface ClockRouting {
    router: Router;
    /** Set for coordinated_sources only: every source group, in the order the router took them (from the output upstream) */
    sources?: SourceControl[];
}

/** The words of a strategy: by its family, then its construction (the two Takt Batches) */
export function catalogRowOf(strategy: Pick<ClockStrategy, "family" | "construction">): StrategyCatalogRow {
    if (strategy.family === "takt-batches" && strategy.construction === "planning-run") return TAKT_BATCHES_OBSERVED;
    return FAMILY_ROWS[strategy.family];
}

/** The words of a router */
export function routerRowOf(router: Router): StrategyCatalogRow {
    return ROUTER_ROWS[router];
}

const TAKT_PRACTICE = "Takt time is the available production time divided by customer demand. Lean production uses it to set how fast work moves. "
    + "Here the setpoint sets the crafting cycle. The work comes in one batch each cycle. "
    + "Source: Lean Enterprise Institute, Lean Lexicon, \"Takt time\" (https://www.lean.org/lexicon-terms/takt-time/).";

const TAKT_BATCHES_OBSERVED: StrategyCatalogRow = {
    name: "Takt Batches",
    tuning_method: "observed",
    selection: "one_version",
    line: "Named after takt time: one batch of swings each crafting cycle.",
    definition: "Each inserter gets one enable window each crafting cycle. The window is long enough for the swings the inserter makes in that cycle. "
        + "The windows are read off a test run of the build at your setpoint.",
    practice: TAKT_PRACTICE,
};

const FAMILY_ROWS: Record<StrategyFamily, StrategyCatalogRow> = {
    "takt-batches": {
        name: "Takt Batches",
        tuning_method: "calculated",
        selection: "one_version",
        line: "Named after takt time: one batch of swings each crafting cycle.",
        // TEXT TO APPROVE (manager, 2026-11-07): the calculated half's last sentence
        definition: "Each inserter gets one enable window each crafting cycle. The window is long enough for the swings the inserter makes in that cycle. "
            + "The windows are calculated from the hands, the crafting cycle and the stock each machine holds.",
        practice: TAKT_PRACTICE,
    },
    "round-robin-polling": {
        name: "Round-Robin Polling",
        tuning_method: "calculated",
        selection: "best_of_versions",
        line: "Named after polling systems: groups of machines take their hands in turn.",
        definition: "The machines that take from one source are divided into groups. The groups take their hands one after another. "
            + "So the source is never asked for more than it holds.",
        practice: "In a polling system, one server visits several queues in a fixed order. Here the source is the server and the groups are the queues. "
            + "Each visit takes at most what the source holds. Source: Wikipedia, \"Polling system\".",
    },
    "euclidean-swings": {
        name: "Euclidean Swings",
        tuning_method: "observed",
        selection: "one_version",
        line: "Named after Euclidean rhythms: whole swings take turns, so the average equals the plan.",
        definition: "An inserter needs 3/2 swings each crafting cycle. It makes 1, 2, 1, 2 swings in turn. Its average is then 3/2.",
        practice: "A Euclidean rhythm spreads its beats as evenly as possible, using the Euclidean algorithm. "
            + "Source: G. Toussaint, \"The Euclidean Algorithm Generates Traditional Musical Rhythms\", Bridges 2005. "
            + "In control, the same average is made by the split-time controller: it makes a fractional control value from whole outputs. "
            + "It switches between the two neighbouring values in proportion. Source: P. K. Janert, Feedback Control for Computer Systems, pp. 110-111.",
    },
    "time-division-slots": {
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
    "time-study-windows": {
        name: "Time-Study Windows",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after time study: enable windows set by watching a run of the build.",
        definition: "The generator runs the build with only the output inserters on a clock. Every other inserter then gets an enable window. "
            + "It covers the ticks the inserter was seen moving items. A few ticks of padding are added.",
        practice: "A time study is the timed observation of a task to set a work standard. F. W. Taylor was an early user. "
            + "Source: Wikipedia, \"Time and motion study\".",
    },
    "moved-output-swing": {
        name: "Moved Output Swing",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Time-Study Windows with one output swing moved.",
        definition: "Time-Study Windows, with one output swing started earlier or later than even spacing. "
            + "The machine holds the difference in its output slot.",
        practice: "This name is plain. No real practice fits it.",
    },
    "signal-offset": {
        name: "Phase-Shifted Batch",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after phase shift in signal processing: one batch of swings moved in time.",
        definition: "Takt Batches with one set of swings moved to another place in the window cycle. "
            + "The set is an output swing and the input swings planned with it. The limits of the machine set how far it can move.",
        // TEXT TO APPROVE (manager, 2026-11-07): the practice text for the signal-processing source
        practice: "A phase shift moves one repeating signal along the time axis against another of the same period. "
            + "Source: Wikipedia, \"Phase (waves)\"; J. O. Smith III, Introduction to Digital Filters, \"Phase Delay\".",
    },
    "pitch-pickups": {
        name: "Pitch Pickups",
        tuning_method: "observed",
        selection: "found_by_search",
        line: "Named after pitch in lean production: one full hand at a time.",
        definition: "Each output inserter swings once each enable window. The window is timed so the machine holds a full hand when the inserter arrives.",
        practice: "Pitch is the time needed in a production area to make one container of products. Here the container is a full hand. "
            + "Source: Lean Enterprise Institute, Lean Lexicon, \"Pitch\" (https://www.lean.org/lexicon-terms/pitch/).",
    },
    // the per-branch clock is a router, not a strategy (question 24); its family id stays (`ClockStrategy.routing` names its router)
    "per-branch": {
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
    },
    "exhaust": {
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

const ROUTER_ROWS: Record<Router, StrategyCatalogRow> = {
    // TEXT TO APPROVE (manager, 2026-11-07): Direct's line and definition
    direct: {
        name: "Direct",
        tuning_method: null,
        selection: "one_version",
        line: "Every inserter follows one strategy.",
        definition: "Every inserter and mining drill the clock enables follows the one strategy of the clock, or stays always enabled for a reason.",
        practice: "This name is plain. No real practice fits it.",
    },
    coordinated_sources: FAMILY_ROWS["per-branch"],
};
