import { ArithmeticConditions, Entity, EntityType, Position, SignalId } from "../components";

export interface ArithmeticCombinatorEntity extends Entity {
    readonly name: EntityType;
    readonly position: Position;
    readonly player_description?: string;
}

function withConstant(args: {
    input: SignalId;
    operation: ArithmeticConditions["operation"];
    constant: number;
    output: SignalId;
    position: Position;
    description?: string[];
}): ArithmeticCombinatorEntity {
    return {
        name: EntityType.ARITHMETIC_COMBINATOR,
        position: args.position,
        player_description: args.description?.join("\n"),
        control_behavior: {
            arithmetic_conditions: {
                first_signal: args.input,
                second_constant: args.constant,
                operation: args.operation,
                output_signal: args.output,
            },
        },
    };
}

export const ArithmeticCombinatorEntity = {
    withConstant,
};
