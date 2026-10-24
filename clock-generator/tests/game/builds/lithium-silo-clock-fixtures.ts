import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario, pickupClockInterventions} from "./pickup-clock-capture";

/**
 * The lithium plate build, 80 a second from one copy (`REAL_OWNER_LITHIUM_SILO`): two cryogenic plants, fed
 * holmium plates by infinity chests, put lithium into a rocket silo taken as a chest, and six furnaces take it out and
 * put plates onto a belt that a loader empties into a disposal chest. The silo holds at most 250 lithium (by weight), so
 * the standard cuts of 2 periods (of 7,560 or 1,080 ticks) empty it many times over.
 *
 * The selected clock (3 output swings) is recorded in two build orders. The game serves inserters that act on one entity
 * in the same tick in the order of their unit numbers, the last built first (docs/simulator.md): as the build's blueprint
 * has them, the two inserters that fill the silo are built before the six that empty it; `fill-last` builds them after.
 * The clock with 1 output swing is a second check. The clock with 7 output swings is the known limit of a drop onto a
 * belt that side-loads downstream (the sample's README): the simulator holds it and the game does not. The config marks
 * the two drops (`drop_capture`), and the result names them as that limit.
 */
export interface LithiumSiloCase {
    name: string;
    /** The alternative recorded */
    alternative: "swings-3" | "swings-7" | "swings-1";
    /** Set where the game does not hold this clock though the simulator does: the limit of the drops the config marks */
    known_limit?: "side-loaded-drop";
    order: "as-built" | "fill-last";
}

export function lithiumSiloCases(): LithiumSiloCase[] {
    return [
        {name: "lithium-silo-swings-3", alternative: "swings-3", order: "as-built"},
        {name: "lithium-silo-swings-3-fill-last", alternative: "swings-3", order: "fill-last"},
        {name: "lithium-silo-swings-1", alternative: "swings-1", order: "as-built"},
        {name: "lithium-silo-swings-7", alternative: "swings-7", order: "as-built",
            known_limit: "side-loaded-drop"},
    ];
}

const SCAFFOLD = path.join(path.dirname(ConfigPaths.REAL_OWNER_LITHIUM_SILO), "lithium-silo-scaffold.txt");

interface Placed {entity_number: number; name: string; position: {x: number; y: number}; direction?: number}

/** The tile an inserter drops onto: one tile on the other side from its pickup (direction 0 picks up from the north) */
function dropOf(inserter: Placed): {x: number; y: number} {
    const direction = inserter.direction ?? 0;
    const [dx, dy] = direction === 0 ? [0, 1] : direction === 4 ? [-1, 0] : direction === 8 ? [0, -1] : [1, 0];
    return {x: inserter.position.x + dx, y: inserter.position.y + dy};
}

function pickupOf(inserter: Placed): {x: number; y: number} {
    const drop = dropOf(inserter);
    return {x: 2 * inserter.position.x - drop.x, y: 2 * inserter.position.y - drop.y};
}

/** The scaffold, with the inserters that fill the silo moved behind those that empty it for `fill-last` */
export function lithiumSiloScaffold(order: LithiumSiloCase["order"]): string {
    const text = fs.readFileSync(SCAFFOLD, "utf8").trim();
    if (order === "as-built") return text;
    const file = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = file.blueprint!.entities as unknown as Placed[];
    const silo = entities.find(entity => entity.name === "rocket-silo")!;
    const inSilo = (at: {x: number; y: number}) => Math.abs(at.x - silo.position.x) < 4.5 && Math.abs(at.y - silo.position.y) < 4.5;
    const fills = entities.filter(entity => entity.name === "stack-inserter" && inSilo(dropOf(entity)));
    const empties = entities.filter(entity => entity.name === "stack-inserter" && inSilo(pickupOf(entity)));
    expect([fills.length, empties.length], "the silo is filled by 2 inserters and emptied by 6").toEqual([2, 6]);
    const reordered = [...entities.filter(entity => !fills.includes(entity)), ...fills]
        .map((entity, index) => ({...entity, entity_number: index + 1}));
    return encodeBlueprintFile({...file, blueprint: {...file.blueprint!, entities: reordered}} as unknown as FactorioBlueprintFile);
}

/** The native build is the config's: 8 machines at their speeds, the silo a chest between 2 inserters and 6 */
export function assertLithiumSiloHardware(recording: Recording, config: Config): void {
    expect(recording.config.machines).toMatchObject(config.machines.map(({recipe, crafting_speed, productivity}) => ({recipe, crafting_speed, productivity})));
    const silos = ((recording.config.chests ?? []) as {type: string}[]).filter(chest => chest.type === "rocket-silo");
    expect(silos).toHaveLength(1);
    expect(recording.inserters.filter(inserter => inserter.sink.type === "chest" && inserter.source.type === "machine")).toHaveLength(2);
    expect(recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "machine")).toHaveLength(8);
    expect(recording.inserters.filter(inserter => inserter.sink.type === "belt")).toHaveLength(6);
}

export function lithiumSiloScenario(variant: LithiumSiloCase): PickupClockScenario {
    return {
        name: variant.name, speed: BELT_SPEEDS[0], backed: false,
        config: () => loadConfigFromFile(ConfigPaths.REAL_OWNER_LITHIUM_SILO),
        scaffold: () => lithiumSiloScaffold(variant.order),
        alternative: variant.alternative,
        interventions: pickupClockInterventions(),
        probeFile: path.join(__dirname, "lithium-silo-clock-probe.lua"),
        probe: {family: "lithium-silo"},
        controls: path.join(__dirname, "lithium-silo-clock-controls.json"),
        assertHardware: assertLithiumSiloHardware,
    };
}
