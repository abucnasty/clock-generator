import { InserterStatus } from "../../../state";

/** Source- or sink-specific transfer behavior, composed into an inserter mode. */
export interface InserterTransferLogic {
    onEnter(from_status: InserterStatus): void;
    executeForTick(): void;
    stateKey(): string;
}
