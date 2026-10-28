import type { TickProvider } from "../current-tick-provider";
import { OpenRange } from "../../data-types";
import { MachineState } from "../../state";
import { CraftingStatus } from "../status-codes";
import type { CraftingMachineObserver } from "./observer";

interface CraftEvent {
    readonly craft_index: number,
    readonly state: Readonly<MachineState>
    readonly craft_ticks: OpenRange
}
type OnCraftEvent = (event: CraftEvent) => void;

/**
 * Tells of each tick a machine finished crafts in (the debug log): how many it had finished before, the ticks since its
 * last such tick or since it started working, and the machine as it is then (copied only when the listener reads it)
 */
export class CraftEventListener implements CraftingMachineObserver {
    constructor(
        private readonly machine_state: MachineState,
        private readonly tick_provider: TickProvider,
        private readonly onCraftEvent: OnCraftEvent,
    ) { }

    private craft_index = 0;

    private last_craft_tick: number = 0;

    public onStatusChange(from: CraftingStatus, to: CraftingStatus): void {
        if (to === CraftingStatus.WORKING) {
            this.last_craft_tick = this.tick_provider.getCurrentTick();
        }
    }

    public onTick(): void {
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
