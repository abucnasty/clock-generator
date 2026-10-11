import {
    ConstantCombinatorFilterBuilder,
    ConstantCombinatorSectionBuilder,
    ControlBehavior,
    ControlBehaviorBuilder,
    Entity,
    EntityType,
    fitPlayerDescription,
    Position,
    SignalId,
} from "../components";

export interface ConstantCombinatorEntity extends Entity {
    readonly name: EntityType;
    readonly position: Position;
    readonly control_behavior: ControlBehavior;
    readonly player_description?: string;
}

export class ConstantCombinatorEntityBuilder {
    private position: Position = Position.zero;
    private control_behavior: ControlBehavior = {};
    private player_description: string | undefined = undefined;

    constructor() {}
    
    public setPosition(position: Position): ConstantCombinatorEntityBuilder {
        this.position = position;
        return this;
    }

    public setControlBehavior(controlBehavior: ControlBehavior): ConstantCombinatorEntityBuilder {
        this.control_behavior = controlBehavior;
        return this;
    }

    public setPlayerDescription(description: string): ConstantCombinatorEntityBuilder {
        this.player_description = fitPlayerDescription(description.split("\n"));
        return this;
    }

    public build(): ConstantCombinatorEntity {
        return {
            name: EntityType.CONSTANT_COMBINATOR,
            position: this.position,
            control_behavior: this.control_behavior,
            player_description: this.player_description,
        };
    }
}

/** A constant combinator that puts out each of the signals with its count */
function withSignals(args: {
    signals: { signal: SignalId; count: number }[];
    position: Position;
    description?: string[];
    /** Whether it puts the signals out; on unless stated */
    is_on?: boolean;
}): ConstantCombinatorEntity {
    const section = new ConstantCombinatorSectionBuilder(1);
    args.signals.forEach(({ signal, count }, index) =>
        section.addFilter(new ConstantCombinatorFilterBuilder(index + 1).withSignal(signal).withCount(count).build()));
    const control_behavior = new ControlBehaviorBuilder().setSections([section.build()]);
    if (args.is_on !== undefined) {
        control_behavior.setIsOn(args.is_on);
    }
    const builder = new ConstantCombinatorEntityBuilder()
        .setPosition(args.position)
        .setControlBehavior(control_behavior.build());
    if (args.description) {
        builder.setPlayerDescription(args.description.join("\n"));
    }
    return builder.build();
}

/** The switch that stops every clock of a blueprint: it puts out the lock signal, and is off until someone switches it on */
function lock(args: {
    position: Position;
    description?: string[];
}): ConstantCombinatorEntity {
    return withSignals({
        signals: [{ signal: SignalId.lock, count: 1 }],
        position: args.position,
        description: args.description,
        is_on: false,
    });
}

export const ConstantCombinatorEntity = {
    withSignals,
    lock,
};
