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
    "recycler": "recyclers come with roadmap milestone M3 (recyclers and quality tiers)",
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
