import { afterEach, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { generateClockAlternatives } from "../alternatives";
import { quiet } from "../generate-blueprint-test-helpers";
import { planRun } from "../plan/plan-run";
import { expandStateTransitionHistory, toPortable } from "./compact-history";
import { RecordedBothWays, historyDifference, recordBothWays } from "./legacy-state-transition-history.fixture";

// the smaller builds: state-transition-history.test.ts

let restore: (() => void) | undefined;
afterEach(() => {
    restore?.();
    restore = undefined;
});

/** Each history sealed while `run` runs, read back against what the object-per-transition history serialized to */
function differencesWhile(run: () => void): { sealed: number; transitions: number; differences: string[] } {
    const found = { sealed: 0, transitions: 0, differences: [] as string[] };
    const check = ({ sealed, legacy }: RecordedBothWays) => {
        found.sealed++;
        found.transitions += sealed.entities.reduce((sum, entity) => sum + entity.columns.tick.length, 0);
        for (const read of [expandStateTransitionHistory(sealed), expandStateTransitionHistory(structuredClone(toPortable(sealed)))]) {
            const difference = historyDifference(legacy, read);
            if (difference !== null) found.differences.push(difference);
        }
    };
    restore = recordBothWays(check).restore;
    run();
    return found;
}

describe("a run's sealed state transition history, read back", () => {
    it.each([
        ["a burner machine with fuel inserters", ConfigPaths.BIOCHAMBER_FUEL],
        ["a loop of machines", ConfigPaths.IRON_BACTERIA_CULTIVATION],
        ["a recycler with chances", ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER],
    ])("equals what was serialized before, for every run of the generation of %s", async (_, path) => {
        const config = await loadConfigFromFile(path);
        const found = differencesWhile(() => generateClockAlternatives(config, { logger: quiet }));
        expect(found.sealed).toBeGreaterThan(0);
        expect(found.differences).toEqual([]);
    });

    it("equals what was serialized before for the planning run of processing units with a belt export, the largest histories", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        const found = differencesWhile(() => planRun(config, { logger: quiet }));
        expect(found.sealed).toBe(1);
        expect(found.transitions).toBeGreaterThan(100_000);
        expect(found.differences).toEqual([]);
    });
});
