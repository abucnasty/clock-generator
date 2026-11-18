import { SimulationTick } from "../simulation-tick";
import { Duration } from "../../../data-types";
import { SimulationContext } from "../../sequence";
import { RunnerStep, RunnerStepType } from "./runner-step";
import { beginTickLoop, type WindowCycleWatch } from "../../tick-ledger";

export class WarmupStep implements RunnerStep {
    public readonly type: RunnerStepType = RunnerStepType.WARM_UP

    private readonly simulation_tick: SimulationTick;

    constructor(
        private readonly simulation_context: SimulationContext,
        private readonly duration: Duration,
        /**
         * Stops early once the state at a boundary repeats an earlier boundary's: the run is periodic from there. The
         * boundaries are `bin_ticks` apart from the start; those before `keyed_from_ticks` are not keyed (`WarmUpRepeat`).
         */
        private readonly steady_state?: { bin_ticks: number; key: () => string; keyed_from_ticks?: number },
        /** Told where each whole window cycle of the warm-up ends, to read what the build gave in it (the shadow of the tick ledger); it changes nothing */
        private readonly cycle_watch?: WindowCycleWatch,
    ) {
        this.simulation_tick = this.build()
    }

    /** Ticks actually simulated by the last execute() */
    public ticks_run = 0;

    /** Ticks after which the state repeats, once the last execute() saw a boundary repeat an earlier one */
    public repeat_ticks: number | undefined = undefined;

    public execute(): void {
        const context = this.simulation_context
        const simulation_tick = this.simulation_tick;

        const start_tick = context.tick_provider.getCurrentTick();
        const end_tick = start_tick + this.duration.ticks;
        const ledger = beginTickLoop("warmup_step", () => context.tick_provider.getCurrentTick() - start_tick);
        const boundary_by_key = new Map<string, number>();
        this.repeat_ticks = undefined;
        const cycle_watch = this.cycle_watch;
        let next_cycle_end = cycle_watch === undefined ? Infinity : start_tick + cycle_watch.window_cycle_ticks;
        // the ticks the full warm-up runs: up to the first whole tick at or past its end
        const full_ticks = ticksUntil(start_tick, end_tick);
        // where the run, repeating from a boundary, stands as the full warm-up would end
        let stop_at = Infinity;

        while (true) {
            const current_tick = context.tick_provider.getCurrentTick();
            if (current_tick === next_cycle_end) {
                cycle_watch!.cycle_ended();
                next_cycle_end += cycle_watch!.window_cycle_ticks;
            }
            const ticks = current_tick - start_tick;
            if (current_tick >= end_tick || ticks === stop_at) {
                break;
            }
            const steady_state = this.steady_state;
            if (steady_state && stop_at === Infinity && ticks >= (steady_state.keyed_from_ticks ?? 0) && ticks % steady_state.bin_ticks === 0) {
                const key = steady_state.key();
                const earlier = boundary_by_key.get(key);
                if (earlier !== undefined) {
                    // the state repeats every `repeat_ticks` from here on, so the full warm-up ends in the state of the
                    // tick a whole number of repeats before its end: stop there
                    this.repeat_ticks = ticks - earlier;
                    stop_at = ticks + (full_ticks - ticks) % this.repeat_ticks;
                    if (stop_at === ticks) {
                        break;
                    }
                } else {
                    boundary_by_key.set(key, ticks);
                }
            }
            simulation_tick.executeForTick();
        }
        this.ticks_run = context.tick_provider.getCurrentTick() - start_tick;
        ledger?.close();
    }

    private build(): SimulationTick {
        return new SimulationTick(this.simulation_context);
    }
}

/** The whole ticks from a whole start tick to the first tick at or past `end_tick`, as the warm-up's loop counts them */
function ticksUntil(start_tick: number, end_tick: number): number {
    let ticks = Math.max(0, Math.ceil(end_tick - start_tick));
    while (ticks > 0 && start_tick + ticks - 1 >= end_tick) ticks--;
    while (start_tick + ticks < end_tick) ticks++;
    return ticks;
}
