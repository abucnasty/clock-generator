import { ControlLogic } from "../../control-logic";
import { runTick, TickTracer } from "../../simulation/tick-phases";
import { World } from "../../simulation/world";
import { SimulationContext } from "../sequence/simulation-context";

/**
 * One tick of a simulation: the phase table's tick, drills, inserters and machines (simulation/tick-phases.ts) over the
 * context's World, which is built once here, for every tick this runs.
 */
export class SimulationTick implements ControlLogic {
    private readonly world: World;

    constructor(context: SimulationContext, private readonly tracer: TickTracer | null = null) {
        this.world = World.of(context);
    }

    public executeForTick(): void {
        runTick(this.world, this.tracer);
    }
}
