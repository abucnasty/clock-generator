import { CompositeControlLogic, ControlLogic, TickControlLogic } from "../../../control-logic";
import { Duration } from "../../../data-types";
import { SimulationContext } from "../../sequence";
import { RunnerStep, RunnerStepType } from "./runner-step";

export class WarmupStep implements RunnerStep {
    public readonly type: RunnerStepType = RunnerStepType.WARM_UP
    
    private readonly control_logic: ControlLogic;

    constructor(
        private readonly simulation_context: SimulationContext,
        private readonly duration: Duration,
        /** Stops early once the state at a period boundary repeats an earlier boundary's: the run is periodic from there */
        private readonly steady_state?: { period_ticks: number; key: () => string },
    ) {
        this.control_logic = this.build()
    }

    /** Ticks actually simulated by the last execute() */
    public ticks_run = 0;

    public execute(): void {
        const context = this.simulation_context
        const control_logic = this.control_logic;

        const start_tick = context.tick_provider.getCurrentTick();
        const end_tick = start_tick + this.duration.ticks;
        const boundary_by_key = new Map<string, number>();

        while (true) {
            const current_tick = context.tick_provider.getCurrentTick();
            if (current_tick >= end_tick) {
                break;
            }
            if (this.steady_state && (current_tick - start_tick) % this.steady_state.period_ticks === 0) {
                // the state repeats every `cycle` periods, so stop where the full warmup would end in the same state
                const boundary = (current_tick - start_tick) / this.steady_state.period_ticks;
                const last_boundary = this.duration.ticks / this.steady_state.period_ticks;
                const key = this.steady_state.key();
                const earlier = boundary_by_key.get(key);
                if (earlier !== undefined && (last_boundary - boundary) % (boundary - earlier) === 0) {
                    break;
                }
                boundary_by_key.set(key, boundary);
            }
            control_logic.executeForTick();
        }
        this.ticks_run = context.tick_provider.getCurrentTick() - start_tick;
    }

    private build(): ControlLogic {
        const context = this.simulation_context
        const tick_control_logic = new TickControlLogic(context.tick_provider);

        const control_logic = new CompositeControlLogic(
            [
                tick_control_logic,
                ...context.drills,
                ...context.inserters,
                ...context.machines,
            ]
        )

        return control_logic;
    }
}