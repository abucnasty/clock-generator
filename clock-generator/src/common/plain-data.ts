// Only Node can distinguish a Proxy without triggering its traps.
export const isProxy = typeof process === "undefined" ? undefined : process.getBuiltinModule?.("node:util")?.types.isProxy;

/** Checks a bounded tree of ordinary data without invoking accessors or iterators. Shared references also fall through. */
export function isPlainData(value: unknown, budget = 2_000_000): boolean {
    const checked = new WeakSet<object>();
    let remaining = budget;
    const inspect = (value: unknown, depth: number): boolean => {
        if (--remaining < 0) return false;
        if (value === null || typeof value === "undefined" || typeof value === "boolean") return true;
        if (typeof value === "string") {
            remaining -= value.length;
            return remaining >= 0;
        }
        if (typeof value === "number") return Number.isFinite(value);
        if (typeof value !== "object" || depth >= 64 || isProxy === undefined || isProxy(value) || checked.has(value)) return false;
        checked.add(value);
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
        const keys = Reflect.ownKeys(value);
        if (keys.length > remaining || (array && keys.length !== value.length + 1)) return false;
        return keys.every((key, index) => {
            if (array && index === value.length) return key === "length";
            if (typeof key !== "string" || (array && key !== String(index))) return false;
            remaining -= key.length;
            const field = Object.getOwnPropertyDescriptor(value, key)!;
            return field.enumerable && "value" in field && inspect(field.value, depth + 1);
        });
    };
    return inspect(value, 0);
}
