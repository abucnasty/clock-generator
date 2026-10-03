import { ControlBehavior } from "./control-behavior";
import { Position } from "./position";

// only supported entity types, not all entities in the game
export const EntityType = {
    DECIDER_COMBINATOR: "decider-combinator",
    ARITHMETIC_COMBINATOR: "arithmetic-combinator",
    CONSTANT_COMBINATOR: "constant-combinator",
} as const;

export type EntityType = typeof EntityType[keyof typeof EntityType];

// Factorio 2.0 uses 16 directions
export const Direction = {
    NORTH: 0,
    EAST: 4,
    SOUTH: 8,
    WEST: 12,
} as const;

export type Direction = typeof Direction[keyof typeof Direction];

export interface Entity {
    name: EntityType;
    position: Position;
    direction?: Direction;
    control_behavior?: ControlBehavior;
    player_description?: string;
}

export interface EntityWithId extends Entity {
    entity_number: number;
}