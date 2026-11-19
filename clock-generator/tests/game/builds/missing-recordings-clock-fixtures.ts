import path from "path";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {withJellyHandsOf15} from "../../configs/rocket-fuel-hands";

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
/**
 * The controls file of the picks the search from every stable clock makes (CLOCK_SEARCH_FROM_EVERY_START=1, off by default: the record does not
 * select them), recorded here and under the families' own probes (filled-start-search-clock.game.test.ts)
 */
export const SEARCH_CONTROLS_FILE = "filled-start-search-clock-controls.json";

export type Loss = {kind: "cut"; item: string} | {kind: "block"} | {kind: "stop"; recipe: string};

export interface MissingRecordingCase {
    /** The entry's name in the controls file */
    name: string;
    /** The record job */
    job: string;
    /**
     * The case records the pick the generator makes with CLOCK_SEARCH_FROM_EVERY_START on (tests/game/helpers/search-switch.ts), not the
     * record's: the test asserts it is another clock than the record's selection, and its entry is in SEARCH_CONTROLS_FILE
     */
    from_every_start?: true;
    config: keyof typeof ConfigPaths;
    /** The scaffold's file name where it is not the config's own with ".scaffold" for ".json" (the advanced circuit samples share one) */
    scaffold?: string;
    /**
     * A baseline longer than the protocol's minute, with the reason (the protocol allows it, at most RUN_PROTOCOL.maxBaseline ticks): a clock
     * cycle longer than a minute has no whole clock cycle in the minute
     */
    baseline?: {ticks: number; reason: string};
    /** Ticks the run goes on after its last loss, where the clock cycle is longer than the test's 7,200: it must hold a whole clock cycle */
    tail_ticks?: number;
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
     * Why the staged start is not the judged start of the build: its belts are filled only by inserters that the staged start places with
     * the clock, or the pick leaves inserters without a window. The case is not run; the limit is named in the README until a start
     * from ruling 60's state exists (the ruling-60 harness)
     */
    no_staged_start?: string;
    /**
     * The job's judged start is ruling 60's state, because its pick leaves inserters without a window (the unclocked part runs and fills first, the
     * windowed inserters are held off by the clock's lock, and the lock opens at the clock's first tick): the harness's backpressure start
     */
    start?: "backpressure";
    /**
     * The output block fills the chests the output goes into, where the build has loaders that are not on the output (here they drain the ingredient
     * belts, which the probe's block would take off, leaving the output as it is). The reason
     */
    block_sinks?: string;
    /**
     * Lua of its own that runs at the start of the recording, before the probe, for hardware the sample's scaffold does not have (the file in this
     * folder). A backpressure start runs it at the tick the lock opens
     */
    prelude?: string;
    /**
     * The recorder does not start on machines that have no recipe, and a furnace takes its recipe from its first ingredient: the final machine
     * of this build is a furnace, so the staged start cannot record from the placement. The run is the same, from the placement; the recording
     * (which the test uses for the build's hardware and its copies) starts where the run ends (the harness's `settle_ticks`)
     */
    late_recording?: string;
}

export const controlsFileOf = (item: MissingRecordingCase) => item.from_every_start ? SEARCH_CONTROLS_FILE : CONTROLS_FILE;

const scaffoldOf = (key: keyof typeof ConfigPaths) => ConfigPaths[key].replace(/\.json$/, ".scaffold");
export const scaffoldFile = (item: MissingRecordingCase) => item.scaffold ? path.join(path.dirname(ConfigPaths[item.config]), item.scaffold) : scaffoldOf(item.config);

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
        start: "backpressure",
    },
    {
        name: "productivity-module-80-chest-chain", job: "config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN", config: "PRODUCTIVITY_MODULE_80_CHEST_CHAIN", copies: 1,
        losses: [{kind: "cut", item: "coal"}, {kind: "block"}, {kind: "stop", recipe: "casting-iron"}],
        limit: "the scaffold holds one copy of the job's six",
        start: "backpressure",
    },
    {
        name: "electromagnetic-science-240-recycler-belt-fed", job: "config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", config: "ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", copies: 2,
        losses: [{kind: "cut", item: "accumulator"}, {kind: "block"}, {kind: "cut", item: "superconductor"}],
        limit: "the scaffold holds two copies of the job's five",
        random_output: "the recyclers give back what the game rolls",
        start: "backpressure",
    },
    {
        name: "processing-unit-15-chest-fed", job: "config-PROCESSING_UNIT_15_CHEST_FED", config: "PROCESSING_UNIT_15_CHEST_FED", copies: 1,
        losses: [{kind: "cut", item: "advanced-circuit"}, {kind: "block"}, {kind: "cut", item: "electronic-circuit"}],
    },
    {
        name: "logistic-science-240", job: "config-LOGISTIC_SCIENCE_240", config: "LOGISTIC_SCIENCE_240", copies: 22,
        losses: [{kind: "cut", item: "transport-belt"}, {kind: "block"}, {kind: "cut", item: "inserter"}],
        start: "backpressure",
    },
    {
        name: "accumulator-320", job: "config-ACCUMULATOR_320", config: "ACCUMULATOR_320", copies: 9,
        losses: [{kind: "block"}],
        start: "backpressure",
    },
    {
        name: "automation-science-120-foundries-feed-belt-to-assembler", job: "config-AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER",
        config: "AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER", copies: 1,
        losses: [{kind: "cut", item: "copper-plate"}, {kind: "block"}, {kind: "cut", item: "iron-gear-wheel"}],
        limit: "the scaffold holds one copy of the job's nine",
        start: "backpressure",
    },
    {
        name: "logistic-science-240-direct-insert", job: "config-LOGISTIC_SCIENCE_240_DIRECT_INSERT", config: "LOGISTIC_SCIENCE_240_DIRECT_INSERT", copies: 1,
        // the inserters come on belts from two infinity chests; the molten iron comes from infinity pipes and has no loss
        losses: [{kind: "cut", item: "inserter"}, {kind: "block"}],
        limit: "the scaffold holds one copy of the job's six",
    },
    {
        name: "advanced-circuit-230", scaffold: "advanced-circuit.scaffold", job: "config-ADVANCED_CIRCUIT_230", config: "ADVANCED_CIRCUIT_230", copies: 1,
        tail_ticks: 12_700,
        baseline: {ticks: 12_672, reason: "the clock cycle is 12,672 ticks (23 window cycles of 550.957): a minute holds no whole clock cycle"},
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
    },
    {
        name: "advanced-circuit-240", scaffold: "advanced-circuit.scaffold", job: "config-ADVANCED_CIRCUIT_240", config: "ADVANCED_CIRCUIT_240", copies: 1,
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
    },
    {
        name: "advanced-circuit-240-backed-up", scaffold: "advanced-circuit.scaffold", job: "variants-ADVANCED_CIRCUIT_240_BACKED_UP", config: "ADVANCED_CIRCUIT_240", copies: 1,
        variant: config => ({...config, overrides: {...config.overrides, backed_up_belts: true}}),
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
    },
    {
        name: "lds-240", job: "config-LDS_240", config: "LDS_240", copies: 1,
        losses: [{kind: "cut", item: "coal"}, {kind: "block"}],
    },
    {
        name: "metallurgic-science-45", job: "config-METALLURGIC_SCIENCE_45", config: "METALLURGIC_SCIENCE_45", copies: 1,
        losses: [{kind: "cut", item: "tungsten-ore"}, {kind: "block"}, {kind: "cut", item: "coal"}],
    },
    {
        name: "rocket-fuel-60", job: "config-ROCKET_FUEL_60", config: "ROCKET_FUEL_60", copies: 1,
        losses: [{kind: "cut", item: "bioflux"}, {kind: "block"}, {kind: "cut", item: "nutrients"}],
        start: "backpressure",
    },
    {
        name: "rocket-fuel-60-jelly-hands-15-backed-up", job: "variants-ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP", config: "ROCKET_FUEL_60", copies: 1,
        variant: config => {
            const hands = withJellyHandsOf15(config);
            return {...hands, overrides: {...hands.overrides, backed_up_belts: true}};
        },
        losses: [{kind: "cut", item: "bioflux"}, {kind: "block"}, {kind: "cut", item: "nutrients"}],
        start: "backpressure",
        prelude: "rocket-fuel-jelly-hands-15-prelude.lua",
    },
    {
        // the nutrient cut after the output block's recovery lasts 3 ticks in the run above (the output is back over its baseline's lowest minute
        // the tick after the block is released, so the next cut falls and is released within a few ticks): the cut has its own case
        name: "rocket-fuel-60-jelly-hands-15-backed-up-nutrients", job: "variants-ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP", config: "ROCKET_FUEL_60", copies: 1,
        variant: config => {
            const hands = withJellyHandsOf15(config);
            return {...hands, overrides: {...hands.overrides, backed_up_belts: true}};
        },
        losses: [{kind: "cut", item: "nutrients"}],
        start: "backpressure",
        prelude: "rocket-fuel-jelly-hands-15-prelude.lua",
    },
    {
        name: "stone-brick-120-drill-direct-insert", job: "config-STONE_BRICK_120_DRILL_DIRECT_INSERT", config: "STONE_BRICK_120_DRILL_DIRECT_INSERT", copies: 1,
        // the furnace takes its stone from a drill that drops into it: no ingredient line to cut, so the loss is the output block alone
        losses: [{kind: "block"}],
        limit: "the scaffold holds one copy of the job's three",
        late_recording: "the final machine is a furnace with no recipe at the placement",
    },
    {
        name: "electric-furnace-20", job: "config-ELECTRIC_FURNACE_20", config: "ELECTRIC_FURNACE_20", copies: 1,
        // the one input line is the advanced circuits on a belt; the steel comes from a foundry and the stone bricks from furnaces that drills fill
        losses: [{kind: "cut", item: "advanced-circuit"}, {kind: "block"}, {kind: "cut", item: "advanced-circuit"}],
        limit: "the scaffold holds one copy of the job's two",
        start: "backpressure",
        late_recording: "the final machine is a furnace with no recipe at the placement",
    },
    // every inserter of the build has a window, so the staged start is the judged start. The three losses in a row do not each bite: the
    // build makes 111 % of its target, the output is back over the target (the run's test of recovery) before it is back over the baseline's
    // lowest minute (its test of a fall), so the loss after a recovered one falls and recovers within a tick or two. Each loss that follows another
    // therefore has a case of its own, run from the baseline.
    {
        name: "iron-bacteria-380", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "cut", item: "bioflux"}],
    },
    {
        name: "iron-bacteria-380-block", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "block"}],
        block_sinks: "the scaffold's two loaders drain the bioflux and nutrients belts; the output goes into four void chests",
    },
    {
        name: "iron-bacteria-380-nutrients", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "cut", item: "nutrients"}],
    },
    // the picks of the search from every stable clock (CLOCK_SEARCH_FROM_EVERY_START=1) that the generic protocol records, each from ruling 60's
    // start with the losses of the job's own case above
    {
        name: "advanced-circuit-240-from-every-start", scaffold: "advanced-circuit.scaffold", job: "config-ADVANCED_CIRCUIT_240", config: "ADVANCED_CIRCUIT_240", copies: 1,
        from_every_start: true, start: "backpressure",
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
    },
    {
        name: "advanced-circuit-240-backed-up-from-every-start", scaffold: "advanced-circuit.scaffold", job: "variants-ADVANCED_CIRCUIT_240_BACKED_UP", config: "ADVANCED_CIRCUIT_240", copies: 1,
        from_every_start: true, start: "backpressure",
        variant: config => ({...config, overrides: {...config.overrides, backed_up_belts: true}}),
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
    },
    {
        // the electric furnaces and the productivity modules come on one belt from two infinity chests; the stone comes from a drill, which has no cut
        name: "production-science-120-two-belts-from-every-start", job: "config-PRODUCTION_SCIENCE_120_TWO_BELTS", config: "PRODUCTION_SCIENCE_120_TWO_BELTS", copies: 1,
        from_every_start: true, start: "backpressure",
        losses: [{kind: "cut", item: "electric-furnace"}, {kind: "block"}, {kind: "cut", item: "productivity-module"}],
        limit: "the scaffold holds one copy of the job's seven",
        no_staged_start: "ruling 60's start refuses the build: a drill drops stone straight into the rail assembler, so a machine that only windowed inserters feed "
            + "holds items at the opening (\"Machines that only windowed inserters fill hold items at the opening: assembling-machine-3 (unit 376): 164 in, 0 out, "
            + "0 made\", 2026-11-18, Factorio 2.1.24, master 755eb93e and before). The pick is not recorded in the game",
    },
];
