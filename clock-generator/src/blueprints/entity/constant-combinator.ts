import { ControlBehavior, Entity, EntityType, fitPlayerDescription, Position } from "../components";

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