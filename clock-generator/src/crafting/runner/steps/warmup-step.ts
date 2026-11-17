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
        /** Stops early once the state at a window cycle boundary repeats an earlier boundary's: the run is periodic from there */
        private readonly steady_state?: { window_cycle_ticks: number; key: () => string },
        /** Told where each whole window cycle of the warm-up ends, to read what the build gave in it (the shadow of the tick ledger); it changes nothing */
        private readonly cycle_watch?: WindowCycleWatch,
    ) {
        this.simulation_tick = this.build()
    }

    /** Ticks actually simulated by the last execute() */
    public ticks_run = 0;

    /** Window cycles after which the state repeats, once the last execute() saw a window cycle boundary repeat an earlier one */
    public repeat_window_cycles: number | undefined = undefined;

    public execute(): void {
        const context = this.simulation_context
        const simulation_tick = this.simulation_tick;

        const start_tick = context.tick_provider.getCurrentTick();
        const end_tick = start_tick + this.duration.ticks;
        const ledger = beginTickLoop("warmup_step", () => context.tick_provider.getCurrentTick() - start_tick);
        const boundary_by_key = new Map<string, number>();
        this.repeat_window_cycles = undefined;
        const cycle_watch = this.cycle_watch;
        let next_cycle_end = cycle_watch === undefined ? Infinity : start_tick + cycle_watch.window_cycle_ticks;

        while (true) {
            const current_tick = context.tick_provider.getCurrentTick();
            if (current_tick === next_cycle_end) {
                cycle_watch!.cycle_ended();
                next_cycle_end += cycle_watch!.window_cycle_ticks;
            }
            if (current_tick >= end_tick) {
                break;
            }
            if (this.steady_state && (current_tick - start_tick) % this.steady_state.window_cycle_ticks === 0) {
                // the state repeats every `cycle` window cycles, so stop where the full warmup would end in the same state
                const boundary = (current_tick - start_tick) / this.steady_state.window_cycle_ticks;
                const last_boundary = this.duration.ticks / this.steady_state.window_cycle_ticks;
                const key = this.steady_state.key();
                const earlier = boundary_by_key.get(key);
                if (earlier !== undefined) {
                    this.repeat_window_cycles ??= boundary - earlier;
                }
                if (earlier !== undefined && (last_boundary - boundary) % (boundary - earlier) === 0) {
                    break;
                }
                boundary_by_key.set(key, boundary);
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