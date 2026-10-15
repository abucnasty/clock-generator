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
    "car": "a car as a chest comes with roadmap milestone M2 (containers)",
    "tank": "a tank as a chest comes with roadmap milestone M2 (containers)",
    "cargo-wagon": "a cargo wagon as a chest comes with roadmap milestone M2 (containers); a wagon on a moving train is follow-up F5",
    "rocket-silo": "a rocket silo as a chest, or as the machine crafting rocket parts, comes with roadmap milestone M2 (containers)",
    "recycler": "recyclers come with roadmap milestone M3 (recyclers and quality tiers)",
    "lab": "labs are not modelled: they consume no recipe",
};

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
    | { type: 'machine_to_machine'; source_machine_id: number; item_name: string }
    | { type: 'add_lane_to_existing_belt'; belt_id: number; item_name: string }
    | { type: 'new_belt'; item_name: string }
    | { type: 'infinity_chest'; item_name: string };

export interface InserterCoverageIssue {
    kind: InserterCoverageIssueKind;
    machine_id: number;
    recipe: string;
    item_name: string;
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
