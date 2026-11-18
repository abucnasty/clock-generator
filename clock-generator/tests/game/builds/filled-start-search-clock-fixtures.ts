import path from "path";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {carScenario} from "./iron-plate-80-car-chest-clock-fixtures";
import {lithiumSiloScenario} from "./lithium-plate-80-silo-chest-clock-fixtures";
import {MISSING_RECORDING_CASES, SEARCH_CONTROLS_FILE} from "./missing-recordings-clock-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";
import {processingUnitCircuitExportClockScenario} from "./processing-unit-80-circuit-export-clock-fixtures";

/**
 * The picks of the search from every stable clock (CLOCK_SEARCH_FROM_EVERY_START=1, off by default, so the record does not select them) that
 * a build's own probe and protocol record, each from ruling 60's start (the harness's backpressure start, `staged_start.backpressure`), with
 * the build's own losses. The picks that the generic protocol records are cases of missing-recordings-clock-fixtures.ts (`from_every_start`);
 * the entries of both are in SEARCH_CONTROLS_FILE, and the generation test of the picks ties each to the clock the switch makes.
 */
export interface SearchFamilyCase {
    /** The entry's name in the controls file */
    name: string;
    /** The record job whose selection the switch moves */
    job: string;
    /** The job's config, and where the job is a variant of it, what the variant sets */
    config: keyof typeof ConfigPaths;
    variant?: (config: Config) => Config;
    /** The scenario of the family's own fixtures, which this case runs on ruling 60's start with the switch on */
    scenario: () => Promise<PickupClockScenario> | PickupClockScenario;
}

const ALTERNATIVE = "coordinated_sources";

export const SEARCH_FAMILY_CASES: SearchFamilyCase[] = [
    {
        name: "processing-unit-80-from-every-start", job: "config-PROCESSING_UNIT_80_CIRCUIT_EXPORT", config: "PROCESSING_UNIT_80_CIRCUIT_EXPORT",
        scenario: () => processingUnitCircuitExportClockScenario({name: "processing-unit-80-from-every-start", backed: false, alternative: ALTERNATIVE}),
    },
    {
        name: "processing-unit-80-backed-up-from-every-start", job: "variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP", config: "PROCESSING_UNIT_80_CIRCUIT_EXPORT",
        variant: config => ({...config, overrides: {...config.overrides, backed_up_belts: true}}),
        scenario: () => processingUnitCircuitExportClockScenario({name: "processing-unit-80-backed-up-from-every-start", backed: true, alternative: ALTERNATIVE}),
    },
    {
        name: "car-from-every-start", job: "config-IRON_PLATE_80_CAR_CHEST", config: "IRON_PLATE_80_CAR_CHEST",
        scenario: () => carScenario({name: "car-from-every-start", alternative: "coordinated_sources", period: 144, order: "as-built", staged: true}),
    },
    {
        // the pick's window cycle is 4,320 ticks, longer than the minute of the protocol's baseline: the baseline is two whole clock cycles
        name: "lithium-silo-from-every-start", job: "config-LITHIUM_PLATE_80_SILO_CHEST", config: "LITHIUM_PLATE_80_SILO_CHEST",
        scenario: () => ({
            ...lithiumSiloScenario({name: "lithium-silo-from-every-start", alternative: "coordinated_sources", order: "as-built", staged: true}),
            baseline: {ticks: 8640, reason: "the clock's window cycle is 4,320 ticks, longer than a minute: the baseline is two whole clock cycles"},
        }),
    },
];

/** Every pick of the search from every stable clock, whichever protocol records it: the entry's name, the record job, and the config the pick is made for */
export function searchPicks(): {name: string; job: string; config: keyof typeof ConfigPaths; variant?: (config: Config) => Config}[] {
    return [...MISSING_RECORDING_CASES.filter(it => it.from_every_start), ...SEARCH_FAMILY_CASES];
}

/** The family's scenario for a case: on ruling 60's start, with the switch on, compared with the case's entry in SEARCH_CONTROLS_FILE */
export async function searchScenarioOf(item: SearchFamilyCase): Promise<PickupClockScenario> {
    return {
        ...await item.scenario(), name: item.name, controls: path.join(__dirname, SEARCH_CONTROLS_FILE),
        staged: true, backpressure: true, from_every_start: true,
    };
}
