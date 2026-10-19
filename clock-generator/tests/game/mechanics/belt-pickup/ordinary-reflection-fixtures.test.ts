import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {BELT_SPEEDS} from "../../helpers/belt-speed-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";
import {reflectOrdinaryPickup} from "./ordinary-reflection-fixtures";
import {compactFrontEntranceAtSpeed} from "./front-speed-fixtures";

const decode = (text: string) => JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
for (const speed of BELT_SPEEDS) for (const geometry of ["straight-belt", "underground-entrance", "underground-exit"])
    test(`reflects the entire wired ${speed.name} ${geometry} cell while retaining controls`, () => {
        const text = ordinaryAtSpeed(fs.readFileSync(path.join(__dirname, `fixtures/different-items/${geometry}-scaffold.txt`), "utf8"), speed);
        const before = decode(text), after = decode(reflectOrdinaryPickup(text));
        expect(after.blueprint.wires).toEqual(before.blueprint.wires);
        const entities = after.blueprint.entities;
        expect(entities.map((entity: {entity_number: number}) => entity.entity_number)).toEqual(
            before.blueprint.entities.map((entity: {entity_number: number}) => entity.entity_number));
        // Positions/directions may change; inventories, filters, mirroring and circuit controls must survive.
        const controlsOf = ({position: _position, direction: _direction, ...controls}: Record<string, unknown>) => controls;
        expect(entities.map(controlsOf)).toEqual(before.blueprint.entities.map(controlsOf));
        const plant = entities.find((entity: {name: string}) => entity.name === "electromagnetic-plant");
        const input = entities.find((entity: {entity_number: number}) => entity.entity_number === (geometry === "underground-exit" ? 22 : 23));
        expect(input.position).toEqual({x: plant.position.x - 1.5, y: plant.position.y - 2.5});
        expect(input.direction).toBe(0);
        expect(input.mirror).toBe(true);
        const source = entities.find((entity: {position: {x: number; y: number}}) =>
            entity.position.x === input.position.x && entity.position.y === input.position.y - 1);
        expect(source.name).toBe(`${speed.prefix}${geometry === "straight-belt" ? "transport-belt" : "underground-belt"}`);
        expect(source.direction).toBe(4);
        expect(entities.find((entity: {entity_number: number}) => entity.entity_number === 2).direction).toBe(8);

    });

test("compact controls retain the supplied assembler, connected output and modules", () => {
    const supplied = fs.readFileSync(path.join(__dirname, "fixtures/front-underground-entrance/compact-normal-scaffold.txt"), "utf8");
    const normal = BELT_SPEEDS.find(speed => speed.name === "normal")!;
    expect(decode(compactFrontEntranceAtSpeed(supplied, normal))).toEqual(decode(supplied));
    const entities = decode(supplied).blueprint.entities;
    const machine = entities.find((entity: {name: string}) => entity.name === "assembling-machine-3");
    const output = entities.find((entity: {entity_number: number}) => entity.entity_number === 19);
    expect(machine.items).toHaveLength(1);
    expect(output.position).toEqual({x: machine.position.x + 1, y: machine.position.y - 2});
    expect(output.direction).toBe(8);
    expect(entities.some((entity: {name: string; position: {x: number; y: number}}) => entity.name === "transport-belt"
        && entity.position.x === output.position.x && entity.position.y === output.position.y - 1)).toBe(true);
});
