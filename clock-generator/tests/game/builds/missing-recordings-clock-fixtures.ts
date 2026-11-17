import path from "path";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";

/**
 * The record jobs that had no game recording of their selected clock from the staged start (the count of 2026-11-18, the jobs with
 * status "none" or "recorded at another clock", in its order of risk), each recorded on the sample's scaffold, from the staged start
 * to steady state, a baseline of whole clock cycles and the losses of the case, and judged by itself on every copy the scaffold holds.
 *
 * The losses are the build's own where it has a protocol (the productivity module chain's coal cut, output block and stopped iron
 * foundries); for the others they are the families' standard ones: an ingredient cut, the output block, an ingredient cut (the
 * README, "How a clock run is timed"), the ingredients being those of the build's input lines. A build that takes every
 * ingredient from fluids or from machines has no ingredient to cut, and its loss is the output block alone.
 */
export const CONTROLS_FILE = "missing-recordings-clock-controls.json";

export type Loss = {kind: "cut"; item: string} | {kind: "block"} | {kind: "stop"; recipe: string};

export interface MissingRecordingCase {
    /** The entry's name in the controls file */
    name: string;
    /** The record job */
    job: string;
    config: keyof typeof ConfigPaths;
    /** The job is a variant of the sample: its config */
    variant?: (config: Config) => Config;
    /** The copies the scaffold holds (the config's own `copies` says how many the job has) */
    copies: number;
    losses: Loss[];
    /** Where the scaffold holds fewer copies than the job: the limit, named */
    limit?: string;
    /**
     * The output of the build is random (what a recycler gives back), so what a copy makes in one window cycle varies: each copy is judged on
     * its whole stretch (steady state to the first loss, and the last minute after the losses) and its window cycles that fall short are listed
     */
    random_output?: string;
    /**
     * Why the build cannot be recorded from the staged start: its belts are filled only by inserters that the staged start places with
     * the clock. The case is not run; the limit is named in the README until a start from ruling 60's state exists (the ruling-60 harness)
     */
    no_staged_start?: string;
}

const scaffoldOf = (key: keyof typeof ConfigPaths) => ConfigPaths[key].replace(/\.json$/, ".scaffold");
export const scaffoldFile = (item: MissingRecordingCase) => scaffoldOf(item.config);
export const sampleFolder = (item: MissingRecordingCase) => path.dirname(ConfigPaths[item.config]);

export const MISSING_RECORDING_CASES: MissingRecordingCase[] = [
    {
        name: "automation-science-240-one-output-swing", job: "variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING", config: "AUTOMATION_SCIENCE_240", copies: 9,
        variant: config => ({...config, overrides: {...config.overrides, terminal_swing_count: 1}}),
        // the pick is "no recovery": the loss the record names for it (copper plate stops arriving on the copies that share a lane)
        losses: [{kind: "cut", item: "copper-plate"}],
    },
    {
        name: "flying-robot-frame-80", job: "config-FLYING_ROBOT_FRAME_80", config: "FLYING_ROBOT_FRAME_80", copies: 12,
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "electric-engine-unit"}],
    },
    {
        name: "productivity-module-80-chest-chain", job: "config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN", config: "PRODUCTIVITY_MODULE_80_CHEST_CHAIN", copies: 1,
        losses: [{kind: "cut", item: "coal"}, {kind: "block"}, {kind: "stop", recipe: "casting-iron"}],
        limit: "the scaffold holds one copy of the job's six",
    },
    {
        name: "electromagnetic-science-240-recycler-belt-fed", job: "config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", config: "ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", copies: 2,
        losses: [{kind: "cut", item: "accumulator"}, {kind: "block"}, {kind: "cut", item: "superconductor"}],
        limit: "the scaffold holds two copies of the job's five",
        random_output: "the recyclers give back what the game rolls",
    },
    {
        name: "processing-unit-15-chest-fed", job: "config-PROCESSING_UNIT_15_CHEST_FED", config: "PROCESSING_UNIT_15_CHEST_FED", copies: 1,
        losses: [{kind: "cut", item: "advanced-circuit"}, {kind: "block"}, {kind: "cut", item: "electronic-circuit"}],
    },
    {
        name: "logistic-science-240", job: "config-LOGISTIC_SCIENCE_240", config: "LOGISTIC_SCIENCE_240", copies: 22,
        losses: [{kind: "cut", item: "transport-belt"}, {kind: "block"}, {kind: "cut", item: "inserter"}],
    },
    {
        name: "accumulator-320", job: "config-ACCUMULATOR_320", config: "ACCUMULATOR_320", copies: 9,
        losses: [{kind: "block"}],
    },
    {
        name: "automation-science-120-foundries-feed-belt-to-assembler", job: "config-AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER",
        config: "AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER", copies: 1,
        losses: [{kind: "cut", item: "copper-plate"}, {kind: "block"}, {kind: "cut", item: "iron-gear-wheel"}],
        limit: "the scaffold holds one copy of the job's nine",
        no_staged_start: "the harness's staged start fills the belts under the pickups before the cell's inserters are placed, and here only the foundries' "
            + "output inserters (cell inserters, placed with the clock) put anything on the belt: the lanes never saturate (\"The belts did not saturate: "
            + "the lanes under the pickups were not full for 30 ticks in a row within 10000 ticks\", 2026-11-17, Factorio 2.1.24)",
    },
];
