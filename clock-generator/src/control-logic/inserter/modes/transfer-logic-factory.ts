import { EntityState, InserterState } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { InserterTransferLogic } from "./transfer-logic";
import { BeltPickupLogic } from "./pickup/belt-pickup-logic";
import { MachinePickupLogic } from "./pickup/machine-pickup-logic";
import { ChestPickupLogic } from "./pickup/chest-pickup-logic";
import { BeltDropLogic } from "./drop/belt-drop-logic";
import { MachineDropLogic } from "./drop/machine-drop-logic";
import { ChestDropLogic } from "./drop/chest-drop-logic";

export interface InserterPickupLogicArgs {
    inserterState: InserterState;
    sourceState: EntityState;
    sinkState: EntityState;
    /** Required for timed belt stock; also lets machine output takers share turns. */
    tick_provider?: TickProvider;
    /** Where the decider of the inserter's clock of the game stands in the order they are built, when known */
    decider_build_order?: number;
}

function createPickup(args: InserterPickupLogicArgs): InserterTransferLogic {
    const { inserterState, sourceState, sinkState, tick_provider, decider_build_order } = args;
    if (EntityState.isBelt(sourceState)) {
        return new BeltPickupLogic(inserterState, sourceState, sinkState, tick_provider);
    }
    if (EntityState.isMachine(sourceState)) {
        return new MachinePickupLogic(inserterState, sourceState, sinkState, tick_provider, decider_build_order);
    }
    if (EntityState.isChest(sourceState)) {
        return new ChestPickupLogic(inserterState, sourceState, sinkState);
    }
    throw new Error(`Unsupported inserter pickup source: ${sourceState.entity_id.type}`);
}

function createDrop(args: {
    inserterState: InserterState;
    sinkState: EntityState;
    tick_provider: TickProvider;
}): InserterTransferLogic {
    const { inserterState, sinkState, tick_provider } = args;
    if (EntityState.isBelt(sinkState)) {
        return new BeltDropLogic(inserterState, sinkState, tick_provider);
    }
    if (EntityState.isMachine(sinkState)) {
        return new MachineDropLogic(inserterState, sinkState);
    }
    if (EntityState.isChest(sinkState)) {
        return new ChestDropLogic(inserterState, sinkState);
    }
    throw new Error(`Unsupported inserter drop sink: ${sinkState.entity_id.type}`);
}

/** Source and sink independently select the two transfer implementations for this inserter. */
function create(args: InserterPickupLogicArgs & { tick_provider: TickProvider }): {
    pickup: InserterTransferLogic;
    drop: InserterTransferLogic;
} {
    return { pickup: createPickup(args), drop: createDrop(args) };
}

export const InserterTransferLogicFactory = { create, createPickup };
