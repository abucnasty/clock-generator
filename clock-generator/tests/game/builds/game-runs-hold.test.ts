import {describe, expect, test} from "vitest";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {readControls, RunControls, runHolds} from "./clock-controls";
import {expectRunIsConsistent} from "../helpers/fixture-mechanics";
import {electromagneticDrainedEndClockCases} from "./electromagnetic-science-330-drained-end-clock-fixtures";
import {inserterCraftingClockCases} from "./inserter-crafting-240-shared-signal-clock-fixtures";
import {lithiumSiloCases} from "./lithium-plate-80-silo-chest-clock-fixtures";
import {logisticDirectInsertClockCases} from "./logistic-science-240-direct-insert-clock-fixtures";
import {grenadeClockCases} from "./grenade-clock-fixtures";

/**
 * The game's run of each recorded clock, read from the controls files with no generation (these were checks of the generation tests of the
 * builds, which have no result of their own to look at): the run under the protocol holds the target over its baseline and is back at it after
 * each loss, except for the entries that are a known limit. That a pin is the record's selection, and that a stable alternative's run holds, is
 * checked against the record by clock-controls.test.ts.
 */
const holds = (file: string, name: string) => {
    const {native} = readControls<RunControls>(file).cases[name];
    expect(runHolds(native), native.result).toBe(true);
};

describe("the game's run of the recorded clock holds the target and recovers", () => {
    test.each([
        ["productivity-module-80-chest-chain-clock-controls.json", "generated-one-copy"],
        ["utility-science-480-lds-foundry-chain-clock-controls.json", "generated-one-copy"],
    ])("%s: %s", holds);

    test.each(electromagneticDrainedEndClockCases().map(variant => variant.name))("electromagnetic science drained end: %s (30 a second a copy, held over the baseline)",
        name => holds("electromagnetic-science-330-drained-end-clock-controls.json", name));

    test.each(logisticDirectInsertClockCases().map(variant => variant.name))("logistic science direct insert: %s (40 a second a copy, held and recovered from both cuts)",
        name => holds("logistic-science-240-direct-insert-clock-controls.json", name));

    describe("inserter crafting", () => {
        const controls = readControls<RunControls>("inserter-crafting-240-shared-signal-clock-controls.json");
        test.each(inserterCraftingClockCases().map(variant => [variant.name, variant.kind]))("%s", (name, kind) => {
            const {generation, native} = controls.cases[name];
            expect(runHolds(native), native.result).toBe(true);
            if (kind === "hand-made clock") {
                // the hand-made clock is not generated: its control is the game's run, 80 a second a copy, held and recovered
                expect(generation).toBeUndefined();
                expect([native.period, native.target]).toEqual([216, 240]);
            } else {
                expect(generation).toBeDefined();
            }
        });
    });

    describe("lithium silo", () => {
        const controls = readControls<RunControls>("lithium-plate-80-silo-chest-clock-controls.json");
        test.each(lithiumSiloCases().map(variant => [variant.name, variant.known_limit === undefined]))("%s", (name, holdsTarget) => {
            const {native} = controls.cases[name];
            // the game holds the target over the baseline and is back at it after each disturbance, but for the known limit, which never makes the target over a minute
            expect(runHolds(native), native.result).toBe(holdsTarget);
            if (!holdsTarget) expect(native.baseline?.meets ?? false, "the known limit misses the target").toBe(false);
        });
    });

    describe("grenade", () => {
        const controls = readControls<RunControls>("grenade-clock-controls.json");
        test.each(grenadeClockCases().map(variant => [variant.name, variant.kind]))("%s", (name, kind) => {
            const {generation, native} = controls.cases[name];
            expect(runHolds(native), native.result).toBe(true);
            expect(native.period).toBe(112);
            if (kind === "hand-made clock") expect(generation).toBeUndefined();
        });
    });

    describe("ore voider", () => {
        const controls = readControls<RunControls>("iron-ore-voider-400-clock-controls.json");
        // the run under the protocol (a minute of baseline, the ore cut, the output blocked) was recorded on the pinned clock and holds the target and recovers from both
        test.each([["ore-voider-exact-speed", "IRON_ORE_VOIDER_400_EXACT_SPEED"], ["ore-voider-overbeaconed", "IRON_ORE_VOIDER_400_OVERBEACONED"]] as const)("%s", async (name, sample) => {
            const {native, generation} = controls.cases[name];
            expectRunIsConsistent(native, generation!, (await loadConfigFromFile(ConfigPaths[sample])).target_output.items_per_second);
            expect(runHolds(native), native.result).toBe(true);
        });
    });
});
