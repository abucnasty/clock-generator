import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {withUnstatedLaneEnds} from "../../../src/entities/traits/lane-ends";
import {Recording} from "../../../src/verification/recording";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * Cell 02 (`PROCESSING_UNIT_80_CIRCUIT_EXPORT`, 80 processing units a second): two machines make the processing units from the circuits of two
 * circuit machines and the advanced circuits of two more, which each take their plastic from a belt of their own; two foundries cast the copper cable and one
 * the iron; the circuits leave on an export belt of two lanes at 40 a second a lane. The sample's scaffold throttles that export to 80 a
 * second with a constant combinator and four throttle inserters, and has four chest inserters that put the plastic onto its two belts.
 * The generator's clock for the config, as it is and with backpressure on the belts (the plastic belts have it, in the game), is recorded on it.
 */
const FOLDER = path.dirname(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);

/** The id of the alternative the generator selects for the config: the clock that takes its windows from the source of each branch */
export const GENERATED_ALTERNATIVE = "coordinated_sources";

/**
 * The id of the alternative the cases before the selection moved recorded: the 24-tick one, which the rule for hands in groups makes stable, with a window
 * of a tick at each swing of the takers the surplus guard gates. It is still an alternative of the job, and its two recordings are kept. From the
 * backpressure start (the default) the same windows come from the one-swing maker, under the id below (round_robin_polling_per_hand before).
 */
export const PER_HAND_ALTERNATIVE = "round_robin_polling_swings_1_per_hand";

/** The scaffold has four throttle inserters (belt to infinity chest) and four chest inserters for the plastic, which the config does not have */
const SCAFFOLD_INSERTERS = 8;

export interface ProcessingUnitCircuitExportClockCase {
    name: string;
    /** Whether the config has its belts backed up (a dead end on each lane of the config that states no end) */
    backed: boolean;
    /** The id of the alternative the case records */
    alternative: string;
    /** The run starts from ruling 60's start (the harness's backpressure start, `staged_start.backpressure`), not from a free warm-up */
    staged?: boolean;
    backpressure?: boolean;
}

export const PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES: ProcessingUnitCircuitExportClockCase[] = [
    {name: "generated-as-is", backed: false, alternative: GENERATED_ALTERNATIVE, staged: true, backpressure: true},
    {name: "generated-backed-up", backed: true, alternative: GENERATED_ALTERNATIVE, staged: true, backpressure: true},
    {name: "per-hand-as-is", backed: false, alternative: PER_HAND_ALTERNATIVE},
    {name: "per-hand-backed-up", backed: true, alternative: PER_HAND_ALTERNATIVE},
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
    const config = variant.backed ? withUnstatedLaneEnds(loaded, "dead_end") : loaded;
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: variant.backed,
        config: () => config,
        scaffold: () => fs.readFileSync(path.join(FOLDER, "processing-unit-80-circuit-export.scaffold"), "utf8").trim(),
        alternative: variant.alternative,
        ...(variant.staged && {staged: true, backpressure: variant.backpressure}),
        probeFile: path.join(__dirname, "processing-unit-80-circuit-export-clock-probe.lua"),
        probe: {family: "processing-unit-80-circuit-export"},
        controls: path.join(__dirname, "processing-unit-80-circuit-export-clock-controls.json"),
        assertHardware: recording => assertProcessingUnitCircuitExportHardware(recording, config),
    };
}
