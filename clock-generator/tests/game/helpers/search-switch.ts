import {SEARCH_FROM_EVERY_START_VARIABLE} from "../../../src/crafting/candidates/coordinated-sources";

/**
 * Runs `generate` with the search from every stable clock (CLOCK_SEARCH_FROM_EVERY_START, off by default) on or off, and puts the
 * environment back as it was. The generation is synchronous, so nothing else reads the variable meanwhile.
 */
export function withSearchFromEveryStart<T>(on: boolean, generate: () => T): T {
    const before = process.env[SEARCH_FROM_EVERY_START_VARIABLE];
    if (on) process.env[SEARCH_FROM_EVERY_START_VARIABLE] = "1";
    else delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
    try {
        return generate();
    } finally {
        if (before === undefined) delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
        else process.env[SEARCH_FROM_EVERY_START_VARIABLE] = before;
    }
}
