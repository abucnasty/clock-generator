import zlib from "zlib";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {blueprintAtSpeed, FixtureBeltSpeed} from "../../helpers/belt-speed-fixtures";

interface Entity {
    entity_number: number; name: string; type?: string; mirror?: boolean; direction?: number;
    position: {x: number; y: number}; recipe?: string; items?: unknown;
    infinity_settings?: {filters?: {name: string}[]};
}
export interface OverTheHoodOptions {mirrored?: boolean; backedUp?: boolean; content?: "original" | "swapped" | "same-item"; compactDestination?: boolean; gated?: boolean}

/** Keep the supplied base exact; only normal needs a separately documented smaller destination/routing control. */
export function overTheHoodExitAtSpeed(text: string, speed: FixtureBeltSpeed, options: OverTheHoodOptions = {}) {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = decoded.blueprint!.entities! as unknown as Entity[];
    const input = entities.find(entity => entity.entity_number === 36)!;
    const machine = entities.find(entity => entity.entity_number === 27)!;
    let nextId = Math.max(...entities.map(entity => entity.entity_number));
    const compact = options.compactDestination ?? speed.name === "normal";
    if (compact) {
        machine.name = "assembling-machine-3";
        machine.position = {x: -106.5, y: 428.5};
        machine.recipe = "electronic-circuit";
        delete machine.items; // The five-slot electromagnetic loadout does not fit this assembler.
        entities.find(entity => entity.entity_number === 21)!.position = {x: -108.5, y: 428.5};
        for (const x of [-110.5, -109.5]) entities.push({entity_number: ++nextId, name: "transport-belt",
            position: {x, y: 428.5}, direction: 4});
    }
    if (options.mirrored) input.mirror = !input.mirror;
    let feeders = 0;
    for (const entity of entities) for (const filter of entity.infinity_settings?.filters ?? []) {
        if (filter.name !== "accumulator" && filter.name !== "supercapacitor") continue;
        feeders++;
        if (options.content === "same-item") filter.name = "accumulator";
        else if (options.content === "swapped") filter.name = filter.name === "accumulator" ? "supercapacitor" : "accumulator";
        if (compact) filter.name = filter.name === "accumulator" ? "iron-plate" : "copper-cable";
    }
    if (feeders !== 4) throw new Error("Expected exactly four ingredient feeders");
    if (options.backedUp) {
        const drains = entities.filter(entity => /(?:^|-)loader$/.test(entity.name) && entity.type === "input"
            && entity.position.y === input.position.y);
        if (drains.length !== 1) throw new Error("Expected one ingredient drain loader");
        decoded.blueprint!.entities = decoded.blueprint!.entities!.filter(entity => entity.entity_number !== drains[0].entity_number);
    }
    if (options.gated) {
        const gate = {entity_number: ++nextId, name: "constant-combinator",
            position: {x: input.position.x, y: input.position.y - 1}};
        decoded.blueprint!.entities!.push(gate as unknown as NonNullable<FactorioBlueprintFile["blueprint"]>["entities"][number]);
        decoded.blueprint!.wires = [...(decoded.blueprint!.wires ?? []), [input.entity_number, 1, gate.entity_number, 1]];
    }
    return blueprintAtSpeed(encodeBlueprintFile(decoded), speed);
}

/** Optional aligned-lane phase sweep; the ordinary 84-case command stays unchanged. */
export function overTheHoodReleaseDelays(speed: FixtureBeltSpeed, compact: boolean, backed: boolean, phases = false) {
    if (!phases || backed || (!compact && speed.name === "normal")) return [0];
    const cycle = speed.name === "turbo" ? 2 : speed.name === "fast" ? 4 : 8;
    return Array.from({length: cycle}, (_, delay) => delay);
}

/** Any requested replay must stay offline, even when only the other case family's root was supplied. */
export function overTheHoodReplayRoot(releaseDelay: number, baseRoot?: string, phaseRoot?: string) {
    if (baseRoot === undefined && phaseRoot === undefined) return undefined;
    const root = releaseDelay ? phaseRoot : baseRoot;
    if (!root?.trim()) throw new Error(`Replay requested but ${releaseDelay ? "OVER_HOOD_PHASE_REPLAY_DIR" : "OVER_HOOD_REPLAY_DIR"} is missing; set both roots or filter to the supplied case family`);
    return root;
}
