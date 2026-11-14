/**
 * A comparator from keys, in order, as Kotlin's `compareBy`: the first key that differs decides, the smaller value first; 0
 * when every key is equal. The values are compared, never subtracted, as two keys can both be Infinity.
 */
export function compareBy<T>(...keys: ((value: T) => number)[]): (a: T, b: T) => number {
    return (a, b) => {
        for (const key of keys) {
            const [ka, kb] = [key(a), key(b)];
            if (ka !== kb) return ka < kb ? -1 : 1;
        }
        return 0;
    };
}
