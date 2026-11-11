import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {Recording} from "../../../src/verification/recording";
import {matchRecordingToConfig} from "../../../src/verification/entity-matching";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {assertFeedDrains, PickupClockScenario} from "./pickup-clock-capture";

/**
 * The electromagnetic science build (`ELECTROMAGNETIC_SCIENCE_330`, 330 packs a second over 11 copies, 30 a second a copy): one plant that
 * takes accumulators and supercapacitors from one turbo belt (#458). The owner's drained-end scaffold is one copy whose input line runs
 * past the plant into a loader and a void chest, so the supply moves; the sample's own scaffold closes the line. Two infinity chests
 * on each lane put the items onto the belt through a stack inserter each, and two stack inserters put the packs into void chests.
 *
 * The generator's selected clock for the config as it is runs on it, wired to the copy, with no loss: steady state and the baseline, 100%
 * or more of the target. The config states its two lanes as dead ends, so the clock is made for backed-up lanes; here they drain.
 */
export interface ElectromagneticDrainedEndClockCase {
    name: string;
}

export function electromagneticDrainedEndClockCases(): ElectromagneticDrainedEndClockCase[] {
    return [{name: "generated-moving-one-copy"}];
}

const SCAFFOLD = path.join(__dirname, "electromagnetic-science-330-drained-end.scaffold");

/** The copies of the config the scaffold holds */
export const COPIES = 11;

/** The scaffold has four chest inserters, which put the items onto the belt and which the config does not have */
const SCAFFOLD_INSERTERS = 4;

/**
 * The scaffold is the config's build: the harness matches every machine and every inserter of the config to the recorded ones, and the
 * recorded inserters left over are the scaffold's four that fill the belt
 */
export function assertDrainedEndHardware(recording: Recording, config: Config): void {
    const match = matchRecordingToConfig(recording, config);
    expect(match.unmatched_config_machines, "config machines with no recorded machine").toEqual([]);
    expect(match.unmatched_recorded_machines, "recorded machines with no config machine").toEqual([]);
    expect(match.unmatched_config_inserters, "config inserters with no recorded inserter").toEqual([]);
    expect(match.unmatched_recorded_inserters, "the scaffold's chest inserters").toHaveLength(SCAFFOLD_INSERTERS);
    expect(recording.inserters).toHaveLength(config.inserters.length + SCAFFOLD_INSERTERS);
    const [plant] = recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[];
    const [expected] = config.machines;
    expect([plant.recipe, plant.crafting_speed.toFixed(4), plant.productivity]).toEqual([expected.recipe, expected.crafting_speed.toFixed(4), expected.productivity]);
}

export async function electromagneticDrainedEndClockScenario(variant: ElectromagneticDrainedEndClockCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(SCAFFOLD, "utf8").trim(),
        share: 1 / COPIES, copies: 1,
        probeFile: path.join(__dirname, "electromagnetic-science-330-drained-end-clock-probe.lua"),
        probe: {family: "electromagnetic-science-330-drained-end", stackSize: 4},
        controls: path.join(__dirname, "electromagnetic-science-330-drained-end-clock-controls.json"),
        assertHardware: recording => assertDrainedEndHardware(recording, config),
        // the input line is drained into a loader: the lanes move
        validateReport: assertFeedDrains,
    };
}
