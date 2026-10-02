import { Duration, OpenRange } from "../../../data-types";
import { MachineState, MachineStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { MachineMode, MachineWorkingMode } from "../modes";

export interface CraftEventListenerArgs {
    readonly craft_index: number,
    readonly state: Readonly<MachineState>
    readonly craft_ticks: OpenRange
}
export type CraftEventListener = (args: CraftEventListenerArgs) => void;

export class CraftEventListenerPlugin implements ModePlugin<MachineMode> {
    constructor(
        private readonly machine_state: MachineState,
        private readonly tick_provider: TickProvider,
        private readonly onCraftEvent: CraftEventListener,
    ) { }

    private craft_index = 0;

    private readonly craft_duration = Duration.ofTicks(
        this.machine_state.machine.crafting_rate.ticks_per_craft
    )

    private last_craft_tick: number = 0;

    onTransition(fromMode: MachineMode, transition: Transition<MachineMode>): void {
        if (transition.toMode.status === MachineStatus.WORKING) {
            this.last_craft_tick = this.tick_provider.getCurrentTick();
        }
    }

    executeForTick(): void {
        if (this.machine_state.craftCount > this.craft_index) {
            const current_tick = this.tick_provider.getCurrentTick();
            const machine_state = this.machine_state;
            let snapshot: MachineState | undefined;
            this.onCraftEvent({
                craft_index: this.craft_index,
                // cloned only when a listener reads it
                get state() {
                    return snapshot ??= MachineState.clone(machine_state);
                },
                craft_ticks: OpenRange.from(
                    this.last_craft_tick,
                    current_tick
                ),
            });
            this.craft_index = this.machine_state.craftCount;
            this.last_craft_tick = current_tick;
        }
    }
}