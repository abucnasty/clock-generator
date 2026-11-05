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
 * Cell 02 (`PROCESSING_UNIT_80_CIRCUIT_EXPORT`, 80 processing units a second): two machines make the processing units from the circuits of two
 * circuit machines and the advanced circuits of two more, which have their plastic from a belt; two foundries cast the copper cable and one
 * the iron; the circuits leave on an export belt of two lanes at 40 a second a lane. The sample's scaffold throttles that export to 80 a
 * second with a constant combinator and four throttle inserters, and has four chest inserters that put the plastic onto its belt.
 * The generator's clock for the config, as it is and with the belts backed up (the plastic belt is, in the game), is recorded on it.
 */
const FOLDER = path.dirname(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);

/** The id of the alternative the generated clock is: the 24-tick one, which the rule for hands in groups makes stable */
export const GENERATED_ALTERNATIVE = "planned-belt-slack";

/** The scaffold has four throttle inserters (belt to infinity chest) and four chest inserters for the plastic, which the config does not have */
const SCAFFOLD_INSERTERS = 8;

export interface ProcessingUnitCircuitExportClockCase {
    name: string;
    /** Whether the config has its belts backed up (`overrides.backed_up_belts`) */
    backed: boolean;
}

export const PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES: ProcessingUnitCircuitExportClockCase[] = [
    {name: "generated-as-is", backed: false},
    {name: "generated-backed-up", backed: true},
];

export function assertProcessingUnitCircuitExportHardware(recording: Recording, config: Config): void {
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
    expect(recording.inserters).toHaveLength(config.inserters.length + SCAFFOLD_INSERTERS);
}

export async function processingUnitCircuitExportClockScenario(variant: ProcessingUnitCircuitExportClockCase): Promise<PickupClockScenario> {
    const loaded = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    const config = variant.backed ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: variant.backed,
        config: () => config,
        scaffold: () => fs.readFileSync(path.join(FOLDER, "processing-unit-80-circuit-export.scaffold"), "utf8").trim(),
        alternative: GENERATED_ALTERNATIVE,
        probeFile: path.join(__dirname, "processing-unit-80-circuit-export-clock-probe.lua"),
        probe: {family: "processing-unit-80-circuit-export"},
        controls: path.join(__dirname, "processing-unit-80-circuit-export-clock-controls.json"),
        assertHardware: recording => assertProcessingUnitCircuitExportHardware(recording, config),
    };
}
