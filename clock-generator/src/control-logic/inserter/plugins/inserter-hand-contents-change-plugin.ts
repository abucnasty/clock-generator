import { InserterHandContents, InserterState } from "../../../state";
import type { InserterObserver } from "../../../simulation/archetypes/inserter";

type OnHandContentsChanged = (previousHeldItem: InserterHandContents | null, currentHeldItem: InserterHandContents | null) => void;

export class InserterHandContentsChangePlugin implements InserterObserver {

    constructor(
        private readonly inserter_state: InserterState,
        private readonly onHandContentsChanged: OnHandContentsChanged
    ) {}

    private previous: InserterHandContents | null = null;

    public executeForTick(): void {

        const previous = this.previous;
        const current = this.current;

        if(previous?.item_name !== current?.item_name || previous?.quantity !== current?.quantity) {
            this.onHandContentsChanged(previous, current);
        }

        if (this.current) {
            this.previous = { ...this.current };
            return;
        }

        this.previous = null;
    }

    private get current() {
        return this.inserter_state.held_item;
    }
}
