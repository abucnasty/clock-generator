/**
 * The format of a configuration: the root key `format`, written first by every writer of a configuration (the site's
 * saved builds, build files and share links, and the files of the repository). The engine does not read it: the schema
 * does not declare it, so a parsed configuration carries none. It is tested at the doors only, before the schema: the
 * command line's file reader (`loadConfigFromFile`) and the site's opened files, share links and saved builds. A
 * configuration without it was made before the format had a number and is no longer read. A later breaking change to
 * the configuration raises the number.
 */
export const CONFIG_FORMAT = 1;

/** Why a configuration is not read: made before this format (`old`), or by a newer version (`newer`) */
export type ConfigFormatProblem = "old" | "newer";

/** Null when `value` is a configuration of this format; else why it is not read. Only a whole number counts. */
export function configFormatProblem(value: unknown): ConfigFormatProblem | null {
    const format = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>).format : undefined;
    if (typeof format !== "number" || !Number.isInteger(format) || format < CONFIG_FORMAT) {
        return "old";
    }
    return format === CONFIG_FORMAT ? null : "newer";
}

/** `config` with `format` as its first key, as the writers save it */
export function withConfigFormat<T extends object>(config: T): T & { format: typeof CONFIG_FORMAT } {
    const { format: _format, ...rest } = config as T & { format?: unknown };
    return { format: CONFIG_FORMAT, ...rest } as T & { format: typeof CONFIG_FORMAT };
}

/** The one line the command line gives for a configuration it does not read */
export function configFormatMessage(problem: ConfigFormatProblem): string {
    return problem === "old"
        ? "This configuration was made by a version of the clock generator before 0.33.0 and is no longer supported: "
            + "copy the build as a blueprint in Factorio and paste it on the site to make it again."
        : "This configuration was made by a newer version of the clock generator: update the clock generator to open it.";
}

/** A configuration file refused at the door for its format */
export class ConfigFormatError extends Error {
    constructor(readonly problem: ConfigFormatProblem, file?: string) {
        super(file === undefined ? configFormatMessage(problem) : `${file}: ${configFormatMessage(problem)}`);
        this.name = "ConfigFormatError";
    }
}
