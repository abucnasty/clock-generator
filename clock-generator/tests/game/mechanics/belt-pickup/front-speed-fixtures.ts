import zlib from "zlib";
import { FactorioBlueprintFile } from "../../../../src/blueprints/blueprint";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { FixtureBeltSpeed } from "../../helpers/belt-speed-fixtures";

interface FixtureEntity {
    entity_number: number; name: string; position: {x: number; y: number}; direction?: number;
    recipe?: string; items?: unknown; infinity_settings?: {filters?: {name: string}[]};
}

/** Actual first-grab lane phases measured in the compact control, in 1/256-tile units modulo 64. */
export const frontPickupPhases = {
    turbo: [32, 0],
    express: [8, 8, 48, 24, 0, 40, 16, 56, 32],
    fast: [48, 32, 16, 0],
    normal: [56, 48, 40, 32, 24, 16, 8, 0],
} as const;

/** Enumerate the distinct quarter-tile arrival phases for the compact moving control. */
export function frontPickupReleaseDelays(speed: FixtureBeltSpeed, compactDestination: boolean, backedUp: boolean) {
    const period = !compactDestination || backedUp ? 1 : frontPickupPhases[speed.name].length;
    // Express release 0 and 1 both first grab at tick 3; delay 8 supplies the otherwise missing native phase.
    return Array.from({length: period}, (_, delay) => delay);
}

/** A real empty circuit network is required for the native inserter's false condition to take effect. */
export function connectFrontPickupGate(text: string) {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = decoded.blueprint!.entities! as unknown as FixtureEntity[];
    const input = entities.find(entity => entity.entity_number === 22)!;
    const gate = {entity_number: Math.max(...entities.map(entity => entity.entity_number)) + 1,
        name: "constant-combinator", position: {x: input.position.x, y: input.position.y + 1}};
    entities.push(gate);
    decoded.blueprint!.wires ??= [];
    decoded.blueprint!.wires.push([input.entity_number, 1, gate.entity_number, 1]);
    return encodeBlueprintFile(decoded);
}

/** Shorten tunnels that exceed the slower prototypes' range; preserve the observed pickup and destination. */
export function compactFrontUndergroundRouting(text: string, endpoint: "entrance" | "exit", speed: FixtureBeltSpeed, compactDestination = false) {
    if (speed.name === "turbo" && !compactDestination) return text;
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = decoded.blueprint!.entities! as unknown as FixtureEntity[];
    if (compactDestination) {
        const plant = entities.find(e => e.name === "electromagnetic-plant")!;
        plant.name = "assembling-machine-3" as typeof plant.name;
        plant.position = {x: plant.position.x - 0.5, y: plant.position.y - 0.5};
        plant.recipe = "electronic-circuit";
        delete plant.items;
        for (const entity of entities) for (const filter of entity.infinity_settings?.filters ?? []) {
            if (filter.name === "accumulator") filter.name = "iron-plate";
            if (filter.name === "supercapacitor") filter.name = "copper-cable";
        }
    }
    if (endpoint === "exit" && speed.name === "normal") {
        const entrance = entities.find(e => e.entity_number === 13)!;
        entrance.position = {...entrance.position, y: entrance.position.y - 1};
        entities.push({entity_number: Math.max(...entities.map(e => e.entity_number)) + 1,
            name: "turbo-transport-belt" as typeof entrance.name, position: {x: entrance.position.x, y: entrance.position.y + 1}, direction: 0});
    }
    if (endpoint === "entrance") {
        const exit = entities.find(e => e.entity_number === 44)!;
        exit.position = {...exit.position, x: compactDestination ? -17.5 : -16.5};
        let number = Math.max(...entities.map(e => e.entity_number));
        for (let x = exit.position.x + 1; x <= -11.5; x++) entities.push({entity_number: ++number,
            name: "turbo-transport-belt" as typeof exit.name, position: {x, y: exit.position.y}, direction: 4});
    }
    return encodeBlueprintFile(decoded);
}
