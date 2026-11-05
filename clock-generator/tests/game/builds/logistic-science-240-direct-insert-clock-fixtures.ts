import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {Recording} from "../../../src/verification/recording";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {assertFeedBacksUp, PickupClockScenario} from "./pickup-clock-capture";

/**
 * The logistic science build with direct insertion (`LOGISTIC_SCIENCE_240_DIRECT_INSERT`, 240 packs a second over 6 copies, 40 a second a
 * copy): two science assemblers fed transport belts by one foundry between them, whose plates and gears come from two casting
 * foundries on molten iron from infinity pipes, and fed inserters from a turbo belt each; each puts its packs onto another belt that a
 * loader drains into a void chest (#442). The sample's scaffold is one copy. Two infinity chests put the inserters onto their belts through a
 * stack inserter each, and the belts end where the last inserter takes from them.
 *
 * The generator's selected clock for the config as it is (moving belts) runs on it, wired to the copy: the losses the build has are the
 * supply of inserters (cut from every belt) and the packs not taken away (the two loaders removed). The molten iron has no loss: no
 * belt or chest carries it.
 */
export interface LogisticDirectInsertClockCase {
    name: string;
    alternative: string;
}

/** The id of the alternative the generated clock is: the selected one for the config as it is, 96 ticks of fractional swings */
export const GENERATED_ALTERNATIVE = "fractional";

export function logisticDirectInsertClockCases(): LogisticDirectInsertClockCase[] {
    return [{name: "generated-one-copy", alternative: GENERATED_ALTERNATIVE}];
}

const SCAFFOLD = path.join(path.dirname(ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT), "logistic-240-direct-insert.scaffold");

/** The copies of the config the sample's scaffold holds */
export const COPIES = 6;

/** The scaffold has two chest inserters, which put the inserters onto their belts and which the config does not have */
const SCAFFOLD_INSERTERS = 2;

/** The machines of the build are the config's (one copy), and its inserters the config's and the two that fill the belts */
export function assertLogisticDirectInsertHardware(recording: Recording, config: Config): void {
    const machines = (list: {recipe: string; crafting_speed: number; productivity: number}[]) => {
        const counts: Record<string, number> = {};
        for (const {recipe, crafting_speed, productivity} of list) {
            const key = `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`;
            counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
    };
    expect(machines(recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[])).toEqual(machines(config.machines));
    expect(recording.inserters).toHaveLength(config.inserters.length + SCAFFOLD_INSERTERS);
}

export async function logisticDirectInsertClockScenario(variant: LogisticDirectInsertClockCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT);
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(SCAFFOLD, "utf8").trim(),
        share: 1 / COPIES, copies: 1,
        alternative: variant.alternative,
        probeFile: path.join(__dirname, "logistic-science-240-direct-insert-clock-probe.lua"),
        probe: {family: "logistic-science-240-direct-insert", stackSize: 4},
        controls: path.join(__dirname, "logistic-science-240-direct-insert-clock-controls.json"),
        assertHardware: recording => assertLogisticDirectInsertHardware(recording, config),
        // the clock is made for moving belts, and in the game the scaffold's belts end closed: the lanes the inserters take from stand full
        validateReport: assertFeedBacksUp,
    };
}
