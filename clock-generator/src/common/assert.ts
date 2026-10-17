/**
 * Browser-compatible assertion utility.
 * A simple assertion function that works in both Node.js and browser environments.
 */

export class AssertionError extends Error {
    constructor(message?: string) {
        super(message ?? 'Assertion failed');
        this.name = 'AssertionError';
    }
}

/**
 * Assert that a condition is truthy.
 * @param condition - The condition to check
 * @param message - Optional error message
 */
function assert(condition: unknown, message?: string): asserts condition {
    if (!condition) {
        throw new AssertionError(message);
    }
}

/**
 * Assert strict equality using ===
 */
assert.strictEqual = <T>(actual: T, expected: T, message?: string): void => {
    if (actual !== expected) {
        throw new AssertionError(
            message ?? `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
        );
    }
};

/**
 * Assert that a value is truthy
 */
assert.ok = (value: unknown, message?: string): void => {
    if (!value) {
        throw new AssertionError(message ?? `Expected truthy value but got ${value}`);
    }
};

/**
 * Always fail with a message
 */
assert.fail = (message?: string): never => {
    throw new AssertionError(message ?? 'Assertion failed');
};

export default assert;
