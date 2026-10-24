import assert from "../common/assert";
import { Config } from "../config";
import { Logger } from "../common/logger";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { ClockAlternative, ClockAlternativesResult, generateClockAlternatives } from "./alternatives";
import { StockRecording } from "./machine-stock";
import { runBuild } from "./plan/plan-run";
import { removedBetween, RuleRemoval } from "./rule-call";
import { ruleCount, RuleCountRun } from "./rule-count";
import { ruleCountInputOfStock } from "./rule-count-stock";
import { FREE_RUNNING_CHECK_TICKS, longRunPeriodsOf, LOOP_WINDOW_CHECK_TICKS, runClockOnBuild } from "./trial";
import { LONG_RUN_SETTLE_SHARE } from "./long-run";
import { wakeUpsOfStock } from "./wake-ups";
import { Entity, EntityId } from "../entities";
import { OpenRange } from "../data-types";

/**
 * The rule of the inserter cost series applied to a build and its clock (see rule-count.ts and rule-call.ts), worked
 * out on demand. It runs the build twice more in the simulator, so nothing that generates clocks calls it.
 */

const quiet: Logger = { log() { }, warn() { }, error() { }, debug() { } };

export interface RuleCallsOfClock {
    clock: { id: string; label: string; verdict: string; period_ticks: number };
    /** The ticks both runs are counted over: from a third of the clocked long run to its end, as its wake-ups are */
    from_tick: number;
    to_tick: number;
    /** The build with every inserter and drill always enabled, none of them wired */
    unwired_run: RuleCountRun;
    /** The build on the clock; wired are the inserters the clock gives windows */
    clocked_run: RuleCountRun;
    /** The removal per group, the pooled figure, and the calls, in true starts: the call */
    removal: RuleRemoval;
    /** The same on the series' original count, for comparison */
    removal_original: RuleRemoval;
    /**
     * Goal 2's count (`wakeUps`, unchanged) of the clocked stock here, against the one the generator's long run made
     * for the clock: equal when this run is the same run
     */
    clocked_wake_ups_per_minute: { here: number; long_run: number };
}

/**
 * The clocked run: the build on the clock's windows alone, as long as its long run and over the same ticks. A long
 * run stops where its state repeats and is judged on the repeating cycle (see longRunOfFreeRunningBuild), so the run
 * is made with the same repeat detection and `from_tick` is where its judged bins start.
 */
function clockedStockOf(config: Config, selected: ClockAlternative, logger: Logger): { stock: StockRecording; from_tick: number } {
    const result = selected.result;
    const period = result.simulation_duration.ticks;
    const long_run = result.stability_check.as_built?.wake_ups;
    assert(long_run !== undefined, `The selected clock (${selected.id}, ${selected.verdict}) has no long-run wake-up count: its check failed `
        + "before the long run, or the period is too long for one");
    const windows = new Map(Object.entries(result.clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    // the long run is the standard length, or twice that for a clock with the windows of a loop (LOOP_WINDOW_CHECK_TICKS);
    // the one that gives the ticks the long run counted is the one the generator ran
    const tried = new Set<number>();
    for (const check_ticks of [FREE_RUNNING_CHECK_TICKS, LOOP_WINDOW_CHECK_TICKS]) {
        const periods = longRunPeriodsOf(period, check_ticks);
        if (periods <= 1 || tried.has(periods)) {
            continue;
        }
        tried.add(periods);
        const run = runClockOnBuild({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, windows, period, logger,
            { simulate_periods: periods, machine_stock: true, factorio_states: false, detect_repeat: true });
        const stock = run.machine_stock;
        assert(stock !== undefined, "The run recorded no stock");
        // wakeUps counts from tick 1 at the earliest (the first tick has no change to read), as the generator's did
        const from_tick = Math.max(1, run.state_repeat !== undefined
            ? run.state_repeat.from_bin * run.state_repeat.bin_ticks
            : Math.floor(stock.ticks / LONG_RUN_SETTLE_SHARE));
        if (stock.ticks - from_tick === long_run.ticks) {
            return { stock, from_tick };
        }
    }
    throw new Error(`No long run of the clock ${selected.id} (period ${period}) counts ${long_run.ticks} ticks; tried periods ${[...tried].join(", ")}`);
}

/** The build with every inserter and drill always enabled, at least `ticks` ticks of it recorded */
function unwiredStockOf(config: Config, period: number, ticks: number, logger: Logger): StockRecording {
    const always = { mode: "ALWAYS" } as const;
    const unclocked = {
        ...config,
        overrides: { ...config.overrides, derive_clock_windows: false },
        inserters: config.inserters.map(it => ({ ...it, overrides: { ...it.overrides, enable_control: always } })),
        drills: config.drills === undefined ? undefined : {
            ...config.drills,
            configs: config.drills.configs.map(d => ({ ...d, overrides: { ...d.overrides, enable_control: always } })),
        },
    };
    // the plan's own period is not known here, so ask for enough periods of the clock's length and ask again if short
    let periods = Math.ceil(ticks / period) + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
        const stock = runBuild(unclocked, { logger, simulate_periods: periods, machine_stock: true, factorio_states: false }).machine_stock;
        assert(stock !== undefined, "The run recorded no stock");
        if (stock.ticks >= ticks) {
            return stock;
        }
        periods = Math.ceil(periods * ticks / Math.max(1, stock.ticks)) + 1;
    }
    throw new Error(`The unwired run is shorter than the ${ticks} ticks of the clock's long run`);
}

/**
 * The rule's removal and calls for a clock that was generated for the config: the clocked long run and the same
 * build with every inserter and drill always enabled, both counted over the ticks the clocked long run counts its
 * wake-ups over. The wired inserters of the clocked run are the ones the clock gives windows.
 *
 * The clocked run is not kept by the generator, so it is run again from the clock's windows (`simulateClockOnly`) for
 * as many periods as its long run lasts, and checked to count the same ticks and the same goal-2 wake-ups.
 */
export function ruleCallsOfClock(config: Config, selected: ClockAlternative, logger: Logger = quiet): RuleCallsOfClock {
    const result = selected.result;
    const period = result.simulation_duration.ticks;
    // the plan's output swings, as the clock was made with
    const planned = { ...config, overrides: { ...config.overrides, terminal_swing_count: result.used_terminal_swing_count } };
    const registry = createEntityRegistryFromConfig(planned);

    const { stock: clocked_stock, from_tick } = clockedStockOf(planned, selected, logger);
    const to_tick = clocked_stock.ticks;
    const unwired_stock = unwiredStockOf(planned, period, to_tick, logger);

    const clocked_input = ruleCountInputOfStock(clocked_stock, registry, id => (result.clock_windows[id]?.length ?? 0) > 0);
    const unwired_input = ruleCountInputOfStock(unwired_stock, registry, () => false);
    const clocked_run = ruleCount(clocked_input.inserters, clocked_input.machines, from_tick, to_tick);
    const unwired_run = ruleCount(unwired_input.inserters, unwired_input.machines, from_tick, to_tick);

    const ends = registry.getAll().filter(Entity.isInserter).map(inserter => ({
        inserter_id: inserter.entity_id.id,
        source_machine_id: EntityId.isMachine(inserter.source.entity_id) ? inserter.source.entity_id.id : null,
        sink_machine_id: EntityId.isMachine(inserter.sink.entity_id) ? inserter.sink.entity_id.id : null,
    }));
    return {
        clock: { id: selected.id, label: selected.label, verdict: selected.verdict, period_ticks: period },
        from_tick, to_tick, unwired_run, clocked_run,
        removal: removedBetween(unwired_run, clocked_run),
        removal_original: removedBetween(unwired_run, clocked_run, "original"),
        clocked_wake_ups_per_minute: {
            here: wakeUpsOfStock(clocked_stock, ends, from_tick).wake_ups_per_minute,
            long_run: result.stability_check.as_built!.wake_ups!.wake_ups_per_minute,
        },
    };
}

/**
 * The rule's removal and calls for a build: generates the clock alternatives as the generator does (defaults, or the
 * alternatives already made, if given), takes the selected clock, and works out `ruleCallsOfClock` for it. On demand
 * only: generation itself never calls this, so it costs generation no time.
 */
export function ruleCallsOfSample(
    config: Config,
    options: { logger?: Logger; alternatives?: ClockAlternativesResult } = {},
): RuleCallsOfClock {
    const logger = options.logger ?? quiet;
    const { alternatives, selected_index } = options.alternatives ?? generateClockAlternatives(config, { logger });
    return ruleCallsOfClock(config, alternatives[selected_index], logger);
}
