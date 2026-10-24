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
 * The productivity module chain (`REAL_OWNER_PRODUCTIVITY_CHAIN`, 80 modules a second over 6 copies, 13.33 a second a copy, the
 * sample's scaffold): nine machines (plastic, copper cable, iron, electronic circuits, advanced circuits and the modules) joined
 * by fourteen inserters and three chests, with the coal on a belt and the modules on another. The generator's selected clock for
 * the config is recorded on the scaffold, wired to the inserters of the build by the harness.
 */
const FOLDER = path.dirname(ConfigPaths.REAL_OWNER_PRODUCTIVITY_CHAIN);

/** The id of the alternative the generated clock is: the 72-tick one, which the rule for hands in groups makes stable */
export const GENERATED_ALTERNATIVE = "planned-belt-slack";

/** The scaffold has the one inserter that brings the coal onto its belt (chest to belt), which the config does not have */
const SCAFFOLD_FEEDERS = 1;

export function assertProductivityChainHardware(recording: Recording, config: Config): void {
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

export async function productivityChainClockScenario(): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PRODUCTIVITY_CHAIN);
    return {
        name: "generated-one-copy", speed: BELT_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(path.join(FOLDER, "productivity-chain-scaffold.txt"), "utf8").trim(),
        share: 1 / 6,
        alternative: GENERATED_ALTERNATIVE,
        // 64 untouched periods; then the coal cut for 10 periods (a cell holds about 2 periods of it), the output loader taken away
        // for 24 (the output belt takes 17 periods of modules before it is full) and the iron foundries stopped for 6, each
        // followed by 20 periods to get back
        interventions: [[66, 106, 126], [126, 150, 170], [170, 196, 218]],
        probeFile: path.join(__dirname, "productivity-chain-clock-probe.lua"),
        probe: {family: "productivity-chain", stackSize: 4},
        controls: path.join(__dirname, "productivity-chain-clock-controls.json"),
        assertHardware: recording => assertProductivityChainHardware(recording, config),
    };
}
