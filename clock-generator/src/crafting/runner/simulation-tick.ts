import { ControlLogic, MutableTickProvider } from "../../control-logic";
import { SimulationContext } from "../sequence/simulation-context";

/**
 * One tick of a simulation as a CompositeControlLogic of the tick, the drills, the inserter updates and the machines
 * runs it: the same order, with a loop of its own for each kind, so that each loop calls into one kind of state machine.
 */
export class SimulationTick implements ControlLogic {
    private readonly tick_provider: MutableTickProvider;
    private readonly drills: readonly ControlLogic[];
    private readonly inserters: ControlLogic;
    private readonly machines: readonly ControlLogic[];

    constructor(context: SimulationContext) {
        this.tick_provider = context.tick_provider;
        this.drills = [...context.drills];
        this.inserters = context.inserterUpdates();
        this.machines = [...context.machines];
    }

    public executeForTick(): void {
        this.tick_provider.incrementTick();
        const drills = this.drills;
        for (let index = 0; index < drills.length; index++) {
            drills[index].executeForTick();
        }
        this.inserters.executeForTick();
        const machines = this.machines;
        for (let index = 0; index < machines.length; index++) {
            machines[index].executeForTick();
        }
    }
}
