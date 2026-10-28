import { ZodError } from "zod";
import { fraction } from "../data-types/fraction";

/**
 * Represents a single validation error with user-friendly details.
 */
export interface ConfigValidationIssue {
    /** The path to the invalid field (e.g., "machines[0].productivity") */
    path: string;
    /** User-friendly error message */
    message: string;
    /** Expected type or value */
    expected?: string;
    /** Actual value received */
    received?: unknown;
}

/**
 * What the generator does not model yet, by the `type` a config or a sidecar export names for it, and where on the
 * roadmap (docs/ROADMAP.md) it comes. A config naming one of these is refused with the reason, not with the list of
 * types it takes.
 */
export const NOT_SUPPORTED_YET: Readonly<Record<string, string>> = {
    "rocket-silo": "a rocket silo as a machine, crafting rocket parts and launching, comes with phase 2 of roadmap milestone M2 "
        + "(containers); a rocket silo is taken as a chest: list it under `chests` with type \"rocket-silo\"",
    "lab": "labs are not modelled: they consume no recipe",
};

/** The refusal of a build whose target product passes through more than one container on its way out */
export const CONTAINER_OUTPUT_PATH_REFUSAL = "the target product passes through more than one container on its way out of the build, "
    + "which is not modelled yet (roadmap milestone M2, containers): the generator models a product taken out of the machine "
    + "that makes it, or out of the one container that machine's inserters put it into";

/**
 * What the generator leaves out on purpose, not on the roadmap. A config or capture naming one of these is refused
 * with the reason, never modelled as the nearest thing the generator does support.
 */
export const OUT_OF_SCOPE = {
    side_loaded_pickup: "picking up from a belt tile that another belt side-loads onto, as one stream or two merging, is out of scope, "
        + "as splitters are: the generator models a belt that runs straight onto the pickup tile, an underground endpoint "
        + "and an over-the-hood pickup",
    splitter_pickup: "picking up from a splitter is out of scope",
    blacklist_filters: "filters that are a blacklist, naming the items an inserter leaves, are out of scope: the generator "
        + "reads `filters` as the items an inserter moves, a whitelist",
} as const;

/** The refusal of a field that only a side-loaded pickup has */
export function sideLoadedPickupRefusal(field: string): string {
    return `\`${field}\` is refused: ${OUT_OF_SCOPE.side_loaded_pickup}`;
}

function formatPath(pathArray: readonly (string | number)[]): string {
    return pathArray.length > 0
        ? pathArray.map((p: string | number, i: number) =>
            typeof p === "number" ? `[${p}]` : (i === 0 ? String(p) : `.${String(p)}`)
          ).join("")
        : "(root)";
}

function valueAt(input: unknown, pathArray: readonly (string | number)[]): unknown {
    let value: unknown = input;
    for (const step of pathArray) {
        if (value === null || typeof value !== "object") {
            return undefined;
        }
        value = (value as Record<string | number, unknown>)[step];
    }
    return value;
}

/**
 * Custom error class for configuration validation failures.
 * Wraps Zod errors with user-friendly field-level messages.
 */
export class ConfigValidationError extends Error {
    public readonly issues: ConfigValidationIssue[];
    public readonly zodError: ZodError;

    /** `input` is the config that failed, when known: the value at an issue's path is then named in the message */
    constructor(zodError: ZodError, input?: unknown) {
        const issues = ConfigValidationError.formatZodIssues(zodError.issues, input);
        const message = ConfigValidationError.formatErrorMessage(issues);
        
        super(message);
        this.name = "ConfigValidationError";
        this.issues = issues;
        this.zodError = zodError;
    }

    /**
     * Convert Zod issues to user-friendly validation issues.
     */
    private static formatZodIssues(zodIssues: readonly any[], input?: unknown): ConfigValidationIssue[] {
        return zodIssues.map((issue) => {
            const pathArray = issue.path ?? [];
            const received = input === undefined ? undefined : valueAt(input, pathArray);
            const unsupported = pathArray[pathArray.length - 1] === "type" && typeof received === "string" && Object.prototype.hasOwnProperty.call(NOT_SUPPORTED_YET, received) ? NOT_SUPPORTED_YET[received] : undefined;
            if (unsupported !== undefined) {
                // an entity the generator knows of and does not support yet: say so, instead of listing what it takes
                return { path: formatPath(pathArray), message: `${JSON.stringify(received)} is not supported yet: ${unsupported}`, received };
            }
            const path = formatPath(pathArray);

            const formattedIssue: ConfigValidationIssue = {
                path,
                message: issue.message ?? "Invalid value"
            };

            // Extract expected/received info when available
            if ("expected" in issue) {
                if (Array.isArray(issue.expected)) {
                    formattedIssue.expected = `one of: ${issue.expected.join(", ")}`;
                } else {
                    formattedIssue.expected = String(issue.expected);
                }
            }
            
            if ("received" in issue) {
                formattedIssue.received = issue.received;
            }

            // Handle specific issue codes
            const code = issue.code;
            if (code === "too_small" && "minimum" in issue) {
                const op = issue.inclusive ? ">=" : ">";
                formattedIssue.expected = `value ${op} ${issue.minimum}`;
            } else if (code === "too_big" && "maximum" in issue) {
                const op = issue.inclusive ? "<=" : "<";
                formattedIssue.expected = `value ${op} ${issue.maximum}`;
            }

            return formattedIssue;
        });
    }

    /**
     * Format issues into a human-readable error message.
     */
    private static formatErrorMessage(issues: ConfigValidationIssue[]): string {
        if (issues.length === 0) {
            return "Configuration validation failed";
        }

        if (issues.length === 1) {
            const issue = issues[0];
            let msg = `Configuration validation failed at '${issue.path}': ${issue.message}`;
            if (issue.expected) {
                msg += ` (expected ${issue.expected}`;
                if (issue.received !== undefined) {
                    msg += `, received ${JSON.stringify(issue.received)}`;
                }
                msg += ")";
            }
            return msg;
        }

        const lines = [
            `Configuration validation failed with ${issues.length} errors:`
        ];

        for (const issue of issues) {
            let line = `  - ${issue.path}: ${issue.message}`;
            if (issue.expected) {
                line += ` (expected ${issue.expected}`;
                if (issue.received !== undefined) {
                    line += `, received ${JSON.stringify(issue.received)}`;
                }
                line += ")";
            }
            lines.push(line);
        }

        return lines.join("\n");
    }

    /**
     * Get a formatted string representation of all issues.
     */
    public getFormattedIssues(): string {
        return this.issues.map(issue => {
            let str = `${issue.path}: ${issue.message}`;
            if (issue.expected) {
                str += ` (expected ${issue.expected}`;
                if (issue.received !== undefined) {
                    str += `, received ${JSON.stringify(issue.received)}`;
                }
                str += ")";
            }
            return str;
        }).join("\n");
    }
}

// ============================================================================
// Inserter Coverage Validation Types
// ============================================================================

export type InserterCoverageIssueKind = 'missing_input_inserter' | 'missing_output_inserter';

export type InserterFixOption =
    | { type: 'existing_connection'; endpoint_type: 'machine' | 'belt' | 'chest'; endpoint_id: number; item_name: string }
    | { type: 'review_filters'; inserter_id: number; item_name: string }
    | { type: 'machine_to_machine'; source_machine_id: number; item_name: string }
    | { type: 'add_lane_to_existing_belt'; belt_id: number; item_name: string }
    | { type: 'new_belt'; item_name: string }
    | { type: 'infinity_chest'; item_name: string };

export interface InserterCoverageIssue {
    kind: InserterCoverageIssueKind;
    machine_id: number;
    recipe: string;
    item_name: string;
    is_fuel?: boolean;
    fix_options: InserterFixOption[];
}

export class InserterCoverageError extends Error {
    public readonly issues: InserterCoverageIssue[];

    constructor(issues: InserterCoverageIssue[]) {
        const message = InserterCoverageError.formatMessage(issues);
        super(message);
        this.name = 'InserterCoverageError';
        this.issues = issues;
    }

    private static formatMessage(issues: InserterCoverageIssue[]): string {
        const lines = [
            `Missing inserter coverage (${issues.length} issue${issues.length === 1 ? '' : 's'}):`
        ];
        for (const issue of issues) {
            const dir = issue.kind === 'missing_input_inserter' ? 'input' : 'output';
            lines.push(
                `  - Machine ${issue.machine_id} (${issue.recipe}): missing ${dir} inserter for '${issue.item_name}'`
            );
        }
        return lines.join('\n');
    }
}

// ============================================================================
// Copies Validation Types
// ============================================================================

/** The machines of one unit of a build, as found by the copies validator */
export interface CopiesUnit {
    machine_ids: number[];
}

/**
 * A config holds several identical units of a build, where it should describe one unit and set
 * `target_output.copies`.
 */
export class CopiesError extends Error {
    /** The identical copies found, each with the machine ids of its unit; one entry per copy */
    public readonly units: CopiesUnit[];
    /** The number of identical copies the config holds */
    public readonly copies_found: number;
    /** `target_output.copies` of the config as given */
    public readonly configured_copies: number;

    constructor(units: CopiesUnit[], configuredCopies: number) {
        super(CopiesError.formatMessage(units, configuredCopies));
        this.name = 'CopiesError';
        this.units = units;
        this.copies_found = units.length;
        this.configured_copies = configuredCopies;
    }

    private static formatMessage(units: CopiesUnit[], configuredCopies: number): string {
        const found = units.length;
        const size = units[0]?.machine_ids.length ?? 0;
        const listed = units
            .map((unit, i) => `copy ${i + 1}: machines ${unit.machine_ids.join(', ')}`)
            .join('; ');
        return `The config holds ${found} identical copies of a unit of ${size} machine${size === 1 ? '' : 's'} `
            + `(${listed}). Describe one copy and set target_output.copies to ${fraction(configuredCopies).multiply(found).toDecimal()} `
            + `(now ${configuredCopies}, times ${found}).`;
    }
}

// ============================================================================
// Lane Capacity Validation Types
// ============================================================================

/** Whether inserters take items off belt lanes or drop them onto them */
export type LaneFlowKind = 'take' | 'drop';

/** A set of lanes of a belt that inserters ask for more items a second than it carries */
export interface LaneCapacityIssue {
    kind: LaneFlowKind;
    belt_id: number;
    /** The lanes, by place in the belt's `lanes` (1 or 2), ascending; both for a drop onto a belt that lists one */
    lanes: number[];
    /** The inserters of one unit that take from, or drop onto, only these lanes */
    inserter_ids: number[];
    /** Items a second those inserters move at the target, in one unit */
    items_per_second: number;
    /** Items a second the lanes carry: half the belt's speed times each lane's stack size */
    capacity_per_second: number;
    /** `target_output.copies` of the config */
    copies: number;
}

/** A rate with at most two decimals, more when two decimals would show it equal to what it is compared with */
export function formatRate(value: number, against?: number): string {
    const two = Number(value.toFixed(2));
    return String(against !== undefined && two === Number(against.toFixed(2)) ? Number(value.toFixed(4)) : two);
}

const listed = (values: readonly (string | number)[]): string =>
    values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;

/** "lane 1 of belt 1" or "both lanes of belt 1" */
export function describeLanes(issue: Pick<LaneCapacityIssue, 'lanes' | 'belt_id'>): string {
    return `${issue.lanes.length === 1 ? `lane ${issue.lanes[0]}` : 'both lanes'} of belt ${issue.belt_id}`;
}

/** "Inserters 1 and 8 take 140 a second from lane 1 of belt 1, which carries 120." */
export function describeLaneOverCapacity(issue: LaneCapacityIssue): string {
    const many = issue.inserter_ids.length > 1;
    const verb = issue.kind === 'take' ? (many ? 'take' : 'takes') : (many ? 'drop' : 'drops');
    return `Inserter${many ? 's' : ''} ${listed(issue.inserter_ids)} ${verb} ${formatRate(issue.items_per_second, issue.capacity_per_second)} `
        + `a second ${issue.kind === 'take' ? 'from' : 'onto'} ${describeLanes(issue)}, which carr${issue.lanes.length === 1 ? 'ies' : 'y'} `
        + `${formatRate(issue.capacity_per_second)}.`;
}

/**
 * One unit's inserters take from, or drop onto, a belt lane more items a second than it carries, so no clock can hold
 * the target.
 */
export class LaneCapacityError extends Error {
    public readonly issues: LaneCapacityIssue[];

    constructor(issues: LaneCapacityIssue[]) {
        super(LaneCapacityError.formatMessage(issues));
        this.name = 'LaneCapacityError';
        this.issues = issues;
    }

    private static formatMessage(issues: LaneCapacityIssue[]): string {
        return `A belt lane is asked for more than it carries at the target: ${issues.map(describeLaneOverCapacity).join(' ')} `
            + "A lane carries half its belt's items a second times its stack size. Lower the target, or move inserters to "
            + 'another lane or belt.';
    }
}

// ============================================================================
// Feasibility (crafting/feasibility/): a build no clock can carry
// ============================================================================

/**
 * The rules of the feasibility pass (P3 design 3.2, 3.3): C1 a recipe's machines, C2 supply from outside, C3 the target
 * taken out, C4 one inserter's swings, C5 a belt lane, C6 an export belt, C7 the target destroyed; S1 a result with no
 * way out, S2 a shared hand at a placer's target, S3 a loop that uses up all it makes
 */
export type FeasibilityRule = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'S1' | 'S2' | 'S3';

/** Inserters as a text names them: the most they move of an item a second together, and their hand and swing where alike */
export interface FeasibilityCarriers {
    inserters: number[];
    per_second: number;
    /** The hand of every one of them, where they have the same; else null */
    hand: number | null;
    /** The fewest ticks a swing of every one of them takes, where they take the same; else null */
    ticks: number | null;
}

/** A side of a belt, as the config numbers it */
export interface FeasibilityLane {
    belt: number;
    lane: number;
}

/** A belt that carries less than the inserters dropping onto it can put there: the ceilings of its two sides */
export interface FeasibilityBeltCap {
    belt: number;
    per_second: number;
}

/** "machine", "drill": what a producer is called */
export type FeasibilityProducerKind = 'machine' | 'drill';

/** What holds a recipe's machines back (C1): their speed, what their inserters bring in, or what they take out */
export type FeasibilityLimit =
    | { kind: 'crafts'; machines: number[]; crafts_per_second: number }
    | { kind: 'input' | 'output'; machines: number[]; item: string; carriers: FeasibilityCarriers; per_craft: number; crafts_per_second: number };

/** Where a supply comes from (C2): a lane from outside, or a recipe's machines */
export type FeasibilitySource =
    | { kind: 'lane'; lane: FeasibilityLane; per_second: number }
    | { kind: 'producers'; producer: FeasibilityProducerKind; ids: number[]; recipe: string; per_second: number };

/** Who must take an item (C2, C5): the target, an export belt, or a recipe's machines */
export type FeasibilityTaker =
    | { kind: 'target' }
    | { kind: 'export'; belt: number }
    | { kind: 'producers'; producer: FeasibilityProducerKind; ids: number[] };

/** Every figure and name a refusal shows, by rule; item and recipe names are the game's, in a sentence */
export type FeasibilityTerms =
    | {
        rule: 'C1'; producer: FeasibilityProducerKind; ids: number[]; recipe: string; crafts_per_second: number; limits: FeasibilityLimit[];
        need_crafts_per_second: number;
        /** Why the target needs so many crafts: so much of an item a second at so much a craft */
        need: { item: string; per_second: number; per_craft: number; how: 'made' | 'loop' | 'destroyed' };
    }
    | { rule: 'C2'; item: string; sources: FeasibilitySource[]; takers: FeasibilityTaker[]; supply_per_second: number; need_per_second: number }
    | { rule: 'C3'; item: string; carriers: FeasibilityCarriers; capped: FeasibilityBeltCap[]; per_second: number; target_per_second: number; copies: number }
    | {
        rule: 'C4'; inserter: number;
        /** Every item it carries */
        carries: string[];
        /** The items that take a share of its swings: those it must carry and whose fewest ticks a swing are known */
        items: { item: string; at_least_per_second: number; hand: number; ticks: number; share: number }[];
        share: number;
    }
    | {
        rule: 'C5'; belt: number;
        /** The side of the belt, where the cut is one side; null where it is the belt (the build drops the item onto it too) */
        lane: number | null;
        item: string; fillers: FeasibilityCarriers | null; per_second: number; takers: number[]; need_per_second: number;
    }
    | { rule: 'C6'; belt: number; item: string; carriers: FeasibilityCarriers; capped: FeasibilityBeltCap[]; per_second: number; consumed_per_second: number }
    | {
        rule: 'C7'; item: string; target_per_second: number; copies: number; per_second: number;
        /** The machines that destroy it, or the inserters that bring it in from outside */
        by: {
            kind: 'machines'; ids: number[]; recipe: string; crafts_per_second: number;
            /** What a craft uses and gives back, where every machine's craft uses and gives back the same; else null */
            uses: number | null; gives_back: number | null;
        }
            | { kind: 'inserters'; carriers: FeasibilityCarriers };
    }
    | {
        rule: 'S1'; machine: number; item: string;
        /** Where it is trapped: a container (its input slots or not), or the machine's own output */
        into: { container: number; input_slots: boolean; inserters: number[] } | null;
        /**
         * Where inserters move it on from there: the containers it stops in (their input slots or not), or, where they move
         * it round between containers (`loop`), every container they reach; null where it stops where it is first put
         */
        then: { inserters: number[]; ends: { container: number; input_slots: boolean }[]; loop: boolean } | null;
        /** The rest of the recipe's machines, where it has more: what they craft at most, against the target's need */
        others: { ids: number[]; crafts_per_second: number; need_crafts_per_second: number } | null;
    }
    | { rule: 'S2'; inserter: number; items: string[]; target: SharedHandTarget }
    | { rule: 'S3'; producer: FeasibilityProducerKind; ids: number[]; rows: { item: string; gives: number; takes: number }[] };

/** One cut a build cannot carry, or one trap it falls into */
export interface FeasibilityIssue {
    rule: FeasibilityRule;
    /** The graph's nodes and ports it names */
    nodes: string[];
    /** The graph's edges it names */
    edges: string[];
    /** What the cut must carry a second (crafts for C1, swings shared for C4); null for a trap */
    need: number | null;
    /** The most it carries a second; null for a trap */
    capacity: number | null;
    terms: FeasibilityTerms;
}

/** Where a placer places its results: a chest (a rocket silo's too) or a machine */
export interface SharedHandTarget {
    type: 'chest' | 'machine';
    number: number;
}

/**
 * The text of an inserter that takes several of a placer's results out of its target (sharedHandRefusal): `items` are
 * the game's names, as a sentence has them
 */
export function sharedHandText(inserter: number, items: readonly string[], target: SharedHandTarget): string {
    const where = `${target.type} ${target.number}`;
    return `Inserter ${inserter} takes ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]} out of ${where}. `
        + "An inserter that holds part of a hand of one of them takes only more of that one, so the others pile up in "
        + `${where}, and once it is full the one it waits for cannot come in: the build stops for good. Give each result an `
        + "inserter of its own. An inserter whose filters the clock sets by signal would not wait; such a clock is not planned yet.";
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const named = (noun: string, ids: readonly number[]): string => `${noun}${ids.length === 1 ? '' : 's'} ${listed(ids)}`;
const producersNamed = (kind: FeasibilityProducerKind, ids: readonly number[]): string => named(kind, ids);
const laneNamed = (lane: FeasibilityLane): string => `lane ${lane.lane} of belt ${lane.belt}`;
const verb = (ids: readonly unknown[], one: string, many: string): string => ids.length === 1 ? one : many;

/** "4 hands of 15 every 8 ticks", where the inserters have one hand and one swing */
function handsOf(carriers: FeasibilityCarriers): string | null {
    if (carriers.hand === null || carriers.ticks === null) return null;
    const count = carriers.inserters.length;
    return `${count} hand${count === 1 ? '' : 's'} of ${carriers.hand} every ${carriers.ticks} ticks`;
}

const withHands = (carriers: FeasibilityCarriers): string => {
    const hands = handsOf(carriers);
    return hands === null ? '' : ` (${hands})`;
};

function takerNamed(taker: FeasibilityTaker): string {
    if (taker.kind === 'target') return 'the target';
    if (taker.kind === 'export') return `the consumers of belt ${taker.belt}`;
    return producersNamed(taker.producer, taker.ids);
}

/** Where S1's item is put: a chest, or a rocket silo's input slots (the only container with input slots) */
const portNamed = (port: { container: number; input_slots: boolean }): string =>
    port.input_slots ? `the input slots of rocket silo ${port.container}` : `chest ${port.container}`;

function portsNamed(ports: readonly { container: number; input_slots: boolean }[]): string {
    const chests = ports.filter(port => !port.input_slots).map(port => port.container);
    return listed([...chests.length === 0 ? [] : [named('chest', chests)], ...ports.filter(port => port.input_slots).map(portNamed)]);
}

/** A target's figure: for one copy, as the message's opening says where the build has several */
const targetText = (per_second: number, against: number): string => `${formatRate(per_second, against)} a second`;

function limitText(limit: FeasibilityLimit): string {
    const machines = named('machine', limit.machines);
    if (limit.kind === 'crafts') {
        return `${machines} craft${verb(limit.machines, 's', '')} at most ${formatRate(limit.crafts_per_second)} a second`;
    }
    const inserters = named('inserter', limit.carriers.inserters);
    const move = limit.kind === 'input'
        ? `${verb(limit.carriers.inserters, 'brings', 'bring')} at most ${formatRate(limit.carriers.per_second)} a second of ${limit.item} into ${machines}`
        : `${verb(limit.carriers.inserters, 'takes', 'take')} at most ${formatRate(limit.carriers.per_second)} a second of ${limit.item} out of ${machines}`;
    return `${inserters} ${move}${withHands(limit.carriers)}, and a craft ${limit.kind === 'input' ? 'takes' : 'makes'} ${formatRate(limit.per_craft)}`;
}

/** The text of one issue, as a player reads it */
export function describeFeasibilityIssue(issue: FeasibilityIssue): string {
    const terms = issue.terms;
    switch (terms.rule) {
        case 'C1': {
            const who = capitalized(producersNamed(terms.producer, terms.ids));
            const how = terms.need.how === 'destroyed' ? `destroying ${formatRate(terms.need.per_second)} a second of ${terms.need.item} at ${formatRate(terms.need.per_craft)} a craft`
                : `${formatRate(terms.need.per_second)} a second of ${terms.need.item} at ${formatRate(terms.need.per_craft)} a craft`
                    + (terms.need.how === 'loop' ? ', some of which goes back into the loop' : '');
            const advice = terms.limits.some(limit => limit.kind !== 'crafts') ? 'give them more inserters or bigger hands' : `add ${terms.producer}s or make them faster`;
            const most = formatRate(terms.crafts_per_second, terms.need_crafts_per_second);
            const can = terms.limits.length === 1 && terms.limits[0].kind === 'crafts'
                ? `${who} (${terms.recipe}) craft${verb(terms.ids, 's', '')} at most ${most} a second${terms.ids.length === 1 ? '' : ' together'}`
                : `${who} (${terms.recipe}) can make at most ${most} crafts a second: ${terms.limits.map(limitText).join('; ')}`;
            return `${can}. The target needs ${formatRate(terms.need_crafts_per_second, terms.crafts_per_second)} crafts a second of `
                + `${terms.ids.length === 1 ? 'it' : 'them'} (${how}). Lower the target, or ${advice}.`;
        }
        case 'C2': {
            const sources = terms.sources.map(source => source.kind === 'lane'
                ? `${laneNamed(source.lane)} brings at most ${formatRate(source.per_second)} a second from outside the build`
                : `${producersNamed(source.producer, source.ids)} (${source.recipe}) make${verb(source.ids, 's', '')} at most ${formatRate(source.per_second)} a second`);
            return `At most ${formatRate(terms.supply_per_second, terms.need_per_second)} a second of ${terms.item} reaches the machines that need it `
                + `(${sources.join('; ')}), and ${listed(terms.takers.map(takerNamed))} must take ${formatRate(terms.need_per_second, terms.supply_per_second)} `
                + `a second of it. Lower the target, or bring in more ${terms.item}.`;
        }
        case 'C3': {
            const capped = terms.capped.map(cap => `belt ${cap.belt} carries at most ${formatRate(cap.per_second)} a second`);
            return `${capitalized(named('inserter', terms.carriers.inserters))} can take at most ${formatRate(terms.per_second, terms.target_per_second)} `
                + `a second of ${terms.item} out of the build${withHands(terms.carriers)}${capped.length === 0 ? '' : `, and ${capped.join(' and ')}`}, `
                + `and the target is ${targetText(terms.target_per_second, terms.per_second)}. Lower the target, or give the output `
                + 'more inserters or bigger hands.';
        }
        case 'C4': {
            const parts = terms.items.map(item => `at least ${formatRate(item.at_least_per_second)} a second of ${item.item}, in hands of `
                + `${item.hand} at ${item.ticks} ticks a swing, takes ${formatRate(item.share)} of its swings`);
            return `Inserter ${terms.inserter} carries ${listed(terms.carries)}, one item a swing: ${parts.join(', and ')}; `
                + `${formatRate(terms.share, 1)} of its swings in all, more than it has. Lower the target, or give each item an inserter of its own.`;
        }
        case 'C5': {
            const fill = terms.fillers === null ? '' : `, as ${named('inserter', terms.fillers.inserters)} put${verb(terms.fillers.inserters, 's', '')} `
                + `at most ${formatRate(terms.fillers.per_second)} a second onto it${withHands(terms.fillers)}`;
            const where = terms.lane === null ? `belt ${terms.belt}` : laneNamed({ belt: terms.belt, lane: terms.lane });
            return `${capitalized(where)} carries at most ${formatRate(terms.per_second, terms.need_per_second)} a second of ${terms.item}${fill}, `
                + `and ${named('inserter', terms.takers)} must take ${formatRate(terms.need_per_second, terms.per_second)} a second off it. `
                + 'Lower the target, or take the item from more lanes.';
        }
        case 'C6': {
            const capped = terms.capped.map(cap => `belt ${cap.belt} carries at most ${formatRate(cap.per_second)} a second`);
            return `${capitalized(named('inserter', terms.carriers.inserters))} can put at most ${formatRate(terms.per_second, terms.consumed_per_second)} `
                + `a second of ${terms.item} onto belt ${terms.belt}${withHands(terms.carriers)}${capped.length === 0 ? '' : `, and ${capped.join(' and ')}`}, `
                + `and the consumers outside the build take ${formatRate(terms.consumed_per_second, terms.per_second)} a second off it. `
                + "Lower the belt's consumption, or give it more inserters.";
        }
        case 'C7': {
            const target = targetText(terms.target_per_second, terms.per_second);
            if (terms.by.kind === 'inserters') {
                return `${capitalized(named('inserter', terms.by.carriers.inserters))} can bring at most ${formatRate(terms.per_second, terms.target_per_second)} `
                    + `a second of ${terms.item} into the build${withHands(terms.by.carriers)}, and the target is ${target}. Lower the target, or give `
                    + 'the machines more inserters or bigger hands.';
            }
            const by = terms.by;
            const back = by.gives_back === null || by.gives_back === 0 ? '' : ` and gives back ${formatRate(by.gives_back)}`;
            const none = by.uses !== null && by.gives_back !== null && by.gives_back >= by.uses ? ', so it destroys none' : '';
            const craft = by.uses === null ? '' : `, and a craft uses ${formatRate(by.uses)}${back}${none}`;
            return `${capitalized(named('machine', by.ids))} (${by.recipe}) can destroy at most ${formatRate(terms.per_second, terms.target_per_second)} `
                + `a second of ${terms.item}: ${verb(by.ids, 'it crafts', 'they craft')} at most ${formatRate(by.crafts_per_second)} a second`
                + `${craft}. The target is ${target}. Lower the target, or add machines or make them faster.`;
        }
        case 'S1': {
            const others = terms.others === null ? '' : ` The other ${named('machine', terms.others.ids)} of the recipe craft${verb(terms.others.ids, 's', '')} `
                + `at most ${formatRate(terms.others.crafts_per_second, terms.others.need_crafts_per_second)} a second, and the target needs `
                + `${formatRate(terms.others.need_crafts_per_second, terms.others.crafts_per_second)}.`;
            if (terms.into === null) {
                return `Machine ${terms.machine} makes ${terms.item}, and nothing takes it out: once its output is full, the machine stops for good.${others}`;
            }
            const how = terms.into.inserters.length === 0 ? `Machine ${terms.machine} places ${terms.item} into ${portNamed(terms.into)}`
                : `${capitalized(named('inserter', terms.into.inserters))} put${verb(terms.into.inserters, 's', '')} ${terms.item} from machine ${terms.machine} `
                    + `into ${portNamed(terms.into)}`;
            const then = terms.then;
            if (then === null) {
                return `${how}, and nothing takes it out: once ${terms.into.input_slots ? 'they are' : 'the chest is'} full, the machine stops for good.${others}`;
            }
            const movers = `${named('inserter', then.inserters)} move${verb(then.inserters, 's', '')} it`;
            if (then.loop) {
                return `${how}, ${movers} round between ${portsNamed(then.ends)}, and nothing else takes it out: once they are full, the machine stops `
                    + `for good.${others}`;
            }
            const one = then.ends.length === 1 && !then.ends[0].input_slots;
            return `${how}, ${movers} on into ${portsNamed(then.ends)}, and nothing takes it out of ${one ? 'there' : 'them'}: once `
                + `${one ? `chest ${then.ends[0].container} is` : 'they are'} full, the machine stops for good.${others}`;
        }
        case 'S2':
            return sharedHandText(terms.inserter, terms.items, terms.target);
        case 'S3': {
            const all = terms.rows.every(row => row.gives === row.takes);
            const rows = terms.rows.map(row => `${terms.rows.length === 1 ? '' : `${row.item}: `}a craft gives ${formatRate(row.gives)} and takes ${formatRate(row.takes)}`);
            const what = terms.rows.length === 1
                ? (all ? `all the ${terms.rows[0].item} they make` : `more ${terms.rows[0].item} than they make`)
                : `${all ? 'all' : 'more than'} they make of ${listed(terms.rows.map(row => row.item))} in a loop`;
            const who = capitalized(producersNamed(terms.producer, terms.ids));
            return `${who} use${verb(terms.ids, 's', '')} up ${what} (${rows.join('; ')}): no amount of crafting meets the target.`;
        }
    }
}

/**
 * No clock can carry the build's target: a cut of it carries less than the target asks of it, or it falls into a trap
 * that stops it for good. Thrown before any simulation (crafting/feasibility/assert-feasible.ts).
 */
export class FeasibilityError extends Error {
    public readonly issues: FeasibilityIssue[];

    /** `target` is the config's, in all: where it is shared by copies, the message says its figures are for one copy */
    constructor(issues: FeasibilityIssue[], target: { items_per_second: number; copies: number } | null = null) {
        super(FeasibilityError.formatMessage(issues, target));
        this.name = 'FeasibilityError';
        this.issues = issues;
    }

    private static formatMessage(issues: FeasibilityIssue[], target: { items_per_second: number; copies: number } | null): string {
        // copies as configured: a short decimal (copies-value.ts), never rounded the way a rate is
        const copies = target === null || target.copies === 1 ? ''
            : ` of ${formatRate(target.items_per_second)} a second over ${target.copies} copies (every figure here is for one copy)`;
        return `No clock can hold this build's target${copies}: ${issues.map(describeFeasibilityIssue).join(' ')}`;
    }
}
