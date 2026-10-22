import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {CargoWagonConfigSchema, Config, ConfigSchema} from "../../../../src/config";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {CompositeControlLogic, TickControlLogic} from "../../../../src/control-logic";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {EntityState} from "../../../../src/state";
import {SlotContainer} from "../../../../src/entities/chest/slot-container";
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

export function containerMechanicCases(): ContainerMechanicCase[] {
    const silo_contents = {rocket: [["iron-plate", 100], ["copper-plate", 40], ["iron-gear-wheel", 20]], input: [["processing-unit", 10], ["low-density-structure", 10]]};
    const car_contents = [[1, "iron-plate", 40], [2, "copper-plate", 100], [5, "iron-gear-wheel", 30], [9, "iron-plate", 100]];
    const blocked_filters = Array.from({length: 39}, (_, index) => ({slot: index + 2, item: index % 2 ? "no-item" : "deconstruction-planner"}));
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
        {
            name: "wagon-blocked-slots", ticks: 500,
            entities: [...Array.from({length: 9}, (_, index) => ({name: "straight-rail", position: {x: 1, y: -7 + 2 * index}, direction: 0})),
                {name: "cargo-wagon", position: {x: 1, y: 0.5}, orientation: 0,
                    inventory: {filters: blocked_filters.map(filter => ({index: filter.slot, name: filter.item}))}},
                chestEntity(-1.5, 0.5, "iron-plate"), inserterEntity(-0.5, 0.5, 12)],
            config: {...idle, chests: [{type: "cargo-wagon", id: 1, slot_filters: blocked_filters}, supply(10, "iron-plate")],
                inserters: [{id: 1, source: {type: "chest", id: 10}, sink: {type: "chest", id: 1}, stack_size: 16}]},
            probe: {sidecar: true},
        },
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

interface Observed {hands: string[][]; held: string[]; slots?: string[]; rocket?: Record<string, number>; input?: Record<string, number>}

/** The simulator's run of the same build, every inserter enabled, for as many ticks */
export function simulateContainerMechanic(config: Config, ticks: number): Observed {
    const context = SimulationContext.fromConfig(config);
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates()]);
    const inserters = context.inserters.map(it => it.inserter_state).sort((a, b) => a.inserter.entity_id.number - b.inserter.entity_id.number);
    const hand = (index: number) => {
        const held = inserters[index].held_item;
        return held === null ? "" : `${held.item_name}:${held.quantity}`;
    };
    const changes = inserters.map(() => [] as string[]);
    const last = inserters.map((_, index) => hand(index));
    for (let i = 0; i < ticks; i++) {
        tick.executeForTick();
        inserters.forEach((_, index) => {
            const now = hand(index);
            if (now !== last[index]) changes[index].push(now);
            last[index] = now;
        });
    }
    const states = context.state_registry.getAllStates();
    const container = states.find(EntityState.isSlotContainer);
    const silo = states.find(EntityState.isRocketSilo);
    const nonzero = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).filter(([, count]) => count > 0));
    return {
        hands: changes.map(handsOf), held: inserters.map((_, index) => hand(index)),
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
            ticks: variant.ticks + 60, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/containers-probe.json"), "utf8"));
        const game: Observed = {
            hands: (report.hands as {hand: string}[][]).map(changes => handsOf(Object.values(changes).map(change => change.hand))),
            held: Object.values(report.held) as string[],
            ...(report.slots && {slots: Object.values(report.slots) as string[]}),
            ...(report.rocket && {rocket: report.rocket, input: report.input}),
        };
        const simulated = simulateContainerMechanic(config, variant.ticks);
        fs.writeFileSync(path.join(scratch, "comparison.json"), JSON.stringify({order, position: position ?? null, game, simulated,
            rocket_parts: report.rocket_parts}, null, 2) + "\n");
        if (report.rocket_parts !== undefined) expect(report.rocket_parts, "the silo crafted nothing").toBe(0);
        if (variant.probe.sidecar) {
            // Recorder uses the real Sidecar extraction/export pipeline when it starts this capture.
            const recording = JSON.parse(fs.readFileSync(path.join(scratch, 'recording.json'), 'utf8'));
            const exported = (Object.values(recording.config.chests) as { type: string }[]).find(chest => chest.type === 'cargo-wagon');
            const expected = config.chests!.find(chest => chest.type === 'cargo-wagon')!;
            expect(exported).toMatchObject({ slot_filters: expected.slot_filters });
            const imported = SlotContainer.fromConfig(CargoWagonConfigSchema.parse(exported), ['iron-plate']);
            expect(imported.getCapacity('iron-plate')).toBe(100);
            expect(imported.contents).toEqual([]);
            expect(game.slots?.[0]).toBe('iron-plate:100');
            expect(game.slots?.slice(1).every(slot => slot === '')).toBe(true);
        }
        if (order === "descending") expect(simulated).toEqual(game);
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 360_000);
