import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {Config, ConfigSchema} from "../../../../src/config";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {DrillStateMachine} from "../../../../src/control-logic/drill/drill-state-machine";
import {DrillChestWorkingMode} from "../../../../src/control-logic/drill/modes/chest-working-mode";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {ChestState} from "../../../../src/state";
import {composeProbeSource} from "../../helpers/probe-source";

/**
 * A big mining drill into a legendary steel chest, one build a research level, from 0.425 to 25,000 items a tick, against
 * the simulator tick by tick (chest-probe.lua): the chest filled from empty by the drill always enabled, and refilled
 * from full after takes by the drill enabled 1, 2 or 3 ticks at a time. See README.md, "A drill into a chest".
 */
interface ChestCase {
    name: string;
    /** Mining productivity 3's level, 1 and 2 researched: (level - 1) x 10% */
    level: number;
    mode: "fill" | "gated";
    ticks: number;
    drill_last?: boolean;
    position?: {x: number; y: number};
}

const LEVELS = [8, 45, 400, 4000, 7999, 40000, 100000, 1000000];
/** The drill's items a tick: 4 legendary speed modules 3 move its bar 0.25 a tick */
const rateOf = (level: number) => 0.25 * (1 + (level - 1) * 0.1);
const fillTicks = (level: number) => Math.min(18000, Math.ceil(6000 / rateOf(level)) + 60);
/** Every 30 ticks a take of all, 1,000, 100 or 10 ore, and from tick 5 a window of 1, 2 or 3 ticks: 24 of each kind */
const GATED = {period: 30, takes: [-1, 1000, 100, 10], open: 5, windows: [1, 2, 3]};
const GATED_TICKS = 24 * GATED.period;

export function chestCases(): ChestCase[] {
    return [
        ...LEVELS.map((level): ChestCase => ({name: `fill-l${level}`, level, mode: "fill", ticks: fillTicks(level)})),
        ...LEVELS.map((level): ChestCase => ({name: `gated-l${level}`, level, mode: "gated", ticks: GATED_TICKS})),
        // the rule check's variants, at levels where one mining tick fills the chest or nearly does
        {name: "fill-l40000-drill-last", level: 40000, mode: "fill", ticks: fillTicks(40000), drill_last: true},
        {name: "gated-l100000-drill-last", level: 100000, mode: "gated", ticks: GATED_TICKS, drill_last: true},
        {name: "gated-l100000-moved", level: 100000, mode: "gated", ticks: GATED_TICKS, position: {x: 203, y: -141}},
    ];
}

function chestBlueprint(variant: ChestCase): string {
    const drill = {name: "big-mining-drill", position: {x: 0.5, y: 0.5}, direction: 4, items: [{id: {name: "speed-module-3", quality: "legendary"},
        items: {in_inventory: Array.from({length: 4}, (_, stack) => ({inventory: 2, stack}))}}]};
    const chest = {name: "steel-chest", quality: "legendary", position: {x: 3.5, y: 0.5}};
    // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the drill
    const idle = {name: "assembling-machine-1", position: {x: 0.5, y: 9.5}, recipe: "rail"};
    const entities = variant.drill_last ? [chest, idle, drill] : [drill, chest, idle];
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Drill chest ${variant.name}`, version: 562949955649536,
        entities: entities.map((entity, index) => ({entity_number: index + 1, ...entity}))}} as unknown as FactorioBlueprintFile);
}

/** The build as a config: the steel chest as a buffer chest of iron ore with its slots, the drill as the game has it */
export function chestConfig(slots: number, productivity: number, speed_bonus: number): Config {
    return ConfigSchema.parse({
        target_output: {recipe: "iron-plate", items_per_second: 1, copies: 1}, belts: [], inserters: [],
        machines: [{id: 1, recipe: "iron-plate", crafting_speed: 1, productivity: 0, type: "furnace"}],
        drills: {configs: [{id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus, productivity, target: {type: "chest", id: 1}}]},
        chests: [{id: 1, type: "buffer-chest", storage_size: slots, item_filter: "iron-ore"}],
    });
}

interface Row {t: number; n: number; p: number; b: number; d: boolean; r?: number; g?: number}
interface Tick {n: number; p: number; b: number; hold: number; enabled: boolean; room_before: number; hold_before: number}

/**
 * The simulator's drill driven by the game's probe, tick by tick: the probe takes and switches the gate after the
 * tick's entities, so in tick k the chest has lost row k - 1's take before the drill, and the drill is enabled when it
 * was not disabled in row k - 1. Game row k is the simulator's k-th tick.
 */
export function replayChest(config: Config, log: Row[], room: number): Tick[] {
    const context = SimulationContext.fromConfig(config);
    const drill_state = context.drills[0].drill_state;
    const chest = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id) as ChestState;
    if (log[0].n > 0) chest.inventoryState.addQuantity("iron-ore", log[0].n);
    let enabled = true;
    const drill = DrillStateMachine.create({drill_state, sink_state: chest, enable_control: {isEnabled: () => enabled}});
    const mode = Array.from(drill.modes).find(it => it instanceof DrillChestWorkingMode) as DrillChestWorkingMode;
    const hold = () => drill_state.inventoryState.getQuantity("iron-ore");
    const ticks: Tick[] = [{n: log[0].n, p: 0, b: 0, hold: 0, enabled: true, room_before: room - log[0].n, hold_before: 0}];
    for (let k = 1; k < log.length; k++) {
        if ((log[k - 1].r ?? 0) > 0) chest.inventoryState.removeQuantity("iron-ore", log[k - 1].r!);
        enabled = !log[k - 1].d;
        const room_before = room - chest.getCurrentQuantity("iron-ore");
        const hold_before = hold();
        drill.executeForTick();
        ticks.push({n: chest.getCurrentQuantity("iron-ore"), p: mode.progress.mining_progress, b: mode.progress.bonus_progress,
            hold: hold(), enabled, room_before, hold_before});
    }
    return ticks;
}

for (const variant of chestCases()) test(`drill into a chest: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DRILLS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, variant.name) : fs.mkdtempSync(path.join(os.tmpdir(), "drills-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty DRILLS_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const blueprint = chestBlueprint(variant);
        const lua = composeProbeSource(path.join(__dirname, "chest-probe.lua"),
            {mode: variant.mode, level: variant.level, ticks: variant.ticks, ...(variant.mode === "gated" && GATED)});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), drill_resource: "iron-ore", ...(variant.position && {position: variant.position}),
            ticks: variant.ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false,
            timeout_seconds: 600, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/chest-probe.json"), "utf8"));
        const log = Object.values(report.log) as Row[];
        const {room, slots, productivity_bonus, speed_bonus, mining_speed} = report.info;
        expect(room, "a legendary steel chest's room for iron ore").toBe(6000);
        const rate = mining_speed * (1 + speed_bonus) / 60 * (1 + productivity_bonus);
        expect(rate, "the drill's items a tick").toBeCloseTo(rateOf(variant.level), 6);

        const replay = replayChest(chestConfig(slots, productivity_bonus * 100, speed_bonus), log, room);
        fs.writeFileSync(path.join(scratch, "comparison.json"), JSON.stringify({info: report.info, game: log, replay}) + "\n");
        for (let k = 1; k < log.length; k++) {
            expect(replay[k].n, `the chest's count at tick ${k}`).toBe(log[k].n);
            expect(Math.abs(replay[k].p - log[k].p), `the mining bar at tick ${k}: ${replay[k].p} against ${log[k].p}`).toBeLessThan(1e-6);
            expect(Math.abs(replay[k].b - log[k].b), `the bonus bar at tick ${k}: ${replay[k].b} against ${log[k].b}`).toBeLessThan(1e-6);
        }
        if (variant.mode === "fill") {
            // the chest is full a tick after the mining ticks its room takes: what a tick mines drops in the next
            const full = log.findIndex(row => row.n >= room);
            expect(full, "the chest fills").toBeGreaterThan(0);
            if (rate >= 10) expect(full, "the tick the chest is full").toBe(Math.ceil(room / rate) + 1);
            // no cap on a tick's drop: a hold of more than the chest's room drops as far as the room in one tick
            if (rate >= room) expect(log[2].n, "the chest's count in the drill's second tick").toBe(room);
        } else {
            // a window whose first tick finds the drill holding the chest's room fills it in that tick
            const covered = replay.filter((tick, k) => k > GATED.period && tick.enabled && !replay[k - 1].enabled && tick.hold_before >= tick.room_before);
            for (const tick of covered) expect(tick.n, "a window whose hold covers the room").toBe(room);
            if (rate >= room) expect(covered.length, "windows whose hold covers the room").toBeGreaterThan(0);
        }
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 700_000);
