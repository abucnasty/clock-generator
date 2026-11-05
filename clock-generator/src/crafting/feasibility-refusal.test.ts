import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { FeasibilityError } from "../config/errors";
import { quiet } from "./generate-blueprint-test-helpers";

describe("why a build is refused", () => {
    // a hand of 2 every 8 ticks takes at most 15 packs a second out of a copy (the simulator's inserter, free-running, moves
    // exactly that), under the 21.82 a copy of the target: the feasibility pass refuses it before any clock is tried
    it("is not reached where the inserters' hands are too small for the target: the build is refused before any clock", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        const config = { ...sample, inserters: sample.inserters.map(inserter => ({ ...inserter, stack_size: 2 })) };
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow(FeasibilityError);
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow("Inserter 2 can take at most 15 a second of logistic science "
            + "pack out of the build (1 hand of 2 every 8 ticks), and the target is 21.82 a second.");
    });
});
