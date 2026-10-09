import { InventoryTransfer } from "../../crafting/sequence/inventory-transfer";
import { OpenRange } from "../../data-types/open-range";
import {
    CircuitNetworkSelection,
    ComparatorString,
    CompareType,
    DeciderCombinatorCondition,
    ControlBehavior,
    ControlBehaviorBuilder,
    DeciderCombinatorConditionBuilder,
    DeciderCombinatorOutputBuilder,
    Direction,
    Entity,
    EntityType,
    Position,
    SignalId,
    DeciderCombinatorOutput,
    fitPlayerDescription,
} from "../components";


export interface DeciderCombinatorEntity extends Entity {
    readonly name: EntityType;
    readonly position: Position;
    readonly control_behavior: ControlBehavior;
    readonly player_description?: string;
}

export class DeciderCombinatorEntityBuilder {
    private position: Position = Position.zero;
    private direction: Direction | undefined = undefined;
    private control_behavior: ControlBehavior = {};
    private player_description: string | undefined = undefined;

    public setPosition(position: Position): DeciderCombinatorEntityBuilder {
        this.position = position;
        return this;
    }

    public setDirection(direction: Direction): DeciderCombinatorEntityBuilder {
        this.direction = direction;
        return this;
    }

    public setControlBehavior(controlBehavior: ControlBehavior): DeciderCombinatorEntityBuilder {
        this.control_behavior = controlBehavior;
        return this;
    }

    public setPlayerDescription(description: string): DeciderCombinatorEntityBuilder {
        this.player_description = fitPlayerDescription(description.split("\n"));
        return this;
    }

    public setMultiLinePlayerDescription(description: string[]): DeciderCombinatorEntityBuilder {
        this.player_description = fitPlayerDescription(description);
        return this;
    }

    public build(): DeciderCombinatorEntity {
        return {
            name: EntityType.DECIDER_COMBINATOR,
            player_description: this.player_description,
            position: this.position,
            ...(this.direction !== undefined ? { direction: this.direction } : {}),
            control_behavior: this.control_behavior
        };
    }
}



/**
 * The counter of a clock that counts 1 to `period` on the clock signal, wired from its output back to its input:
 * while the count is below the period and the lock signal is off, it outputs the count plus 1; at the period, or
 * with the lock on, it outputs 1 (the else outputs). So the count is never 0, which is what a decider reads with
 * the clock switched off, and with the lock on it waits at 1.
 *
 * The signals in `derived` are counted from 1 as well: a modulo of the count adds a position to the network, and the
 * decider adds the 1 to it, in its outputs and its else outputs alike.
 */
function clock(
    period: number,
    /** The signal the clock counts on */
    clockSignalId: SignalId = SignalId.clock,
    /** The signals on the clock's network that count from 1 but are not counted by this combinator, such as modulos of the count */
    derived: SignalId[] = [],
): DeciderCombinatorEntityBuilder {

    const conditions = [
        new DeciderCombinatorConditionBuilder(clockSignalId)
            .setComparator(ComparatorString.LESS_THAN)
            .setConstant(period)
            .build(),
        lockIsOff(CompareType.AND),
    ]

    const startingAtOne = [clockSignalId, ...derived].map(signal => DeciderCombinatorOutput.constant(signal, 1));

    const outputs = [
        new DeciderCombinatorOutputBuilder(clockSignalId)
            .setCopyCountFromInput(true)
            .setNetworks(CircuitNetworkSelection.BOTH)
            .build(),
        ...startingAtOne,
    ]

    const controlBehavior = new ControlBehaviorBuilder()
        .setDeciderConditions(conditions)
        .setOutputs(outputs)
        .setElseOutputs(startingAtOne)
        .build()

    return new DeciderCombinatorEntityBuilder()
        .setPosition(Position.zero)
        .setControlBehavior(controlBehavior)

}

/** The condition that the lock signal is off: absent, as a switched-off constant combinator puts nothing out */
function lockIsOff(compareType?: CompareType): DeciderCombinatorCondition {
    const condition = new DeciderCombinatorConditionBuilder(SignalId.lock).setComparator(ComparatorString.EQUAL_TO);
    return (compareType ? condition.setCompareType(compareType) : condition).build();
}

/**
 * Passes every signal on its input while the lock signal is off, and nothing while it is on: what the combinators
 * wired to its output read is the clock only while the clock runs. It adds 1 to the signals in `starting_at_one`, for
 * a count that the combinators before it left 0-based, such as the subtick clock.
 */
function lockFilter(starting_at_one: SignalId[] = []): DeciderCombinatorEntityBuilder {
    const outputs = [
        new DeciderCombinatorOutputBuilder(SignalId.everything)
            .setCopyCountFromInput(true)
            .build(),
        ...starting_at_one.map(signal => DeciderCombinatorOutput.constant(signal, 1)),
    ]

    const controlBehavior = new ControlBehaviorBuilder()
        .setDeciderConditions([lockIsOff()])
        .setOutputs(outputs)
        .setElseOutputs([])
        .build()

    return new DeciderCombinatorEntityBuilder()
        .setPosition(Position.zero)
        .setControlBehavior(controlBehavior)
}

function fromRanges(
    inputSignal: SignalId,
    inputRanges: OpenRange[],
    outputSignals: SignalId[]
): DeciderCombinatorEntityBuilder {

    const conditions = inputRanges.flatMap(range => DeciderCombinatorCondition.fromOpenRange(range, inputSignal));

    const output_signals = outputSignals.map(signalId => DeciderCombinatorOutput.constant(signalId, 1));

    const controlBehavior = new ControlBehaviorBuilder()
        .setDeciderConditions(conditions)
        .setOutputs(output_signals)
        .build();


    return new DeciderCombinatorEntityBuilder()
        .setPosition(Position.zero)
        .setControlBehavior(controlBehavior)
}

function fromSignalRanges(
    inputs: { signal: SignalId; ranges: OpenRange[] }[],
    outputSignals: SignalId[]
): DeciderCombinatorEntityBuilder {
    const conditions = inputs.flatMap(({ signal, ranges }) =>
        ranges.flatMap(range => DeciderCombinatorCondition.fromOpenRange(range, signal)));

    const controlBehavior = new ControlBehaviorBuilder()
        .setDeciderConditions(conditions)
        .setOutputs(outputSignals.map(signalId => DeciderCombinatorOutput.constant(signalId, 1)))
        .build();

    return new DeciderCombinatorEntityBuilder()
        .setPosition(Position.zero)
        .setControlBehavior(controlBehavior)
}

function fromInventoryTransfers(
    clock_signal_id: SignalId,
    inventory_transfers: InventoryTransfer[]
): DeciderCombinatorEntityBuilder {
    const inputRanges = inventory_transfers.flatMap(transfer => DeciderCombinatorCondition.fromInserterTransfer(transfer, clock_signal_id));

    const output = new DeciderCombinatorOutputBuilder(SignalId.each)
        .setCopyCountFromInput(false)
        .setConstant(1)
        .setNetworks(CircuitNetworkSelection.RED)
        .build();
    
    const controlBehavior = new ControlBehaviorBuilder()
        .setDeciderConditions(inputRanges)
        .setOutputs([output])
        .build();

    return new DeciderCombinatorEntityBuilder()
        .setPosition(Position.zero)
        .setControlBehavior(controlBehavior)
}


export const DeciderCombinatorEntity = {
    clock: clock,
    lockFilter: lockFilter,
    fromRanges: fromRanges,
    fromSignalRanges: fromSignalRanges,
    fromInventoryTransfers: fromInventoryTransfers,
}