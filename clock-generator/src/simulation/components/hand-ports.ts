import assert from "../../common/assert";
import type { TickProvider } from "../../control-logic/current-tick-provider";
import { EntityState } from "../../state/entity-state";
import type { InserterState } from "../../state/inserter-state";
import { BeltHandDrop } from "./belt-hand-drop";
import { BeltHandPickup } from "./belt-hand-pickup";
import { ContainerHandDrop } from "./container-hand-drop";
import { ContainerHandPickup, MixedContainerHandPickup } from "./container-hand-pickup";
import { ContainerStorage } from "./container-storage";
import { CarriedItems, HandDropPort, HandPickupPort, HandScratch } from "./hand";
import { MachineHandDrop } from "./machine-hand-drop";
import { MachineHandPickup } from "./machine-hand-pickup";

/** What a hand's ports are bound to */
export interface HandPortArgs {
    inserterState: InserterState;
    sourceState: EntityState;
    sinkState: EntityState;
    /** The simulation's ticks: a belt's ports need them */
    tick_provider?: TickProvider;
    /** Where the decider of the inserter's clock of the game stands in the order they are built, when known */
    decider_build_order?: number;
}

/** A hand's source's pickup port and its sink's drop port, bound to the hand, with one scratch record between them */
export interface HandPorts {
    pickup: HandPickupPort;
    drop: HandDropPort;
}

/**
 * Binds a hand to its source's pickup port and its sink's drop port, each by its archetype (a TransportBelt's lanes, a
 * CraftingMachine's output and Ingress, a Container's storage), with a fresh scratch record: once per state machine, so
 * a control swap starts the hand's scratch afresh (same-tick rule 12). The drop port is bound first, as the pickup asks
 * it whether the sink takes an item; the source's kind is checked first all the same.
 */
export function bindHandPorts(args: HandPortArgs): HandPorts {
    const { inserterState: state, sourceState: source, sinkState: sink, tick_provider, decider_build_order } = args;
    if (!EntityState.isBelt(source) && !EntityState.isMachine(source) && !ContainerStorage.is(source)) {
        throw new Error(`Unsupported inserter pickup source: ${source.entity_id.type}`);
    }
    const scratch = new HandScratch();
    const items = new CarriedItems(state.inserter);
    const drop = bindDrop(state, scratch, items, sink, tick_provider);
    let pickup: HandPickupPort;
    if (EntityState.isBelt(source)) {
        pickup = new BeltHandPickup(state, scratch, items, drop, source, EntityState.isMachine(sink) ? sink.wakes : null, tick_provider);
    } else if (EntityState.isMachine(source)) {
        pickup = new MachineHandPickup(state, scratch, items, drop, source, decider_build_order);
    } else if (ContainerStorage.isMixed(source)) {
        pickup = new MixedContainerHandPickup(state, scratch, items, drop, source);
    } else {
        pickup = new ContainerHandPickup(state, scratch, items, drop, source);
    }
    return { pickup, drop };
}

function bindDrop(state: InserterState, scratch: HandScratch, items: CarriedItems, sink: EntityState, tick_provider?: TickProvider): HandDropPort {
    if (EntityState.isBelt(sink)) {
        assert(tick_provider !== undefined, "Belt drops need the simulation tick provider");
        return new BeltHandDrop(state, sink, tick_provider);
    }
    if (EntityState.isMachine(sink)) {
        return new MachineHandDrop(state, scratch, items, sink.ingress);
    }
    if (ContainerStorage.is(sink)) {
        return new ContainerHandDrop(state, scratch, items, sink);
    }
    throw new Error(`Unsupported inserter drop sink: ${sink.entity_id.type}`);
}
