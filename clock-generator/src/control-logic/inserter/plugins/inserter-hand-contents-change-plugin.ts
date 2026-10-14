import { InserterHandContents, InserterState } from "../../../state";
import { ModePlugin, Transition } from "../../mode";
import { InserterMode } from "../modes";

type OnHandContentsChanged = (previousHeldItem: InserterHandContents | null, currentHeldItem: InserterHandContents | null) => void;

export class InserterHandContentsChangePlugin implements ModePlugin<InserterMode> {

    constructor(
        private readonly inserter_state: InserterState,
        private readonly onHandContentsChanged: OnHandContentsChanged
    ) {}

    private previous: InserterHandContents | null = null;

    public onTransition(fromMode: InserterMode, transition: Transition<InserterMode>): void {}
    
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