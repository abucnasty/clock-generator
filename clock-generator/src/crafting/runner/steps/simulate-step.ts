import { CompositeControlLogic, ControlLogic, TickControlLogic } from "../../../control-logic";
import { Duration } from "../../../data-types";
import { SimulationContext } from "../../sequence";
import { RunnerStep, RunnerStepType } from "./runner-step";

export class SimulateStep implements RunnerStep {
    public readonly type: RunnerStepType = RunnerStepType.SIMULATE
    
    private readonly control_logic: ControlLogic;

    constructor(
        private readonly simulation_context: SimulationContext,
        private readonly duration: Duration
    ) {
        this.control_logic = this.build()
    }

    public execute(): void {
        console.log("Executing Simulate Step");
        const context = this.simulation_context
        const control_logic = this.control_logic;

        const start_tick = context.tick_provider.getCurrentTick();
        const end_tick = start_tick + this.duration.ticks;

        while (true) {
            const current_tick = context.tick_provider.getCurrentTick();
            if (current_tick >= end_tick) {
                break;
            }
            control_logic.executeForTick();
        }
        
        console.log(`Simulation complete: ${this.duration.ticks} ticks`);
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
