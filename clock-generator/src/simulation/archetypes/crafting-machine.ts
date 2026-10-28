import type { ControlLogic } from "../../control-logic/control-logic";
import { EntityState } from "../../state/entity-state";
import type { MachineState } from "../../state/machine-state";
import type { ContainerStorage } from "../components/container-storage";
import type { Crafting } from "../components/crafting";
import type { Ingress } from "../components/ingress";
import type { MachineWakes } from "../components/machine-wakes";
import { MachinePlacementPort } from "../components/machine-placement-port";
import type { Placement } from "../components/placement";
import type { Yield } from "../components/yield";
import { Observers, StatusChangeReason } from "../observers/observer";
import { CraftingStatus, machineStatusOf } from "../status-codes";

/**
 * A crafting machine in a run: its state (`MachineState`: Storage, Ingress, Energy, Crafting, Yield, Placement and
 * Wakes, which the build's context keeps through control swaps), the target it places its results into, and its
 * observers. A tick runs its steps in the phase table's order (simulation/tick-phases.ts): what waits in the output
 * into the result target, held products into the output, the status rule, the status's step (a working machine
 * crafts), the target again (so a tick's crafts reach it in that tick), then the Wakes and the tick's observers.
 *
 * What watches it is told at the phase table's two event points of a machine: a change of status in its status rule,
 * after the status is written and before it crafts in that tick (same-tick rule 17), with the machine to answer the
 * reason; and its tick after its Wakes (rules 1 and 3). Observers own nothing a later tick of it reads.
 *
 * Built once for a machine when its context is built; a control swap leaves it as it is
 * (`SimulationContext.useControls` swaps the controls of inserters and drills only), with its status, observers and
 * Wakes. One archetype per MachineState: the state's Wakes count the crafts seen from the archetype's build on
 * (`MachineWakes.watchFrom`), so a second archetype built over the same state and ticked would share and reset that
 * count.
 */
export class CraftingMachineArchetype implements ControlLogic, StatusChangeReason<CraftingStatus> {

    /**
     * The machine with its Placement bound to its result target, if it has one: into a machine up to the drill's stop
     * through the machine's placement port, into a container through the container's own port. Results put into its own
     * output count as placed with no target or a machine target, not with a container.
     */
    public static create(args: {
        machine_state: MachineState,
        /** The container or machine it places its results into, where it has a result target */
        result_target_state?: ContainerStorage | MachineState,
    }): CraftingMachineArchetype {
        const { machine_state } = args;
        const result_target = args.result_target_state ?? null;
        const target_is_machine = result_target !== null && EntityState.isMachine(result_target);
        machine_state.placement.placeInto(target_is_machine
            ? new MachinePlacementPort(result_target, machine_state.machine.outputs.map(output => output.item_name))
            : result_target, result_target === null || target_is_machine);
        return new CraftingMachineArchetype(machine_state, result_target);
    }

    private readonly crafting: Crafting;
    private readonly made: Yield;
    private readonly placement: Placement;
    private readonly ingress: Ingress;
    private readonly wakes: MachineWakes;
    /** What watches it (histories, the Factorio state, craft events, debug output), by event in the order added */
    public readonly observers = new Observers<CraftingStatus>();

    private constructor(
        public readonly machine_state: MachineState,
        /** Where it places its results, named by a full output's reason; null for none */
        private readonly result_target: ContainerStorage | MachineState | null,
    ) {
        this.crafting = machine_state.crafting;
        this.made = machine_state.yield;
        this.placement = machine_state.placement;
        this.ingress = machine_state.ingress;
        this.wakes = machine_state.wakes;
        // the Wakes count the crafts finished and started from the machine's build on
        this.wakes.watchFrom(this.crafting);
    }

    /**
     * What waits in the output into the result target, where the machine places its results itself: before it crafts
     * and again after, so that what a tick's crafts give is in the target when the tick ends (recorded on the recycler)
     */
    public placeResults(): void {
        this.placement.place();
    }

    /** Products the machine holds into its output, as far as there is room, whatever its status */
    public putHeldProductsInOutput(): void {
        this.made.putHeldProductsInOutput(this.crafting);
    }

    /** The status rule (same-tick rule 13); on a change, the status written, then the observers told (rule 17) */
    public statusRule(): void {
        const crafting = this.crafting;
        const from = crafting.status;
        const to = crafting.statusRule();
        if (to !== from) {
            this.changeStatus(from, to);
        }
    }

    /** The status's step: a working machine's tick of crafting; out of fuel, short of ingredients or full it does nothing */
    public statusStep(): void {
        if (this.crafting.status === CraftingStatus.WORKING) {
            this.crafting.tick();
        }
    }

    /**
     * After the machine's tick: its Wakes (the flags the inserters read in the next tick and the decider cleared, rules
     * 1 and 3), then the observers that do something every tick, in the order they were added
     */
    public endOfTick(): void {
        this.wakes.endOfTick(this.crafting, this.ingress);
        this.observers.tellTick();
    }

    /** A whole tick of the machine, for callers that tick a context's entities by hand */
    public executeForTick(): void {
        this.placeResults();
        this.putHeldProductsInOutput();
        this.statusRule();
        this.statusStep();
        this.placeResults();
        this.endOfTick();
    }

    /**
     * The number of the reason of the change of status being told, from `from` to `to` (`Crafting.reasonOf`): a text
     * read off the output (a full output's, the drop under the block) is made here, when an observer that records it
     * asks, from the state the status rule read. Nothing it reads is written between the rule and the observers: the
     * status, written before them, is not read.
     */
    public reasonId(from: CraftingStatus, to: CraftingStatus): number {
        return this.crafting.reasonOf(from, to, this.result_target);
    }

    /**
     * Its status, with the text the machine's mode state machine gave it before (the status, then the empty keys of its
     * four modes and their evaluators); with its state's key (MachineState.stateKey), two equal keys one clock period
     * apart mean the machine repeats. Observers only watch.
     */
    public stateKey(): string {
        return `${machineStatusOf(this.crafting.status)}||||||||`;
    }

    /**
     * The status written first, then every observer told in the order added; a machine has no exit or enter steps. The
     * machine answers the reason (`reasonId`) for an observer that asks.
     */
    private changeStatus(from: CraftingStatus, to: CraftingStatus): void {
        this.crafting.status = to;
        this.observers.tellStatusChange(from, to, this);
    }
}
