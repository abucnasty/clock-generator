import type { CraftingMachineArchetype } from "../../simulation/archetypes/crafting-machine";
import type { InserterArchetype } from "../../simulation/archetypes/inserter";
import type { MiningDrillArchetype } from "../../simulation/archetypes/mining-drill";
import { inserterUpdateOrder } from "../../simulation/competing-takers";
import { SimulationContext } from "../sequence/simulation-context";

/**
 * One tick of a context as the tests that tick it by hand have always run it, which is not the phase table's order
 * (`SimulationTick`, simulation/tick-phases.ts: drills, inserters, machines): the tick counted, then every machine, then
 * the inserters in the order of `inserterUpdateOrder`, then, where asked for, the drills, each through its archetype's
 * `executeForTick()`. For tests and game-test helpers that were written against this order and hold figures read in it;
 * a test of what ships ticks with `SimulationTick`.
 */
export class TickByHand {
    private readonly machines: readonly CraftingMachineArchetype[];
    private readonly inserters: readonly InserterArchetype[];
    private readonly drills: readonly MiningDrillArchetype[];

    constructor(
        private readonly context: SimulationContext,
        /** Which of the context's machines and drills are ticked; the inserters always are */
        kinds: { machines?: boolean; drills?: boolean } = {},
    ) {
        const { machines = true, drills = false } = kinds;
        this.machines = machines ? context.machines : [];
        this.inserters = inserterUpdateOrder(context.inserters, context.state_registry, context.competing_takers_order);
        this.drills = drills ? context.drills : [];
    }

    public executeForTick(): void {
        this.context.tick_provider.incrementTick();
        for (const machine of this.machines) machine.executeForTick();
        for (const inserter of this.inserters) inserter.executeForTick();
        for (const drill of this.drills) drill.executeForTick();
    }
}
