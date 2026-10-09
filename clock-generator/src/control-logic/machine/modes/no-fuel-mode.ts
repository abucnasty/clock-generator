import { MachineStatus } from "../../../state";
import { MachineMode } from "./machine-mode";

/** A burner machine with nothing to burn: it makes no progress, whatever its ingredients and output hold */
export class MachineNoFuelMode implements MachineMode {
    public readonly status = MachineStatus.NO_FUEL;

    public onEnter(fromMode: MachineMode): void {}

    public onExit(toMode: MachineMode): void {}

    public executeForTick(): void {}
}
