/** Object member order is not part of a config or a clock. Array order (including entity update order) is. */
export function canonicalVerificationJson(value: unknown): string {
    return JSON.stringify(value, (_key, entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}
