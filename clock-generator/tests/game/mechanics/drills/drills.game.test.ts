import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {Config, ConfigSchema} from "../../../../src/config";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {CompositeControlLogic, TickControlLogic} from "../../../../src/control-logic";
import {DrillStateMachine} from "../../../../src/control-logic/drill/drill-state-machine";
import {DrillChestWorkingMode} from "../../../../src/control-logic/drill/modes/chest-working-mode";
import {DrillWorkingMode} from "../../../../src/control-logic/drill/modes/working-mode";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {miningDrillMaxInsertion} from "../../../../src/entities";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {EntityState, MachineState} from "../../../../src/state";
import {composeProbeSource} from "../../helpers/probe-source";

/**
 * Mining drills at a low research level, set by script, against the simulator tick by tick: a big mining drill at 0.25
 * to 1.35 items a tick into a car that an inserter empties, and into an assembling machine that crafts (landfill) or
 * never does (rail). See README.md.
 */
interface DrillCase {
    name: string;
    /** "levels": mining productivity 1 and 2 researched and 3 at `level`; "none": none of them, the bonus 0 */
    research: "levels" | "none";
    level: number;
    ticks: number;
    /** Legendary speed modules 3 in the drill: 4 move its bar 0.25 a tick, 3 0.198 */
    modules: number;
    /** Legendary productivity modules 3 in the drill after the speed modules, +25% each */
    productivity_modules?: number;
    sink: "car" | "landfill" | "rail";
    /** The inserter that empties the car or takes the landfill */
    taker?: "inserter" | "stack-inserter";
    /** The drill built after the others (the game updates the last built first) */
    drill_last?: boolean;
    position?: {x: number; y: number};
    /** Ticks at which a constant combinator on the drill's circuit condition flips; the drill starts enabled */
    gate?: number[];
    /**
     * Whether the simulator's run of the whole build is compared too: false where its sink parts from the game's for a
     * reason that is not the drill's (README.md)
     */
    simulated: boolean;
}

function carCase(name: string, level: number, modules: number, taker: "inserter" | "stack-inserter", ticks: number, extra: Partial<DrillCase> = {}): DrillCase {
    return {name, research: "levels", level, ticks, modules, sink: "car", taker, simulated: taker === "stack-inserter" && !extra.gate, ...extra};
}

function machineCase(name: string, level: number, recipe: "landfill" | "rail", ticks: number, extra: Partial<DrillCase> = {}): DrillCase {
    return {name, research: "levels", level, ticks, modules: 4, sink: recipe, ...(recipe === "landfill" && {taker: "stack-inserter"}),
        simulated: false, ...extra};
}

export function drillCases(): DrillCase[] {
    return [
        // into a car with 100 ore of room: 0.425, 0.925 and 1.35 items a tick, and 0.336 with a bar step that does not
        // divide 1; with no research the bonus is 0 and the drill makes 0.25
        carCase("car-l8", 8, 4, "inserter", 900),
        carCase("car-l28", 28, 4, "stack-inserter", 900),
        carCase("car-l45", 45, 4, "stack-inserter", 600),
        carCase("car-l8-3m", 8, 3, "inserter", 900),
        {...carCase("car-none", 3, 4, "stack-inserter", 600), research: "none"},
        // the drill's own productivity: 4 legendary productivity modules 3 and no research, +100% (0.0167 a tick)
        {...carCase("car-prod4-none", 3, 0, "stack-inserter", 900), research: "none", productivity_modules: 4},
        // into an assembler: landfill takes 50 stone a craft (0.83 a tick); rail never crafts
        machineCase("landfill-l8", 8, "landfill", 900, {simulated: true}),
        machineCase("landfill-l45", 45, "landfill", 900),
        machineCase("rail-l28", 28, "rail", 900),
        machineCase("rail-l45", 45, "rail", 600),
        // the rule check's variants: the drill built last, the build moved to another chunk
        carCase("car-l45-drill-last", 45, 4, "stack-inserter", 600, {drill_last: true}),
        carCase("car-l8-3m-drill-last", 8, 3, "inserter", 900, {drill_last: true}),
        machineCase("landfill-l45-drill-last", 45, "landfill", 900, {drill_last: true}),
        carCase("car-l28-moved", 28, 4, "stack-inserter", 900, {position: {x: 203, y: -141}}),
        machineCase("landfill-l45-moved", 45, "landfill", 900, {position: {x: 203, y: -141}}),
        // disabled by its circuit condition while it holds items and its bars are part way
        carCase("car-l28-gated", 28, 4, "stack-inserter", 600, {gate: [20, 60, 61, 120, 125, 200, 202, 400]}),
        machineCase("landfill-l45-gated", 45, "landfill", 600, {gate: [30, 90, 93, 150, 152, 300, 301, 302, 420]}),
        machineCase("rail-l8-gated", 8, "rail", 900, {gate: [7, 50, 53, 100, 101, 102, 160, 200]}),
    ];
}

const RESOURCE = {car: "iron-ore", landfill: "stone", rail: "stone"} as const;
/**
 * The game's stop into the assembler: the larger of the stack (50) and the automated insertion limit (3 for rail, 150
 * for landfill), + 64; and the builds whose machine reaches it in the game
 */
const STOP = {landfill: 214, rail: 114} as const;
const STOP_REACHED = new Set(["landfill-l45", "landfill-l45-drill-last", "landfill-l45-moved", "rail-l28", "rail-l45", "rail-l8-gated"]);

export function drillBlueprint(variant: DrillCase): string {
    const modules = (name: string, count: number, first: number) => count ? [{id: {name, quality: "legendary"},
        items: {in_inventory: Array.from({length: count}, (_, stack) => ({inventory: 2, stack: first + stack}))}}] : [];
    const drill = {name: "big-mining-drill", position: {x: 0.5, y: 0.5}, direction: 4, items: [...modules("speed-module-3", variant.modules, 0),
        ...modules("productivity-module-3", variant.productivity_modules ?? 0, variant.modules)]};
    // the owner's car build's geometry (the containers family), 78 of the car's 80 slots filtered to copper plates
    const sink = variant.sink === "car"
        ? {name: "car", position: {x: 4.668, y: 1.008}, orientation: 0.25,
            trunk_inventory: {filters: Array.from({length: 78}, (_, index) => ({index: index + 1, name: "copper-plate"}))}}
        : {name: "assembling-machine-1", position: {x: 4.5, y: 0.5}, recipe: variant.sink};
    const taker = variant.taker ? [{name: variant.taker, position: {x: 6.5, y: 0.5}, direction: 12},
        {name: "infinity-chest", position: {x: 7.5, y: 0.5}, infinity_settings: {remove_unfiltered_items: true, filters: []}}] : [];
    const entities = variant.drill_last ? [sink, ...taker, drill] : [drill, sink, ...taker];
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Drills ${variant.name}`, version: 562949955649536,
        entities: entities.map((entity, index) => ({entity_number: index + 1, ...entity}))}} as unknown as FactorioBlueprintFile);
}

/**
 * The build as a config, the drill at `productivity` percent and `speed_bonus` (what the sidecar exports for it: the
 * drill's `productivity_bonus` x 100 and `speed_bonus`)
 */
export function drillConfig(variant: DrillCase, productivity: number, speed_bonus: number): Config {
    const drills = {configs: [{id: 1, type: "big-mining-drill", mined_item_name: RESOURCE[variant.sink], speed_bonus, productivity, target: variant.sink === "car" ? {type: "chest", id: 1} : {type: "machine", id: 1}}]};
    const source = variant.sink === "car" ? {type: "chest", id: 1} : {type: "machine", id: 1};
    const inserters = variant.taker ? [{id: 1, source, sink: {type: "chest", id: 10}, prototype: variant.taker, quality: "normal"}] : [];
    const disposal = {type: "infinity-chest", id: 10, item_filter: [], remove_unfiltered_items: true};
    if (variant.sink === "car") {
        return ConfigSchema.parse({target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1}, belts: [], drills, inserters,
            machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}],
            chests: [{type: "car", id: 1, slot_filters: Array.from({length: 78}, (_, index) => ({slot: index + 1, item: "copper-plate"}))}, disposal]});
    }
    return ConfigSchema.parse({target_output: {recipe: variant.sink, items_per_second: 0.1, copies: 1}, belts: [], drills, inserters,
        machines: [{id: 1, recipe: variant.sink, crafting_speed: 0.5, productivity: 0}], chests: inserters.length ? [disposal] : []});
}

interface Row {t: number; n: number; p: number; b: number; d: boolean; h?: number}
interface Tick {t: number; n: number; p?: number; b?: number}

/**
 * The simulator's drill driven by the game's sink, tick by tick: in each tick the sink loses what the game's took from
 * it (the taker's hand growth, or a craft's ingredients when the machine's count falls), before the drill, and the
 * drill is disabled where the game's was. Game row k is the simulator's k-th tick (the game's drill has no mining
 * target in the recording's first tick). Into a machine, also the drill's stop (`miningDrillMaxInsertion`, rule 3 of
 * the rules of the game: the larger of the stack and the automated insertion limit, + 64).
 */
export function replayDrill(config: Config, log: Row[]): {ticks: Tick[]; machine_stop?: number} {
    const context = SimulationContext.fromConfig(config);
    const drill_state = context.drills[0].drill_state;
    const item = drill_state.drill.item;
    const sink = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id);
    let enabled = true;
    const drill = DrillStateMachine.create({drill_state, sink_state: sink, enable_control: {isEnabled: () => enabled}});
    const mode = Array.from(drill.modes).find(it => it instanceof DrillWorkingMode || it instanceof DrillChestWorkingMode)!;
    const machine = EntityState.isMachine(sink) ? sink.machine : undefined;
    const input = machine?.inputs.getOrThrow(item.name);
    const count = () => EntityState.isChest(sink) ? sink.getCurrentQuantity(item.name) : (sink as MachineState).inventoryState.getItemOrThrow(item.name).quantity;
    const ticks: Tick[] = [{t: 0, n: count(), p: 0, b: 0}];
    for (let k = 1; k < log.length; k++) {
        const taken = input ? (log[k].n < log[k - 1].n ? input.consumption_rate.amount_per_craft : 0) : Math.max(0, (log[k].h ?? 0) - (log[k - 1].h ?? 0));
        if (taken > 0) sink.inventoryState.removeQuantity(item.name, taken);
        enabled = !log[k - 1].d;
        drill.executeForTick();
        ticks.push({t: k, n: count(), p: mode.progress.mining_progress, b: mode.progress.bonus_progress});
    }
    return {ticks, ...(machine && {machine_stop: miningDrillMaxInsertion(drill_state.drill, machine)})};
}

/** The simulator's run of the whole build: every entity simulated, the drill always enabled */
export function simulateDrillBuild(config: Config, ticks: number): Tick[] {
    const context = SimulationContext.fromConfig(config);
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates(), ...context.drills]);
    const drill_state = context.drills[0].drill_state;
    const item = drill_state.drill.item.name;
    const sink = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id);
    const count = () => EntityState.isChest(sink) ? sink.getCurrentQuantity(item) : (sink as MachineState).inventoryState.getItemOrThrow(item).quantity;
    const out: Tick[] = [{t: 0, n: count()}];
    for (let k = 1; k <= ticks; k++) {
        tick.executeForTick();
        out.push({t: k, n: count()});
    }
    return out;
}

for (const variant of drillCases()) test(`drills at low research: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DRILLS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, variant.name) : fs.mkdtempSync(path.join(os.tmpdir(), "drills-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty DRILLS_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const blueprint = drillBlueprint(variant);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"),
            {research: variant.research, level: variant.level, ticks: variant.ticks, ...(variant.gate && {gate: variant.gate})});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), drill_resource: RESOURCE[variant.sink], ...(variant.position && {position: variant.position}),
            ticks: variant.ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false,
            timeout_seconds: 300, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/drills-probe.json"), "utf8"));
        const log = Object.values(report.log) as Row[];

        // the productivity: the drill's is the force's research bonus and its productivity modules' together, and the
        // config is what the sidecar exports for it (the drill is exported only once it has dropped: README.md)
        const module_bonus = 0.25 * (variant.productivity_modules ?? 0);
        expect(report.drill.productivity_bonus, "the drill's productivity").toBeCloseTo(report.research.bonus + module_bonus, 9);
        const exported = report.drill.productivity_bonus * 100;
        // legendary speed modules 3 give +125% each, productivity modules 3 -15%
        const speed_bonus = 1.25 * variant.modules - 0.15 * (variant.productivity_modules ?? 0);
        expect(report.drill.speed_bonus, "the speed bonus").toBeCloseTo(speed_bonus, 9);
        const config = drillConfig(variant, exported, speed_bonus);

        // the drill against the game's, every tick; into a machine, the drill's stop is where the game's stopped
        const {ticks: replay, machine_stop} = replayDrill(config, log);
        const simulated = variant.simulated ? simulateDrillBuild(config, log.length - 1) : undefined;
        const game_max = Math.max(...log.map(row => row.n));
        fs.writeFileSync(path.join(scratch, "comparison.json"), JSON.stringify({exported, bonus: report.research.bonus,
            drill_bonus: report.drill.productivity_bonus, machine_stop,
            game_max, game: log, replay, simulated}) + "\n");
        if (machine_stop !== undefined) {
            expect(machine_stop, "the drill's stop").toBe(STOP[variant.sink as "landfill" | "rail"]);
            expect(game_max, "the game's machine at most at the drill's stop").toBeLessThanOrEqual(machine_stop);
            if (STOP_REACHED.has(variant.name)) expect(game_max, "the game's machine reaches the drill's stop").toBe(machine_stop);
        }
        for (let k = 1; k < log.length; k++) {
            expect(replay[k].n, `the sink's count at tick ${k}`).toBe(log[k].n);
            expect(Math.abs(replay[k].p! - log[k].p), `the mining bar at tick ${k}: ${replay[k].p} against ${log[k].p}`).toBeLessThan(1e-6);
            expect(Math.abs(replay[k].b! - log[k].b), `the bonus bar at tick ${k}: ${replay[k].b} against ${log[k].b}`).toBeLessThan(1e-6);
        }
        // the whole build in the simulator, where its sink is the game's
        if (simulated) simulated.forEach((tick, k) => expect(tick.n, `the simulator's sink at tick ${k}`).toBe(log[k].n));
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 360_000);
