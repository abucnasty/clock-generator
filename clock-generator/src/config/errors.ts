import { ZodError } from "zod";

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
 * Custom error class for configuration validation failures.
 * Wraps Zod errors with user-friendly field-level messages.
 */
export class ConfigValidationError extends Error {
    public readonly issues: ConfigValidationIssue[];
    public readonly zodError: ZodError;

    constructor(zodError: ZodError) {
        const issues = ConfigValidationError.formatZodIssues(zodError.issues);
        const message = ConfigValidationError.formatErrorMessage(issues);
        
        super(message);
        this.name = "ConfigValidationError";
        this.issues = issues;
        this.zodError = zodError;
    }

    /**
     * Convert Zod issues to user-friendly validation issues.
     */
    private static formatZodIssues(zodIssues: readonly any[]): ConfigValidationIssue[] {
        return zodIssues.map((issue) => {
            const pathArray = issue.path ?? [];
            const path = pathArray.length > 0
                ? pathArray.map((p: string | number, i: number) => 
                    typeof p === "number" ? `[${p}]` : (i === 0 ? String(p) : `.${String(p)}`)
                  ).join("")
                : "(root)";

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
