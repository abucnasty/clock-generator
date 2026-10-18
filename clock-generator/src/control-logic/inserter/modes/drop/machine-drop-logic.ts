import assert from "../../../../common/assert";
import { MachineState, InserterState } from "../../../../state";
import { InserterTransferLogic } from "../transfer-logic";
import { removeFromHand } from "../transfer-helpers";

export class MachineDropLogic implements InserterTransferLogic {
    private current_tick = 0;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: MachineState,
    ) {}

    public onEnter(): void {
        this.current_tick = 0;
    }

    public stateKey(): string {
        return String(this.current_tick);
    }

    public executeForTick(): void {
        this.dropOffToMachine(this.inserter_state, this.sink_entity_state);
        this.current_tick += 1;
    }

    private dropOffToMachine(inserter_state: InserterState, sink: MachineState): void {
        // dropping to a machine should take 1 tick
        const held_item = inserter_state.held_item;
        assert(
            held_item !== null,
            `${inserter_state.entity_id} Held item should not be null when dropping off to machine`
        );
        MachineState.insertItem(sink, held_item.item_name, held_item.quantity);
        removeFromHand(inserter_state, held_item.quantity);
    }
}
