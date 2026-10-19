import zlib from "zlib";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {blueprintAtSpeed, FixtureBeltSpeed} from "../../helpers/belt-speed-fixtures";

/** Keep the pickup/plant fixed while splitting long ingredient tunnels into reachable slower pairs. */
export function ordinaryAtSpeed(text: string, speed: FixtureBeltSpeed, gated = true): string {
    interface LayoutEntity {entity_number: number; name: string; type?: string; position: {x: number; y: number}}
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as
        {blueprint: {entities: LayoutEntity[]; wires?: number[][]}};
    const entities = decoded.blueprint.entities;
    const plant = entities.find(e => e.name === "electromagnetic-plant")!;
    const ingredientY = plant.position.y + 3.5;
    const maxDistance = speed.name === "normal" ? 5 : speed.name === "fast" ? 7 : speed.name === "express" ? 9 : 11;
    let nextId = Math.max(...entities.map(e => e.entity_number)) + 1;
    for (const entrance of [...entities].filter(e => e.name === "turbo-underground-belt" && e.type === "input"
        && e.position.y === ingredientY)) {
        const exit = entities.filter(e => e.name === "turbo-underground-belt" && e.type === "output"
            && e.position.y === ingredientY && e.position.x > entrance.position.x).sort((a, b) => a.position.x - b.position.x)[0];
        if (!exit || exit.position.x - entrance.position.x <= maxDistance) continue;
        if (entrance.position.x < plant.position.x - 5) {
            const old = {...entrance, position: {...entrance.position}, entity_number: nextId++, name: "turbo-transport-belt" as const};
            delete old.type;
            entities.push(old);
            entrance.position.x++;
        } else {
            entities.push({...exit, entity_number: nextId++, position: {x: plant.position.x + 1.5, y: ingredientY}});
            entities.push({...entrance, entity_number: nextId++, position: {x: plant.position.x + 2.5, y: ingredientY}});
        }
    }
    if (gated) {
        const input = entities.find(e => e.name === "stack-inserter" && e.position.x === plant.position.x - 1.5
            && e.position.y === plant.position.y + 2.5)!;
        const gateId = nextId++;
        entities.push({entity_number: gateId, name: "constant-combinator", position: {x: input.position.x - 1, y: input.position.y}});
        decoded.blueprint.wires = [...(decoded.blueprint.wires ?? []), [input.entity_number, 1, gateId, 1]];
    }
    return blueprintAtSpeed(encodeBlueprintFile(decoded as unknown as FactorioBlueprintFile), speed);
}

