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
 * The steel build, 26 a second from one copy (`STEEL_CARGO_WAGON`): one cargo wagon is a hub. A big mining
 * drill fills it with iron ore, one furnace makes plates from the ore and puts them back, the other makes steel from the
 * plates and puts it back, and one inserter takes the steel out of the wagon onto a belt that a loader empties into a
 * disposal chest. The wagon's slots are filtered: 20 iron ore, 5 iron plate, 5 steel, 10 blocked. The harness puts the
 * ore under the drill.
 *
 * The selected clock is recorded in two build orders. The game serves inserters that act on one entity in the same tick
 * in the order of their unit numbers, the last built first (docs/simulator.md): as the build's blueprint has them, the
 * two inserters that put plates and steel into the wagon are built among the three that take from it; `fill-last`
 * builds them after all of them. The clock the config makes with iron ore out of its period (`ignored_lcm_ingredients`;
 * its subtick clock: the clock rounded to 295 ticks makes 26.03 a second) is a second check.
 */
export interface SteelWagonCase {
    name: string;
    /** The alternative recorded */
    alternative: "planned-belt-slack-subtick";
    /** The items the config leaves out of the period (`overrides.ignored_lcm_ingredients`) */
    ignored_lcm_ingredients?: string[];
    order: "as-built" | "fill-last";
    /** The capture's period of the alternative recorded, in ticks: its subtick clock's (13 periods of 886.15 ticks; 13 of 295.38) */
    period_ticks: number;
}

export function steelWagonCases(): SteelWagonCase[] {
    return [
        {name: "steel-wagon-belt-slack", alternative: "planned-belt-slack-subtick", order: "as-built", period_ticks: 11520},
        {name: "steel-wagon-belt-slack-fill-last", alternative: "planned-belt-slack-subtick", order: "fill-last", period_ticks: 11520},
        {name: "steel-wagon-iron-ore-out-of-period", alternative: "planned-belt-slack-subtick", ignored_lcm_ingredients: ["iron-ore"], order: "as-built", period_ticks: 3840},
    ];
}

/** The steel build's config, with the items the case leaves out of the period */
export async function steelWagonConfig(variant: SteelWagonCase): Promise<Config> {
    const config = await loadConfigFromFile(ConfigPaths.STEEL_CARGO_WAGON);
    return variant.ignored_lcm_ingredients === undefined ? config
        : {...config, overrides: {...config.overrides, ignored_lcm_ingredients: variant.ignored_lcm_ingredients}};
}

const SCAFFOLD = path.join(path.dirname(ConfigPaths.STEEL_CARGO_WAGON), "steel-wagon-scaffold.txt");

interface Placed {entity_number: number; name: string; position: {x: number; y: number}; direction?: number}

/** The tile an inserter drops onto: one tile on the other side from its pickup (direction 0 picks up from the north) */
function dropOf(inserter: Placed): {x: number; y: number} {
    const direction = inserter.direction ?? 0;
    const [dx, dy] = direction === 0 ? [0, 1] : direction === 4 ? [-1, 0] : direction === 8 ? [0, -1] : [1, 0];
    return {x: inserter.position.x + dx, y: inserter.position.y + dy};
}

/** The scaffold, with the inserters that put into the wagon moved behind every other entity for `fill-last` */
export function steelWagonScaffold(order: SteelWagonCase["order"]): string {
    const text = fs.readFileSync(SCAFFOLD, "utf8").trim();
    if (order === "as-built") return text;
    const file = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = file.blueprint!.entities as unknown as Placed[];
    const wagon = entities.find(entity => entity.name === "cargo-wagon")!;
    // the wagon is 2 tiles wide and 6 long at orientation 0.5 (it runs north and south)
    const inWagon = (at: {x: number; y: number}) => Math.abs(at.x - wagon.position.x) < 1 && Math.abs(at.y - wagon.position.y) < 3;
    const fills = entities.filter(entity => entity.name === "stack-inserter" && inWagon(dropOf(entity)));
    expect(fills, "the wagon is filled by 2 inserters").toHaveLength(2);
    const reordered = [...entities.filter(entity => !fills.includes(entity)), ...fills]
        .map((entity, index) => ({...entity, entity_number: index + 1}));
    return encodeBlueprintFile({...file, blueprint: {...file.blueprint!, entities: reordered}} as unknown as FactorioBlueprintFile);
}

/**
 * The periods until the wagon has run dry of steel with the drill stopped: what its ore, plate and steel slots hold, as
 * steel (an ore makes 1 + the plate furnace's productivity plates, 5 plates make 1 + the steel furnace's productivity
 * steel), over the target's steel a period, plus 8 periods for what the furnaces and hands hold
 */
export function steelWagonDrainPeriods(config: Config, period_ticks: number): number {
    const [steel, plate] = ["steel-plate", "iron-plate"].map(recipe => config.machines.find(machine => machine.recipe === recipe)!);
    const slots = (item: string) => ((config.chests ?? []).find(chest => chest.type === "cargo-wagon") as {slot_filters: {item?: string}[]})
        .slot_filters.filter(filter => filter.item === item).length * FactorioDataService.findItemOrThrow(item).stack_size;
    const per_plate = (1 + steel.productivity / 100) / 5;
    const stock = slots("steel-plate") + slots("iron-plate") * per_plate + slots("iron-ore") * (1 + plate.productivity / 100) * per_plate;
    return Math.ceil(stock / (config.target_output.items_per_second * period_ticks / 60)) + 8;
}

/**
 * The protocol of the container family, with the cuts long enough to empty the wagon of steel: the drill stopped, the
 * output blocked for 4 periods, the drill stopped again, each followed for 40 periods (the first 6 after a release not
 * judged). A drill is no supply that stops in the generator's checks; here it is stopped as the supply cut.
 */
export function steelWagonInterventions(config: Config, period_ticks: number): [number, number, number][] {
    const cut = steelWagonDrainPeriods(config, period_ticks);
    const release1 = 66 + cut, block = release1 + 40, unblock = block + 4, again = unblock + 40, release2 = again + cut;
    return [[66, release1, block], [block, unblock, again], [again, release2, release2 + 40]];
}

/** The native build is the config's: 2 furnaces at their speeds, the drill into the wagon, 2 inserters into it and 3 from it */
export function assertSteelWagonHardware(recording: Recording, config: Config): void {
    expect(recording.config.machines).toMatchObject(config.machines.map(({recipe, crafting_speed, productivity}) => ({recipe, crafting_speed, productivity})));
    const wagons = ((recording.config.chests ?? []) as {type: string}[]).filter(chest => chest.type === "cargo-wagon");
    expect(wagons).toHaveLength(1);
    expect(recording.inserters.filter(inserter => inserter.source.type === "machine" && inserter.sink.type === "chest")).toHaveLength(2);
    expect(recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "machine")).toHaveLength(2);
    expect(recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "belt")).toHaveLength(1);
    const drills = (recording.config.drills as {configs: {target: {type: string}; productivity: number}[]}).configs;
    expect(drills.map(drill => drill.target.type)).toEqual(["chest"]);
    // the sidecar's export of the drill's productivity (the harness save's research, no modules) is the config's
    expect(drills[0].productivity).toBeCloseTo(config.drills!.configs[0].productivity, 6);
}

export async function steelWagonScenario(variant: SteelWagonCase): Promise<PickupClockScenario> {
    const config = await steelWagonConfig(variant);
    return {
        name: variant.name, speed: BELT_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => steelWagonScaffold(variant.order),
        alternative: variant.alternative,
        interventions: steelWagonInterventions(config, variant.period_ticks),
        probeFile: path.join(__dirname, "steel-wagon-clock-probe.lua"),
        probe: {family: "steel-wagon"},
        controls: path.join(__dirname, "steel-wagon-clock-controls.json"),
        assertHardware: assertSteelWagonHardware,
    };
}
