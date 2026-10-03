import { describe, it, expect } from "vitest";
import { BlueprintBuilder } from "../blueprint";
import { Entity, EntityType } from "./entity";
import { Position } from "./position";
import { BlueprintWire, Wire } from "./wire";

function combinator(x: number): Entity {
    return { name: EntityType.DECIDER_COMBINATOR, position: Position.fromXY(x, 0) };
}

describe("Wire", () => {
    const a = combinator(0);
    const b = combinator(1);
    const numbers = new Map([[a, 1], [b, 2]]);
    const toBlueprint = (wire: ReturnType<typeof Wire.green>): BlueprintWire =>
        Wire.toBlueprintWire(wire, entity => numbers.get(entity)!);

    it("maps green input/output to connectors 2/4", () => {
        expect(toBlueprint(Wire.green(Wire.input(a), Wire.output(b)))).toEqual([1, 2, 2, 4]);
        expect(toBlueprint(Wire.green(Wire.output(a), Wire.input(b)))).toEqual([1, 4, 2, 2]);
    });

    it("maps red input/output to connectors 1/3", () => {
        expect(toBlueprint(Wire.red(Wire.input(a), Wire.output(b)))).toEqual([1, 1, 2, 3]);
        expect(toBlueprint(Wire.red(Wire.output(a), Wire.input(b)))).toEqual([1, 3, 2, 1]);
    });

    it("can connect an entity's input to its own output", () => {
        expect(toBlueprint(Wire.green(Wire.input(a), Wire.output(a)))).toEqual([1, 2, 1, 4]);
    });

    it("chains each endpoint to the next in order", () => {
        const c = combinator(2);
        const chain = Wire.greenChain([Wire.output(a), Wire.input(b), Wire.input(c)]);
        expect(chain).toEqual([
            Wire.green(Wire.output(a), Wire.input(b)),
            Wire.green(Wire.input(b), Wire.input(c)),
        ]);
        expect(Wire.redChain([Wire.input(a), Wire.input(b)])).toEqual([Wire.red(Wire.input(a), Wire.input(b))]);
    });

    it("chains fewer than two endpoints to nothing", () => {
        expect(Wire.greenChain([])).toEqual([]);
        expect(Wire.greenChain([Wire.input(a)])).toEqual([]);
    });
});

describe("BlueprintBuilder wires", () => {
    it("numbers wired entities by their order in setEntities", () => {
        const [a, b, c] = [combinator(0), combinator(1), combinator(2)];
        const blueprint = new BlueprintBuilder()
            .setWires([
                Wire.green(Wire.output(c), Wire.input(a)),
                ...Wire.greenChain([Wire.input(a), Wire.input(b)]),
            ])
            .setEntities([a, b, c])
            .build();
        expect(blueprint.wires).toEqual([[3, 4, 1, 2], [1, 2, 2, 2]]);
    });

    it("tells apart entities with identical properties", () => {
        const [a, b] = [combinator(0), combinator(0)];
        const blueprint = new BlueprintBuilder()
            .setEntities([a, b])
            .setWires([Wire.green(Wire.output(b), Wire.input(a))])
            .build();
        expect(blueprint.wires).toEqual([[2, 4, 1, 2]]);
    });

    it("throws when a wired entity is not in the blueprint", () => {
        const builder = new BlueprintBuilder()
            .setEntities([combinator(0)])
            .setWires([Wire.green(Wire.output(combinator(5)), Wire.input(combinator(0)))]);
        expect(() => builder.build()).toThrow(/at \(5, 0\) is not in the blueprint/);
    });

    it("defaults to no wires", () => {
        expect(new BlueprintBuilder().setEntities([combinator(0)]).build().wires).toEqual([]);
    });
});
