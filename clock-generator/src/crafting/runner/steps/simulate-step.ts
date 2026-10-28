import { ControlLogic } from "../../../control-logic";
import { SimulationTick } from "../simulation-tick";
import { AfterTickStep, NO_ENTITY, TickPhase, TickTracer } from "../../../simulation/tick-phases";
import type { TickRecorder } from "../../../simulation/observers/observer";
import { Duration } from "../../../data-types";
import { SimulationContext } from "../../sequence";
import { RunnerStep, RunnerStepType } from "./runner-step";

export class SimulateStep implements RunnerStep {
    public readonly type: RunnerStepType = RunnerStepType.SIMULATE

    private readonly control_logic: ControlLogic;

    constructor(
        private readonly simulation_context: SimulationContext,
        private readonly duration: Duration,
        /** The after-tick phase's recorders, told after every simulated tick in this order */
        private readonly recorders: readonly TickRecorder[] = [],
        /** Asked after every simulated tick (after the recorders); the step stops early when it answers true */
        private readonly stop_early?: () => boolean,
        /** Told of every step of every tick, the after-tick phase's included (a test of the phase table) */
        private readonly tracer: TickTracer | null = null,
    ) {
        this.control_logic = this.build()
    }

    /** Ticks actually simulated by the last execute(): the duration, or less when `stop_early` ended the run */
    public ticks_run = 0;

    public execute(): void {
        const context = this.simulation_context
        const control_logic = this.control_logic;
        const recorders = this.recorders;
        const tracer = this.tracer;

        const start_tick = context.tick_provider.getCurrentTick();
        const end_tick = start_tick + this.duration.ticks;

        while (true) {
            const current_tick = context.tick_provider.getCurrentTick();
            if (current_tick >= end_tick) {
                break;
            }
            control_logic.executeForTick();
            // the phase table's after-tick phase (simulation/tick-phases.ts)
            if (tracer !== null) tracer.step(TickPhase.AFTER_TICK, NO_ENTITY, AfterTickStep.RECORDERS);
            for (let index = 0; index < recorders.length; index++) {
                recorders[index].record();
            }
            if (tracer !== null) tracer.step(TickPhase.AFTER_TICK, NO_ENTITY, AfterTickStep.STOP_EARLY);
            if (this.stop_early?.() === true) {
                break;
            }
        }
        this.ticks_run = context.tick_provider.getCurrentTick() - start_tick;
    }

    private build(): ControlLogic {
        return new SimulationTick(this.simulation_context, this.tracer);
    }
}
