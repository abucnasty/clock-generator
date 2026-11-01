import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {FactorioDataService} from "../../../src/data";
import {Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * The iron plate build, 80 a second from one copy (`REAL_OWNER_CAR`): a big mining drill drops iron ore into a
 * car, two stack inserters take it into two furnaces, and their output inserters put plates onto a belt that a loader
 * empties into a disposal chest. The harness puts the ore under the drill. At the harness's research the drill makes far
 * more than the furnaces take, so the car is full whenever the drill runs.
 *
 * The selected clock (2 output swings, 144 ticks) is recorded in two build orders; the clock with 3 output swings (72 ticks),
 * which was selected before the generator counted a wake-up only while the inserter's arm is at home, is recorded in both
 * as well, and the generation test finds it made. The game serves inserters that act on one entity
 * in the same tick in the order of their unit numbers, the last built first (docs/simulator.md): as the build's blueprint
 * has them, the two inserters that take from the car are built before the output inserters; `takers-last` builds them
 * after. The clock with 1 output swing is a further check.
 */
export interface CarCase {
    name: string;
    /** The alternative recorded */
    alternative: "swings-2" | "swings-3" | "swings-1";
    /** The clock's period in ticks: the cuts are sized by it */
    period: 72 | 144;
    order: "as-built" | "takers-last";
}

export function carCases(): CarCase[] {
    return [
        {name: "car-swings-2", alternative: "swings-2", period: 144, order: "as-built"},
        {name: "car-swings-2-takers-last", alternative: "swings-2", period: 144, order: "takers-last"},
        {name: "car-swings-3", alternative: "swings-3", period: 72, order: "as-built"},
        {name: "car-swings-3-takers-last", alternative: "swings-3", period: 72, order: "takers-last"},
        {name: "car-swings-1", alternative: "swings-1", period: 72, order: "as-built"},
    ];
}

const SCAFFOLD = path.join(path.dirname(ConfigPaths.REAL_OWNER_CAR), "car-scaffold.txt");

interface Placed {entity_number: number; name: string; position: {x: number; y: number}; direction?: number}

/** The tile an inserter picks up from: one tile on its pickup side (direction 0 picks up from the north) */
function pickupOf(inserter: Placed): {x: number; y: number} {
    const direction = inserter.direction ?? 0;
    const [dx, dy] = direction === 0 ? [0, -1] : direction === 4 ? [1, 0] : direction === 8 ? [0, 1] : [-1, 0];
    return {x: inserter.position.x + dx, y: inserter.position.y + dy};
}

/** The scaffold, with the inserters that take from the car moved behind the output inserters for `takers-last` */
export function carScaffold(order: CarCase["order"]): string {
    const text = fs.readFileSync(SCAFFOLD, "utf8").trim();
    if (order === "as-built") return text;
    const file = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = file.blueprint!.entities as unknown as Placed[];
    const car = entities.find(entity => entity.name === "car")!;
    // the car is about 2 by 1.4 tiles at orientation 0.25: a pickup within a tile of its centre is on it
    const onCar = (at: {x: number; y: number}) => Math.abs(at.x - car.position.x) < 1.5 && Math.abs(at.y - car.position.y) < 1.5;
    const takers = entities.filter(entity => entity.name === "stack-inserter" && onCar(pickupOf(entity)));
    expect(takers, "the car is emptied by 2 inserters").toHaveLength(2);
    const reordered = [...entities.filter(entity => !takers.includes(entity)), ...takers]
        .map((entity, index) => ({...entity, entity_number: index + 1}));
    return encodeBlueprintFile({...file, blueprint: {...file.blueprint!, entities: reordered}} as unknown as FactorioBlueprintFile);
}

/**
 * The periods until the car has run dry with the drill stopped: its 80 stacks of ore over what the furnaces take a
 * period at the target (a plate takes 1 / (1 + productivity) ore), plus 8 periods for what the furnaces and hands hold
 */
export function carDrainPeriods(config: Config, period_ticks: number): number {
    const ore = FactorioDataService.containerSlots("car", "normal") * FactorioDataService.findItemOrThrow("iron-ore").stack_size;
    const productivity = config.machines[0].productivity / 100;
    const per_period = config.target_output.items_per_second * period_ticks / 60 / (1 + productivity);
    return Math.ceil(ore / per_period) + 8;
}

/**
 * The protocol of the container family, with the cuts long enough to empty the car: the drill stopped until the car
 * is dry, the output blocked for 4 periods, the drill stopped again, each followed for 40 periods (the first 6 after a
 * release not judged). A drill is no supply that stops in the generator's checks; here it is stopped as a supply cut.
 */
export function carInterventions(config: Config, period_ticks: number): [number, number, number][] {
    const cut = carDrainPeriods(config, period_ticks);
    const release1 = 66 + cut, block = release1 + 40, unblock = block + 4, again = unblock + 40, release2 = again + cut;
    return [[66, release1, block], [block, unblock, again], [again, release2, release2 + 40]];
}

/** The native build is the config's: 2 furnaces at their speeds, the drill into the car, 2 inserters from it and 2 onto the belt */
export function assertCarHardware(recording: Recording, config: Config): void {
    expect(recording.config.machines).toMatchObject(config.machines.map(({recipe, crafting_speed, productivity}) => ({recipe, crafting_speed, productivity})));
    const cars = ((recording.config.chests ?? []) as {type: string}[]).filter(chest => chest.type === "car");
    expect(cars).toHaveLength(1);
    expect(recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "machine")).toHaveLength(2);
    expect(recording.inserters.filter(inserter => inserter.sink.type === "belt")).toHaveLength(2);
    const drills = (recording.config.drills as {configs: {target: {type: string}; productivity: number}[]}).configs;
    expect(drills.map(drill => drill.target.type)).toEqual(["chest"]);
    // the sidecar's export of the drill's productivity (the harness save's research, no modules) is the config's
    expect(drills[0].productivity).toBeCloseTo(config.drills!.configs[0].productivity, 6);
}

export async function carScenario(variant: CarCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_CAR);
    return {
        name: variant.name, speed: BELT_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => carScaffold(variant.order),
        alternative: variant.alternative,
        interventions: carInterventions(config, variant.period),
        probeFile: path.join(__dirname, "car-clock-probe.lua"),
        probe: {family: "car"},
        controls: path.join(__dirname, "car-clock-controls.json"),
        assertHardware: assertCarHardware,
    };
}
