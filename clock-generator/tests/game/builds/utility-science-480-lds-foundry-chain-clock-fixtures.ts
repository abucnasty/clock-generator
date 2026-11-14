import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {Recording} from "../../../src/verification/recording";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * the utility science 480 build (`UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN`, 480 utility science packs a second over 3.5 copies, 137.14 a second a copy, the
 * sample's scaffold): eight assembling machines make the packs, four foundries cast the low density structure that two machines
 * each take, a cryogenic plant makes the plastic and has its coal from a belt, and the units and the frames come off two belts.
 * The generator's selected clock for the config is recorded on the scaffold, wired to the inserters of the cell by the harness.
 */
const FOLDER = path.dirname(ConfigPaths.UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN);

/** The id of the alternative the generated clock is: the per-branch clock of 168 ticks, which takes the coal inserter's windows from a part one source at a time */
export const GENERATED_ALTERNATIVE = "coordinated_sources";

/** The scaffold has the five inserters that bring the supplies onto the belts (chest to belt), which the config does not have */
const SCAFFOLD_FEEDERS = 5;

export function assertUtilityScienceLdsFoundryChainHardware(recording: Recording, config: Config): void {
    const machines: Record<string, number> = {};
    for (const {recipe, crafting_speed, productivity} of recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[]) {
        const key = `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`;
        machines[key] = (machines[key] ?? 0) + 1;
    }
    const expected: Record<string, number> = {};
    for (const {recipe, crafting_speed, productivity} of config.machines) {
        const key = `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`;
        expected[key] = (expected[key] ?? 0) + 1;
    }
    expect(machines).toEqual(expected);
    expect(recording.inserters).toHaveLength(config.inserters.length + SCAFFOLD_FEEDERS);
}

export async function utilityScienceLdsFoundryChainClockScenario(): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN);
    return {
        name: "generated-one-copy", speed: CLOCK_TEST_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(path.join(FOLDER, "utility-480-lds-foundry-chain.scaffold"), "utf8").trim(),
        share: 2 / 7,
        alternative: GENERATED_ALTERNATIVE,
        probeFile: path.join(__dirname, "utility-science-480-lds-foundry-chain-clock-probe.lua"),
        probe: {family: "utility-science-480-lds-foundry-chain", stackSize: 4},
        controls: path.join(__dirname, "utility-science-480-lds-foundry-chain-clock-controls.json"),
        assertHardware: recording => assertUtilityScienceLdsFoundryChainHardware(recording, config),
    };
}
