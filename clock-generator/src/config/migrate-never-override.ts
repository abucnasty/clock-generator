/** The former mode of an enable control override that held an entity off; the mode no longer exists (maintainer glossary, Enable Control Strategy override) */
const FORMER_MODE = "NEVER";

/**
 * Read the former `NEVER` mode of an enable control override once: an override `{ mode: "NEVER" }` loads as `{ mode: "AUTO" }`, so the
 * generator chooses the entity's control. Any other value is left as it is. The schema runs this step on every enable control override
 * of an inserter and a drill.
 */
export function readNeverOverrideAsAuto(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || (value as Record<string, unknown>).mode !== FORMER_MODE) {
        return value;
    }
    return { mode: "AUTO" };
}

/** An inserter or a drill whose override was Never on */
export interface NeverOverrideEntity {
    type: "inserter" | "drill";
    id: number;
}

function isNever(entry: unknown): boolean {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("overrides" in entry)) return false;
    const overrides = (entry as Record<string, unknown>).overrides;
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides) || !("enable_control" in overrides)) return false;
    const control = (overrides as Record<string, unknown>).enable_control;
    return readNeverOverrideAsAuto(control) !== control;
}

function readInEntries(entries: unknown): unknown {
    if (!Array.isArray(entries)) return entries;
    return entries.map(entry => !isNever(entry) ? entry : {
        ...(entry as Record<string, unknown>),
        overrides: { ...((entry as Record<string, unknown>).overrides as Record<string, unknown>), enable_control: { mode: "AUTO" } },
    });
}

function drillConfigsOf(config: Record<string, unknown>): unknown {
    const drills = config.drills;
    return typeof drills === "object" && drills !== null && !Array.isArray(drills) ? (drills as Record<string, unknown>).configs : undefined;
}

/**
 * The same step for a whole config that is not yet checked against the schema (a saved form, an imported file, a share link): it reads the
 * former mode in the `overrides.enable_control` of each inserter and each drill. The UI uses it for the files and forms it reads itself.
 */
export function readNeverOverridesInConfig(config: unknown): unknown {
    if (typeof config !== "object" || config === null || Array.isArray(config)) return config;
    const record = config as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };
    if ("inserters" in record) result.inserters = readInEntries(record.inserters);
    const configs = drillConfigsOf(record);
    if (Array.isArray(configs)) {
        result.drills = { ...(record.drills as Record<string, unknown>), configs: readInEntries(configs) };
    }
    return result;
}

/**
 * The inserters and drills of a config that is not yet checked whose override is the former Never on, in the order the config lists them
 * (inserters first). An inserter with no `id` has its place in the list as its id, as the generator numbers it. The site tells the user
 * which of them now use Auto.
 */
export function neverOverrideEntitiesOf(config: unknown): NeverOverrideEntity[] {
    if (typeof config !== "object" || config === null || Array.isArray(config)) return [];
    const record = config as Record<string, unknown>;
    const idOf = (entry: unknown, index: number): number => {
        const id = (entry as Record<string, unknown>).id;
        return typeof id === "number" ? id : index + 1;
    };
    const found = (type: NeverOverrideEntity["type"], entries: unknown): NeverOverrideEntity[] => Array.isArray(entries)
        ? entries.flatMap((entry, index) => isNever(entry) ? [{ type, id: idOf(entry, index) }] : [])
        : [];
    return [...found("inserter", record.inserters), ...found("drill", drillConfigsOf(record))];
}
