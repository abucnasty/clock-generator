import { Entity } from "./entity";

export type WireColor = "red" | "green";

export type CircuitSide = "input" | "output";

export interface WireEndpoint {
    entity: Entity;
    side: CircuitSide;
}

export interface WireConnection {
    color: WireColor;
    from: WireEndpoint;
    to: WireEndpoint;
}

/** [entity_number, connector, entity_number, connector], as stored in a blueprint */
export type BlueprintWire = [number, number, number, number];

function input(entity: Entity): WireEndpoint {
    return { entity, side: "input" };
}

function output(entity: Entity): WireEndpoint {
    return { entity, side: "output" };
}

/** The one connector of an entity without sides, such as a constant combinator: it has the ids of a combinator's input */
function circuit(entity: Entity): WireEndpoint {
    return { entity, side: "input" };
}

// combinator connectors: red/green input are 1/2, red/green output are 3/4
function connectorId(color: WireColor, side: CircuitSide): number {
    return (side === "input" ? 1 : 3) + (color === "green" ? 1 : 0);
}

function connect(color: WireColor, from: WireEndpoint, to: WireEndpoint): WireConnection {
    return { color, from, to };
}

/** Connects each endpoint to the next one */
function chain(color: WireColor, endpoints: WireEndpoint[]): WireConnection[] {
    return endpoints.slice(1).map((to, index) => connect(color, endpoints[index], to));
}

function toBlueprintWire(connection: WireConnection, entityNumber: (entity: Entity) => number): BlueprintWire {
    return [
        entityNumber(connection.from.entity),
        connectorId(connection.color, connection.from.side),
        entityNumber(connection.to.entity),
        connectorId(connection.color, connection.to.side),
    ];
}

export const Wire = {
    input,
    output,
    circuit,
    red: (from: WireEndpoint, to: WireEndpoint) => connect("red", from, to),
    green: (from: WireEndpoint, to: WireEndpoint) => connect("green", from, to),
    redChain: (endpoints: WireEndpoint[]) => chain("red", endpoints),
    greenChain: (endpoints: WireEndpoint[]) => chain("green", endpoints),
    toBlueprintWire,
};
