import { afterEach, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { generateClockAlternatives } from "../alternatives";
import { quiet } from "../generate-blueprint-test-helpers";
import { runBuild } from "../plan/plan-run";
import { expandStateTransitionHistory, toPortable } from "./compact-history";
import { RecordedBothWays, historyDifference, recordBothWays } from "./legacy-state-transition-history.fixture";

let restore: (() => void) | undefined;
afterEach(() => {
    restore?.();
    restore = undefined;
});

// A burner with fuel inserters, a loop, a recycler with chances and the planning run of processing units with a belt export were
// generation tests of this comparison. Recorded here, the five generations below and the two builds show every entity type, every
// status pair, every game state, every inserter source and sink kind and every label shape those four showed; the growth of
// columns past many resizes is in transition-columns.test.ts.

/** Every history sealed while `run` runs, beside what the object-per-transition history serialized to */
function recordedBothWays(run: () => void): RecordedBothWays[] {
    const recorded: RecordedBothWays[] = [];
    restore = recordBothWays(it => recorded.push(it)).restore;
    run();
    restore();
    restore = undefined;
    return recorded;
}

/** The sealed histories read back, through the portable form too, against what was serialized before */
function expectReadBackAsBefore(recorded: RecordedBothWays[]) {
    expect(recorded.length).toBeGreaterThan(0);
    for (const { sealed, legacy } of recorded) {
        expect(historyDifference(legacy, expandStateTransitionHistory(sealed))).toBeNull();
        expect(historyDifference(legacy, expandStateTransitionHistory(structuredClone(toPortable(sealed))))).toBeNull();
    }
}

/** Every entity of every history read back so far, for the cases they have to include */
const read_back: ReturnType<typeof expandStateTransitionHistory>["entities"] = [];

describe("a run's sealed state transition history, read back", () => {
    it.each([
        ["a belt-fed build", ConfigPaths.AUTOMATION_SCIENCE, false],
        ["a machine chain", ConfigPaths.LOGISTIC_SCIENCE, false],
        ["drills", ConfigPaths.REAL_OWNER_GRENADE, false],
        ["drills into a furnace", ConfigPaths.STONE_BRICKS_DIRECT_INSERT, false],
        ["an inserter that does not move in some runs", ConfigPaths.UTILITY_SCIENCE, true],
    ])("equals what was serialized before, for every run of the generation of %s", async (_, path, backed_up_belts) => {
        const config = await loadConfigFromFile(path);
        const recorded = recordedBothWays(() => generateClockAlternatives(
            backed_up_belts ? { ...config, overrides: { ...config.overrides, backed_up_belts } } : config, { logger: quiet }));
        expectReadBackAsBefore(recorded);
        read_back.push(...recorded.flatMap(({ sealed }) => expandStateTransitionHistory(sealed).entities));
    });

    it("equals what was serialized before over two periods, and without the game's states", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE);
        const recorded = recordedBothWays(() => {
            runBuild(config, { logger: quiet, simulate_periods: 2 });
            runBuild(config, { logger: quiet, factorio_states: false });
        });
        expect(recorded).toHaveLength(2);
        expectReadBackAsBefore(recorded);
        expect(expandStateTransitionHistory(recorded[1].sealed).entities.every(it => it.factorio_states.length === 0)).toBe(true);
    });

    // (a state machine makes one transition a tick: two in one tick are read in compact-history.test.ts)
    it("has read back an entity with the game's states only, its status unknown, and drills", () => {
        expect(read_back.some(it => it.initial_status === "UNKNOWN" && it.transitions.length === 0 && it.factorio_states.length > 0)).toBe(true);
        expect(read_back.some(it => it.entity_type === "drill" && it.transitions.length > 0)).toBe(true);
    });
});
