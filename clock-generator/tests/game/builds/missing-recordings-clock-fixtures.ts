import path from "path";
import {Config} from "../../../src/config";
import {withUnstatedLaneEnds} from "../../../src/entities/traits/lane-ends";
import {ConfigPaths} from "../../../src/config/config-paths";
import {productionScienceSharedPickup} from "../../../src/crafting/generate-blueprint-test-helpers";
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
    /**
     * How much of the tail's end is judged after the losses where it is not the protocol's minute (RECOVERY_CYCLES_TICKS): a copy whose output
     * repeats every r clock cycles is judged over a whole number of the repeat (helpers/run-judgement.js judgeAfterLoss, decision 1057), and a
     * repeat is seen only where the judged part holds it twice
     */
    tail_judged_ticks?: number;
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
    // the multi-copy scaffold builds and the loop builds, each from ruling 60's start (the judged start), every copy the scaffold holds
    {
        // nine copies on one input belt (gear wheels on one lane, copper plates on the other, both dead ends); the one loader of the scaffold takes the packs
        // off the output line, so the output block removes it
        name: "automation-science-240", job: "config-AUTOMATION_SCIENCE_240", config: "AUTOMATION_SCIENCE_240", copies: 9,
        losses: [{kind: "cut", item: "iron-gear-wheel"}, {kind: "block"}, {kind: "cut", item: "copper-plate"}],
        start: "backpressure",
    },
    // the three losses in a row of the case above do not each bite: the output is back over the target before it is back over the baseline's lowest
    // minute, so the block and the copper plate cut lasted 5 and 4 ticks. Each loss has a case of its own from the baseline, to say which one leaves copy 2 short
    {
        name: "automation-science-240-gear", job: "config-AUTOMATION_SCIENCE_240", config: "AUTOMATION_SCIENCE_240", copies: 9,
        losses: [{kind: "cut", item: "iron-gear-wheel"}],
        start: "backpressure",
    },
    {
        name: "automation-science-240-block", job: "config-AUTOMATION_SCIENCE_240", config: "AUTOMATION_SCIENCE_240", copies: 9,
        losses: [{kind: "block"}],
        start: "backpressure",
    },
    {
        name: "automation-science-240-copper", job: "config-AUTOMATION_SCIENCE_240", config: "AUTOMATION_SCIENCE_240", copies: 9,
        losses: [{kind: "cut", item: "copper-plate"}],
        start: "backpressure",
    },
    {
        name: "automation-science-240-one-output-swing", job: "variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING", config: "AUTOMATION_SCIENCE_240", copies: 9,
        variant: config => ({...config, overrides: {...config.overrides, terminal_swing_count: 1}}),
        losses: [{kind: "cut", item: "iron-gear-wheel"}, {kind: "block"}, {kind: "cut", item: "copper-plate"}],
        start: "backpressure",
    },
    {
        // five copies; the scaffold's four loaders drain the bioflux and nutrient belts, and the packs go into infinity chests, so the output block fills those
        name: "agricultural-science-250", job: "config-AGRICULTURAL_SCIENCE_250", config: "AGRICULTURAL_SCIENCE_250", copies: 5,
        losses: [{kind: "cut", item: "bioflux"}, {kind: "block"}, {kind: "cut", item: "nutrients"}],
        start: "backpressure",
        block_sinks: "the scaffold's loaders drain the bioflux and nutrients belts; the packs go into infinity chests",
    },
    {
        name: "agricultural-science-250-backed-up", job: "config-AGRICULTURAL_SCIENCE_250", config: "AGRICULTURAL_SCIENCE_250", copies: 5,
        losses: [{kind: "cut", item: "bioflux"}, {kind: "block"}, {kind: "cut", item: "nutrients"}],
        start: "backpressure",
        block_sinks: "the scaffold's loaders drain the bioflux and nutrients belts; the packs go into infinity chests",
    },
    {
        // eleven plants on one belt of accumulators and supercapacitors, dead-ended; the packs go into infinity chests (no loader)
        name: "electromagnetic-science-330", job: "config-ELECTROMAGNETIC_SCIENCE_330", config: "ELECTROMAGNETIC_SCIENCE_330", copies: 11,
        losses: [{kind: "cut", item: "accumulator"}, {kind: "block"}, {kind: "cut", item: "supercapacitor"}],
        start: "backpressure",
        // after the supercapacitor cut a copy makes every craft, but its output inserters take 67 and 65 hands in turn over 2,112 ticks (the net of a
        // cycle reads 1,072 and 1,040): a repeat of two cycles, judged over the five cycles of the tail's last 10,560 ticks (the recording's limit of 72,000 ticks allows a tail of 18,000)
        tail_ticks: 18_000, tail_judged_ticks: 10_560,
    },
    // the output block lasted 22 ticks in the run above (the accumulator cut recovers over the target before it is over the baseline's lowest minute): each loss has a case of its own
    {
        name: "electromagnetic-science-330-accumulators", job: "config-ELECTROMAGNETIC_SCIENCE_330", config: "ELECTROMAGNETIC_SCIENCE_330", copies: 11,
        losses: [{kind: "cut", item: "accumulator"}],
        start: "backpressure",
    },
    {
        name: "electromagnetic-science-330-block", job: "config-ELECTROMAGNETIC_SCIENCE_330", config: "ELECTROMAGNETIC_SCIENCE_330", copies: 11,
        losses: [{kind: "block"}],
        start: "backpressure",
    },
    {
        name: "electromagnetic-science-330-supercapacitors", job: "config-ELECTROMAGNETIC_SCIENCE_330", config: "ELECTROMAGNETIC_SCIENCE_330", copies: 11,
        losses: [{kind: "cut", item: "supercapacitor"}],
        start: "backpressure",
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
        name: "electromagnetic-science-240-recycler-belt-fed", job: "config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", config: "ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", copies: 5,
        scaffold: "electromagnetic-240-recycler-belt-fed-five-copies.blueprint",
        losses: [{kind: "cut", item: "accumulator"}, {kind: "block"}, {kind: "cut", item: "superconductor"}],
        random_output: "the recyclers give back what the game rolls",
        start: "backpressure",
    },
    // the block and the superconductor cut after the accumulator cut's recovery last 1 tick each in the run above (the output is back over the target before it is back
    // over the baseline's lowest minute, so the next loss falls and is released at once): each has a case of its own, from the baseline
    {
        name: "electromagnetic-science-240-recycler-belt-fed-block", job: "config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", config: "ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", copies: 5,
        scaffold: "electromagnetic-240-recycler-belt-fed-five-copies.blueprint",
        losses: [{kind: "block"}],
        random_output: "the recyclers give back what the game rolls",
        start: "backpressure",
    },
    {
        name: "electromagnetic-science-240-recycler-belt-fed-superconductors", job: "config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", config: "ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED", copies: 5,
        scaffold: "electromagnetic-240-recycler-belt-fed-five-copies.blueprint",
        losses: [{kind: "cut", item: "superconductor"}],
        random_output: "the recyclers give back what the game rolls",
        start: "backpressure",
    },
    {
        name: "processing-unit-15-chest-fed", job: "config-PROCESSING_UNIT_15_CHEST_FED", config: "PROCESSING_UNIT_15_CHEST_FED", copies: 1,
        losses: [{kind: "cut", item: "advanced-circuit"}, {kind: "block"}, {kind: "cut", item: "electronic-circuit"}],
        start: "backpressure",
    },
    {
        // iron plates come by a belt and a steel chest of 4 slots (400 plates); the iron cut goes first, so the chest's stock is the baseline's, and the copper cable comes from an infinity chest
        name: "electronic-circuit-2-belt-chest", job: "config-ELECTRONIC_CIRCUIT_2_BELT_CHEST", config: "ELECTRONIC_CIRCUIT_2_BELT_CHEST", copies: 1,
        losses: [{kind: "cut", item: "iron-plate"}, {kind: "block"}, {kind: "cut", item: "copper-cable"}],
        start: "backpressure",
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
        start: "backpressure",
    },
    {
        name: "advanced-circuit-230", scaffold: "advanced-circuit.scaffold", job: "config-ADVANCED_CIRCUIT_230", config: "ADVANCED_CIRCUIT_230", copies: 1,
        tail_ticks: 12_700,
        baseline: {ticks: 12_672, reason: "the clock cycle is 12,672 ticks (23 window cycles of 550.957): a minute holds no whole clock cycle"},
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
        start: "backpressure",
    },
    {
        name: "advanced-circuit-240", scaffold: "advanced-circuit.scaffold", job: "config-ADVANCED_CIRCUIT_240", config: "ADVANCED_CIRCUIT_240", copies: 1,
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
        start: "backpressure",
    },
    {
        name: "advanced-circuit-240-backed-up", scaffold: "advanced-circuit.scaffold", job: "variants-ADVANCED_CIRCUIT_240_BACKED_UP", config: "ADVANCED_CIRCUIT_240", copies: 1,
        variant: config => withUnstatedLaneEnds(config, "dead_end"),
        losses: [{kind: "cut", item: "electronic-circuit"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        limit: "the scaffold holds one copy of the job's three",
        start: "backpressure",
    },
    {
        name: "lds-240", job: "config-LDS_240", config: "LDS_240", copies: 1,
        losses: [{kind: "cut", item: "coal"}, {kind: "block"}],
        start: "backpressure",
    },
    {
        name: "metallurgic-science-45", job: "config-METALLURGIC_SCIENCE_45", config: "METALLURGIC_SCIENCE_45", copies: 1,
        losses: [{kind: "cut", item: "tungsten-ore"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        start: "backpressure",
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
            return withUnstatedLaneEnds(hands, "dead_end");
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
            return withUnstatedLaneEnds(hands, "dead_end");
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
        start: "backpressure",
    },
    {
        name: "electric-furnace-20", job: "config-ELECTRIC_FURNACE_20", config: "ELECTRIC_FURNACE_20", copies: 1,
        // the one input line is the advanced circuits on a belt; the steel comes from a foundry and the stone bricks from furnaces that drills fill
        losses: [{kind: "cut", item: "advanced-circuit"}, {kind: "block"}, {kind: "cut", item: "advanced-circuit"}],
        limit: "the scaffold holds one copy of the job's two",
        start: "backpressure",
        late_recording: "the final machine is a furnace with no recipe at the placement",
    },
    // the build is recorded from ruling 60's start, the judged start. The three losses in a row do not each bite: the
    // build makes 111 % of its target, the output is back over the target (the run's test of recovery) before it is back over the baseline's
    // lowest minute (its test of a fall), so the loss after a recovered one falls and recovers within a tick or two. Each loss that follows another
    // therefore has a case of its own, run from the baseline.
    {
        name: "iron-bacteria-380", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "cut", item: "bioflux"}],
        start: "backpressure",
    },
    {
        name: "iron-bacteria-380-block", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "block"}],
        start: "backpressure",
        block_sinks: "the scaffold's two loaders drain the bioflux and nutrients belts; the output goes into four void chests",
    },
    {
        name: "iron-bacteria-380-nutrients", job: "config-IRON_BACTERIA_380_CULTIVATION", config: "IRON_BACTERIA_380_CULTIVATION", copies: 1,
        losses: [{kind: "cut", item: "nutrients"}],
        start: "backpressure",
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
        variant: config => withUnstatedLaneEnds(config, "dead_end"),
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
    // The scaffold builds of the science packs, recorded from ruling 60's start (the judged start) on every copy the harness can build: the
    // sample's scaffold holds one copy of utility science 120, production science 120 and its shared pickup variant (the job has seven), two of
    // utility science 120 with processing units and low density structures on one belt (seven), and five of military science 240 (the job's five);
    // chemical science 240 with a shared foundry on the sample's one block (the job is one copy at 480/11 a second). The
    // losses are the family's standard ones: an ingredient cut, the output block, an ingredient cut (the README, "How a clock run is timed").
    {
        // the pick is "no recovery": the loss the record names for it (the low density structures stop arriving); where the game recovers from it on
        // this scaffold, which has no copy that shares a lane, the run goes on to the block and the cut of the processing units
        name: "utility-science-120", job: "config-UTILITY_SCIENCE_120", config: "UTILITY_SCIENCE_120", copies: 7,
        scaffold: "utility-120-seven-copies.blueprint",
        losses: [{kind: "cut", item: "low-density-structure"}, {kind: "block"}, {kind: "cut", item: "processing-unit"}],
        start: "backpressure",
    },
    {
        name: "utility-science-120-processing-unit-and-lds-on-one-belt", job: "config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT",
        config: "UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT", copies: 7,
        scaffold: "utility-120-processing-unit-and-lds-on-one-belt-seven-copies.blueprint",
        losses: [{kind: "cut", item: "low-density-structure"}, {kind: "block"}, {kind: "cut", item: "flying-robot-frame"}],
        start: "backpressure",
    },
    // the flying robot frame cut after the block's recovery lasts 4 ticks in the run above (the output is back over its baseline's lowest minute by 18 items only): it has a case of its own, from the baseline
    {
        name: "utility-science-120-processing-unit-and-lds-on-one-belt-frames", job: "config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT",
        config: "UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT", copies: 7,
        scaffold: "utility-120-processing-unit-and-lds-on-one-belt-seven-copies.blueprint",
        losses: [{kind: "cut", item: "flying-robot-frame"}],
        start: "backpressure",
    },
    {
        // the drill drops stone straight into the rail assembler; the electric furnaces and the productivity modules come on one belt from two infinity
        // chests, the molten iron from infinity pipes, which have no loss
        name: "production-science-120-two-belts", job: "config-PRODUCTION_SCIENCE_120_TWO_BELTS", config: "PRODUCTION_SCIENCE_120_TWO_BELTS", copies: 7,
        scaffold: "production-120-two-belts-seven-copies.blueprint",
        losses: [{kind: "cut", item: "electric-furnace"}, {kind: "block"}, {kind: "cut", item: "productivity-module"}],
        start: "backpressure",
    },
    {
        name: "production-science-120-two-belts-shared-pickup", job: "variants-PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP", config: "PRODUCTION_SCIENCE_120_TWO_BELTS", copies: 7,
        scaffold: "production-120-two-belts-seven-copies.blueprint",
        variant: productionScienceSharedPickup,
        losses: [{kind: "cut", item: "electric-furnace"}, {kind: "block"}, {kind: "cut", item: "productivity-module"}],
        start: "backpressure",
    },
    {
        name: "chemical-science-240-shared-foundry", job: "config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", config: "CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", copies: 1,
        losses: [{kind: "cut", item: "sulfur"}, {kind: "block"}, {kind: "cut", item: "advanced-circuit"}],
        limit: "the sample's scaffold holds one block, the job's one copy; abucnasty's whole build (5.5 copies of it, 240 a second) is not built from ruling 60's start: its staged start "
            + "refuses the build (\"The clock names inserters 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 of the config, which match no inserter of the build in copy 6 of 6\": the partial copy "
            + "holds some of the config's inserters, and the staged start's wiring check does not take that into account)",
        start: "backpressure",
    },
    {
        name: "chemical-science-240-shared-foundry-backed-up", job: "variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP", config: "CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", copies: 1,
        variant: config => withUnstatedLaneEnds(config, "dead_end"),
        losses: [{kind: "cut", item: "sulfur"}, {kind: "block"}, {kind: "cut", item: "advanced-circuit"}],
        limit: "the sample's scaffold holds one block, the job's one copy; abucnasty's whole build (5.5 copies of it, 240 a second) is not built from ruling 60's start: its staged start "
            + "refuses the build (\"The clock names inserters 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 of the config, which match no inserter of the build in copy 6 of 6\": the partial copy "
            + "holds some of the config's inserters, and the staged start's wiring check does not take that into account)",
        start: "backpressure",
    },
    {
        name: "military-science-240", job: "config-MILITARY_SCIENCE_240", config: "MILITARY_SCIENCE_240", copies: 5,
        losses: [{kind: "cut", item: "stone-wall"}, {kind: "block"}, {kind: "cut", item: "coal"}],
        start: "backpressure",
    },
];
