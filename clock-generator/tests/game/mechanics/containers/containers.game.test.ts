import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {Config, ConfigSchema} from "../../../../src/config";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {CompositeControlLogic, TickControlLogic} from "../../../../src/control-logic";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {drillResourceOf, recordInFactorio} from "../../../../src/harness/factorio-harness";
import {EntityState} from "../../../../src/state";
import {composeProbeSource} from "../../helpers/probe-source";

/**
 * Containers as chests in the game against the simulator, inserter by inserter: the hands each inserter carried, what
 * it holds at the end, and the container's slots or the silo's rocket inventory and input slots. No clock: every
 * inserter is enabled. The silo never crafts: its sinks lack rocket fuel, or its recipe is of another quality than the
 * items brought, and its source holds no rocket fuel.
 */
interface ContainerMechanicCase {
    name: string;
    ticks: number;
    entities: Record<string, unknown>[];
    config: Record<string, unknown>;
    probe: Record<string, unknown>;
    /** Ticks before the recording: 1 unless an empty chest would be left out of the export (the sidecar exports a chest with items) */
    warmup_ticks?: number;
}

const supply = (id: number, item: string) => ({type: "infinity-chest", id, item_filter: [{item_name: item, request_count: 100}]});
const disposal = (id: number) => ({type: "infinity-chest", id, item_filter: [], remove_unfiltered_items: true});
const chestEntity = (x: number, y: number, item?: string) => ({name: "infinity-chest", position: {x, y}, infinity_settings: item
    ? {remove_unfiltered_items: true, filters: [{name: item, count: 100, mode: "exactly", index: 1}]} : {remove_unfiltered_items: true, filters: []}});
const inserterEntity = (x: number, y: number, direction: number, filter?: string) => ({name: "stack-inserter", position: {x, y}, direction,
    quality: "legendary", ...(filter ? {use_filters: true, filters: [{index: 1, name: filter}]} : {})});
/** A machine for the config to have; it is not built and nothing feeds it */
const idle = {target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
    machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}], belts: []};

/** Inserters into a silo stand on its north edge (the silo spans -4 to 5), their supplies north of them */
function siloSink(name: string, items: string[], recipe_quality?: string): ContainerMechanicCase {
    const xs = [-2.5, -0.5, 1.5, 3.5];
    return {
        name, ticks: 900,
        entities: [{name: "rocket-silo", position: {x: 0.5, y: 0.5}, ...(recipe_quality ? {recipe_quality} : {})},
            ...items.flatMap((item, index) => [chestEntity(xs[index], -5.5, item), inserterEntity(xs[index], -4.5, 0)])],
        config: {...idle, chests: [{type: "rocket-silo", id: 1, ...(recipe_quality ? {recipe_quality} : {})}, ...items.map((item, index) => supply(10 + index, item))],
            inserters: items.map((item, index) => ({id: index + 1, source: {type: "chest", id: 10 + index}, sink: {type: "chest", id: 1}, stack_size: 16}))},
        probe: {},
    };
}

/**
 * A big mining drill with 4 legendary speed modules 3 on iron ore, facing east (direction 4) and dropping into
 * `container`, which an unfiltered stack inserter at `taker_x` east of it empties into a disposal chest (the recorder
 * records a build only with an inserter or a machine)
 */
function drillInto(name: string, container: Record<string, unknown>, chest: Record<string, unknown>, taker_x: number): ContainerMechanicCase {
    const modules = [{id: {name: "speed-module-3", quality: "legendary"}, items: {in_inventory: [0, 1, 2, 3].map(stack => ({inventory: 2, stack}))}}];
    return {
        name, ticks: 400,
        entities: [{name: "big-mining-drill", position: {x: 0.5, y: 0.5}, direction: 4, items: modules}, container,
            inserterEntity(taker_x, 0.5, 12), chestEntity(taker_x + 1, 0.5)],
        config: {...idle, drills: {mining_productivity_level: 8000, configs: [{id: 1, type: "big-mining-drill", mined_item_name: "iron-ore",
            speed_bonus: 5, target: {type: "chest", id: 1}}]},
            chests: [chest, disposal(10)],
            inserters: [{id: 1, source: {type: "chest", id: 1}, sink: {type: "chest", id: 10}, stack_size: 16}]},
        probe: {fill_ticks: 30},
    };
}

export function containerMechanicCases(): ContainerMechanicCase[] {
    const silo_contents = {rocket: [["iron-plate", 100], ["copper-plate", 40], ["iron-gear-wheel", 20]], input: [["processing-unit", 10], ["low-density-structure", 10]]};
    const car_contents = [[1, "iron-plate", 40], [2, "copper-plate", 100], [5, "iron-gear-wheel", 30], [9, "iron-plate", 100]];
    return [
        // the ingredients stop at the insertion limit, a whole hand in; iron plates fill the rocket to its lift weight
        siloSink("silo-sink-normal", ["processing-unit", "low-density-structure", "iron-plate"]),
        // a recipe of another quality: the normal ingredients go into the rocket inventory with the plates
        siloSink("silo-sink-rare", ["processing-unit", "low-density-structure", "rocket-fuel", "iron-plate"], "rare"),
        {
            // an inserter takes from the rocket inventory, the last slot first; one filtered to processing units takes none
            name: "silo-source", ticks: 400,
            entities: [{name: "rocket-silo", position: {x: 0.5, y: 0.5}}, chestEntity(-0.5, -5.5), inserterEntity(-0.5, -4.5, 8),
                chestEntity(1.5, -5.5), inserterEntity(1.5, -4.5, 8, "processing-unit")],
            config: {...idle, chests: [{type: "rocket-silo", id: 1, contents: [...silo_contents.rocket, ...silo_contents.input].map(([item, count]) => ({item, count}))},
                disposal(10), disposal(11)],
                inserters: [{id: 1, source: {type: "chest", id: 1}, sink: {type: "chest", id: 10}, stack_size: 16},
                    {id: 2, source: {type: "chest", id: 1}, sink: {type: "chest", id: 11}, stack_size: 16, filters: ["processing-unit"]}]},
            probe: {silo: silo_contents},
        },
        {
            // a wagon at the end of the line, five slots filtered to copper: two feeders fill it to the last slot
            name: "wagon-sink", ticks: 3000,
            entities: [...Array.from({length: 9}, (_, index) => ({name: "straight-rail", position: {x: 1, y: -7 + 2 * index}, direction: 0})),
                {name: "cargo-wagon", position: {x: 1, y: 0.5}, orientation: 0,
                    inventory: {filters: [1, 2, 3, 4, 5].map(index => ({index, name: "copper-plate"}))}},
                chestEntity(-1.5, 0.5, "iron-plate"), inserterEntity(-0.5, 0.5, 12), chestEntity(-1.5, 1.5, "copper-plate"), inserterEntity(-0.5, 1.5, 12)],
            config: {...idle, chests: [{type: "cargo-wagon", id: 1, slot_filters: [1, 2, 3, 4, 5].map(slot => ({slot, item: "copper-plate"}))},
                supply(10, "iron-plate"), supply(11, "copper-plate")],
                inserters: [{id: 1, source: {type: "chest", id: 10}, sink: {type: "chest", id: 1}, stack_size: 16},
                    {id: 2, source: {type: "chest", id: 11}, sink: {type: "chest", id: 1}, stack_size: 16}]},
            probe: {},
        },
        // a big mining drill drops iron ore into a chest of each kind, as the owner's car build has it (the drill faces
        // east; the car stands 4.168 east and 0.508 south of the drill's centre, at orientation 0.25). The harness puts
        // the ore under the drill (the config's `mined_item_name`). At the harness's research the drill mines about 617
        // ore a tick, so each container fills within ticks and the drill then waits for room.
        drillInto("drill-into-car", {name: "car", position: {x: 4.668, y: 1.008}, orientation: 0.25}, {type: "car", id: 1}, 6.5),
        // free slots only: the five slots filtered to copper plates stay empty
        drillInto("drill-into-filtered-car", {name: "car", position: {x: 4.668, y: 1.008}, orientation: 0.25,
            trunk_inventory: {filters: [1, 2, 3, 4, 5].map(index => ({index, name: "copper-plate"}))}},
        {type: "car", id: 1, slot_filters: [1, 2, 3, 4, 5].map(slot => ({slot, item: "copper-plate"}))}, 6.5),
        // a steel chest of 48 slots, the config's buffer chest of iron ore; an empty chest is not exported, so its
        // recording starts once the drill has filled it, and its first ticks are not followed
        {...drillInto("drill-into-chest", {name: "steel-chest", position: {x: 3.5, y: 0.5}},
            {type: "buffer-chest", id: 1, storage_size: 48, item_filter: "iron-ore"}, 4.5), warmup_ticks: 60, probe: {}},
        // a rocket silo east of the drill: what the drill gives it, by weight into the rocket inventory if anything
        drillInto("drill-into-silo", {name: "rocket-silo", position: {x: 7.5, y: 0.5}}, {type: "rocket-silo", id: 1}, 12.5),
        {
            // a car of mixed items emptied by an unfiltered inserter: the last slot's item first, a hand across stacks
            name: "car-source", ticks: 400,
            entities: [{name: "car", position: {x: 0, y: 0.5}, orientation: 0}, inserterEntity(1.5, 0.5, 12), chestEntity(2.5, 0.5)],
            config: {...idle, chests: [{type: "car", id: 1, contents: car_contents.map(([slot, item, count]) => ({slot, item, count}))}, disposal(10)],
                inserters: [{id: 1, source: {type: "chest", id: 1}, sink: {type: "chest", id: 10}, stack_size: 16}]},
            probe: {car: car_contents},
        },
    ];
}

/**
 * The blueprint, its inserters (listed in config id order) built last: by default in descending config id, so the game
 * serves inserter 1 first among inserters that act in one tick, as the simulator does (the game updates the last built
 * first); `ascending` builds them the other way, the build order variant of the rule checks.
 */
export function containerMechanicBlueprint(variant: ContainerMechanicCase, order: "descending" | "ascending" = "descending"): string {
    const inserters = variant.entities.filter(entity => entity.name === "stack-inserter");
    const others = variant.entities.filter(entity => entity.name !== "stack-inserter");
    const entities = [...others, ...(order === "descending" ? [...inserters].reverse() : inserters)];
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Containers ${variant.name}`, version: 562949955649536,
        entities: entities.map((entity, index) => ({entity_number: index + 1, ...entity}))}} as unknown as FactorioBlueprintFile);
}

/** Items a drill's container may part by between the game and the simulator in a tick of its fill (measured: 4 at most) */
const DRILL_FILL_TOLERANCE = 16;

/** The hand each time it was at its fullest, before items left it */
function handsOf(changes: string[]): string[] {
    const count = (hand: string) => hand === "" ? 0 : Number(hand.split(":")[1]);
    const hands: string[] = [];
    let previous = "";
    for (const hand of changes) {
        if (previous !== "" && count(hand) < count(previous)) hands.push(previous);
        previous = hand;
    }
    return hands;
}

interface Observed {hands: string[][]; held: string[]; slots?: string[]; rocket?: Record<string, number>; input?: Record<string, number>;
    /** What a drill-fed container holds of its items in all at the end of each of the first ticks */
    fill?: number[]; chest?: Record<string, number>}

/** The simulator's run of the same build, every inserter enabled, for as many ticks */
export function simulateContainerMechanic(config: Config, ticks: number, fill_ticks = 0): Observed {
    const context = SimulationContext.fromConfig(config);
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates(), ...context.drills]);
    const drill_target = context.drills[0]?.drill_state.drill.sink_id;
    const drill_fed = drill_target === undefined ? undefined : context.state_registry.getStateByEntityIdOrThrow(drill_target);
    const fill: number[] = [];
    const inserters = context.inserters.map(it => it.inserter_state).sort((a, b) => a.inserter.entity_id.number - b.inserter.entity_id.number);
    const hand = (index: number) => {
        const held = inserters[index].held_item;
        return held === null ? "" : `${held.item_name}:${held.quantity}`;
    };
    const changes = inserters.map(() => [] as string[]);
    const last = inserters.map((_, index) => hand(index));
    for (let i = 0; i < ticks; i++) {
        tick.executeForTick();
        if (drill_fed && EntityState.isChest(drill_fed) && i < fill_ticks) fill.push(drill_fed.getCurrentQuantity());
        inserters.forEach((_, index) => {
            const now = hand(index);
            if (now !== last[index]) changes[index].push(now);
            last[index] = now;
        });
    }
    const states = context.state_registry.getAllStates();
    const container = states.find(EntityState.isSlotContainer);
    const silo = states.find(EntityState.isRocketSilo);
    const buffer = states.find(EntityState.isBufferChest);
    const nonzero = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).filter(([, count]) => count > 0));
    return {
        hands: changes.map(handsOf), held: inserters.map((_, index) => hand(index)),
        ...(fill_ticks > 0 && {fill}),
        ...(buffer && {chest: nonzero({[buffer.chest.item_filter]: buffer.getCurrentQuantity()})}),
        ...(container && {slots: container.inventoryState.slots.map(slot => slot.item === null ? "" : `${slot.item}:${slot.count}`)}),
        ...(silo && {rocket: nonzero(silo.inventoryState.rocket.export()), input: nonzero(silo.inventoryState.input.export())}),
    };
}

for (const variant of containerMechanicCases()) test(`containers as chests: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.CONTAINERS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, variant.name) : fs.mkdtempSync(path.join(os.tmpdir(), "containers-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty CONTAINERS_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const config = ConfigSchema.parse(variant.config);
        // the rule checks' variants: the inserters built the other way (CONTAINERS_BUILD_ORDER=ascending), and the build
        // moved (CONTAINERS_POSITION=x,y); the ascending order serves the inserters in the reverse of the simulator's
        // order, so it is recorded and compared but not asserted
        const order = process.env.CONTAINERS_BUILD_ORDER === "ascending" ? "ascending" : "descending";
        const [x, y] = (process.env.CONTAINERS_POSITION ?? "").split(",").map(Number);
        const position = Number.isFinite(x) && Number.isFinite(y) && process.env.CONTAINERS_POSITION ? {x, y} : undefined;
        const blueprint = containerMechanicBlueprint(variant, order);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"), {ticks: variant.ticks, ...variant.probe});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"), ...(position && {position}),
            // the ore the config's drill mines, put under it by the harness
            drill_resource: drillResourceOf({config}),
            ticks: variant.ticks + 60, warmup_ticks: variant.warmup_ticks ?? 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/containers-probe.json"), "utf8"));
        const game: Observed = {
            hands: (report.hands as {hand: string}[][]).map(changes => handsOf(Object.values(changes).map(change => change.hand))),
            held: Object.values(report.held) as string[],
            ...(report.slots && {slots: Object.values(report.slots) as string[]}),
            ...(report.rocket && {rocket: report.rocket, input: report.input}),
            ...(report.fill && {fill: Object.values(report.fill) as number[]}),
            ...(report.chest && {chest: report.chest}),
        };
        const simulated = simulateContainerMechanic(config, variant.ticks, Number(variant.probe.fill_ticks ?? 0));
        fs.writeFileSync(path.join(scratch, "comparison.json"), JSON.stringify({order, position: position ?? null, game, simulated,
            rocket_parts: report.rocket_parts, drill: report.drill}, null, 2) + "\n");
        if (report.rocket_parts !== undefined) expect(report.rocket_parts, "the silo crafted nothing").toBe(0);
        if (order === "descending") {
            // a drill's container fills by the same amounts a tick, from the tick the drill first drops: the game mines by
            // a progress bar, the simulator by the rate a tick floored, so the totals may part by a few items
            const {fill: game_fill, ...game_rest} = game, {fill: simulated_fill, ...simulated_rest} = simulated;
            if (variant.warmup_ticks === undefined) expect(simulated_rest).toEqual(game_rest);
            // started warm, the game's taker is in another phase of its swings than the simulator's, which starts empty:
            // what the container holds is compared
            else expect(simulated_rest.chest).toEqual(game_rest.chest);
            if (game_fill && simulated_fill) {
                const from = game_fill.findIndex(total => total > 0);
                game_fill.slice(from).forEach((total, tick) => expect(Math.abs(total - simulated_fill[tick]), `tick ${tick} of the fill`).toBeLessThanOrEqual(DRILL_FILL_TOLERANCE));
            }
        }
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 360_000);
