import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * Thaeln's cell 09 (`REAL_THAELN_CELL09`, 480 utility science packs a second over 3.5 copies, 137.14 a second a copy, the
 * sample's scaffold): eight assembling machines make the packs, four foundries cast the low density structure that two machines
 * each take, a cryogenic plant makes the plastic and has its coal from a belt, and the units and the frames come off two belts.
 * The generator's selected clock for the config is recorded on the scaffold, wired to the inserters of the cell by the harness.
 */
const FOLDER = path.dirname(ConfigPaths.REAL_THAELN_CELL09);

/** The id of the alternative the generated clock is: the 168-tick one, which the rule for hands in groups makes stable */
export const GENERATED_ALTERNATIVE = "planned-belt-slack";

/** The scaffold has the five inserters that bring the supplies onto the belts (chest to belt), which the config does not have */
const SCAFFOLD_FEEDERS = 5;

export function assertThaelnCell09Hardware(recording: Recording, config: Config): void {
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

export async function thaelnCell09ClockScenario(): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
    return {
        name: "generated-one-copy", speed: BELT_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(path.join(FOLDER, "thaeln-cell09-scaffold.txt"), "utf8").trim(),
        share: 2 / 7,
        alternative: GENERATED_ALTERNATIVE,
        // 64 untouched periods; then the coal cut for 6 periods (a cell holds about 100 coal, which lasts 2 periods of 168 ticks),
        // the output blocked for 4 and the units cut for 2, as the family does
        interventions: [[66, 72, 88], [88, 92, 108], [108, 110, 136]],
        probeFile: path.join(__dirname, "thaeln-cell09-clock-probe.lua"),
        probe: {family: "thaeln-cell09", stackSize: 4},
        controls: path.join(__dirname, "thaeln-cell09-clock-controls.json"),
        assertHardware: recording => assertThaelnCell09Hardware(recording, config),
    };
}
