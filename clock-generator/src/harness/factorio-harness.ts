import { ChildProcess, spawn } from "child_process";
import dgram from "dgram";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import zlib from "zlib";
import { ClockGeneratorTags } from "../blueprints/components";
import { encodeBlueprintFile } from "../blueprints/serde";
import { Config } from "../config";
import { ClockSchedule } from "../crafting/blueprint";
import { sharedLaneRunsOf } from "../crafting/shared-lane-verdict";
import { EntityId } from "../entities/entity-id";
import { matchCopies } from "../verification/entity-copies";
import { matchRecordingToConfig } from "../verification/entity-matching";
import { BuiltClock, blueprintWithNamedClock, recordingOfBuiltClock } from "./built-clock";
import { parseRecording, Recording } from "../verification/recording";
import { RconClient } from "./rcon";
import { recipesMaking } from "./recording-output";
import {
    CacheEnvironment, RECORDING_CACHE_PROTOCOL, RecordingCacheKey, describedRecordingKey, recordingCacheDir, recordingCacheMode, restoreRecording,
    storeRecording,
} from "./recording-cache";

const RECORDER_MOD = "clock-generator-recorder";
const SIDECAR_MOD = "clock-generator-sidecar";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");
const RCON_READY = "Starting RCON interface";
const POLL_INTERVAL_MS = 100;
/** The tag of a schedule combinator in the clock blueprint the mod builds: the config ids of the inserters it enables */
const INSERTERS_TAG = "clock_generator_inserters";
/** The tag of a window combinator for drills: the config ids of the drills it enables, read off its "Drill N for" description */
const DRILLS_TAG = "clock_generator_drills";

/**
 * The most ticks one run in Factorio may record: 20 minutes of game time. It keeps the game-backed tests and
 * recordings from running excessively long; a longer recording is refused up front, not shortened. The ticks a build
 * warms up and settles for before it is recorded are not counted: a build takes what it takes to fill its belts and
 * settle.
 */
export const MAX_RECORDED_TICKS = 72_000;

/**
 * Ticks a recording of the requested length will hold. Without a clock, the ticks asked for. With one, the recorder
 * records whole window cycles of the clock until it has at least the ticks asked for, so the next multiple of the window cycle.
 */
export function recordedTicks(requested_ticks: number, clock_window_cycle_ticks: number | null): number {
    return clock_window_cycle_ticks === null ? requested_ticks : Math.ceil(requested_ticks / clock_window_cycle_ticks) * clock_window_cycle_ticks;
}

/**
 * Throws when the request is no whole positive number of ticks, or when what it would record is over
 * MAX_RECORDED_TICKS. `clock_window_cycle_ticks` is the window cycle the clock of the build counts, null when it has none or
 * the window cycle is not known before the run; the request alone is limited then.
 */
export function assertRecordableTicks(requested_ticks: number, clock_window_cycle_ticks: number | null = null): void {
    if (!Number.isInteger(requested_ticks) || requested_ticks <= 0) {
        throw new Error(`Ticks to record must be a whole number above 0, not ${requested_ticks}`);
    }
    const limit = `the limit of ${MAX_RECORDED_TICKS} ticks (${MAX_RECORDED_TICKS / 3600} minutes of game time) for one run in Factorio`;
    if (clock_window_cycle_ticks === null) {
        if (requested_ticks > MAX_RECORDED_TICKS) {
            throw new Error(`A recording of ${requested_ticks} ticks is over ${limit}. Record fewer ticks; warm-up and settle ticks do not count.`);
        }
        return;
    }
    const recorded = recordedTicks(requested_ticks, clock_window_cycle_ticks);
    if (recorded > MAX_RECORDED_TICKS) {
        const fits = Math.floor(MAX_RECORDED_TICKS / clock_window_cycle_ticks) * clock_window_cycle_ticks;
        throw new Error(`A request for ${requested_ticks} ticks records ${recorded}: whole window cycles of the clock, which counts ${clock_window_cycle_ticks} ticks. `
            + `That is over ${limit}. `
            + (fits > 0 ? `The most that fits is ${fits} ticks (${fits / clock_window_cycle_ticks} window cycles).` : "Not one window cycle of this clock fits.")
            + " Warm-up and settle ticks do not count.");
    }
}

/** A clock the generator made: its blueprint string, and what its combinators do as the generator made them */
export interface GeneratedClock {
    blueprint: string;
    schedule: ClockSchedule;
}

/** Items put into the build right before the recording starts */
export interface Seed {
    /** Which built entities get the items; every entity that can take them when absent */
    target?: { name?: string; type?: string; recipe?: string; unit_number?: number };
    item: string;
    /** Per entity; per lane of each belt piece for belts. Default 1 */
    count?: number;
    quality?: string;
    /** Default: wherever the entity takes the item (ingredient or fuel slot, chest, belt lanes) */
    inventory?: "input" | "output" | "fuel" | "modules" | "chest";
    /** 0 (fresh) to 1 */
    spoil_percent?: number;
}

export interface HarnessOptions {
    /** The Factorio executable, or the folder it is installed in */
    factorio: string;
    /** Save to build in. It is copied; the original is never written to */
    save: string;
    /** Blueprint string of the build */
    blueprint: string;
    /** Where the recording is written */
    out: string;
    /** Ticks to record. With a clock, whole window cycles until at least this many ticks */
    ticks: number;
    /** Ticks the build runs before seeding and recording, so belts are full */
    warmup_ticks: number;
    /** Ticks the build runs on its new clock and seeds before it is recorded, so its start-up is not in the recording */
    settle_ticks?: number;
    seed: Seed[];
    /** A generated clock that replaces the clock of the build; needs config */
    clock?: GeneratedClock;
    /** The config the clock was generated from: its inserter ids are the ones the clock's combinators name */
    config?: Config;
    /**
     * The clock the build came with, named by the test, for a build whose clock is not one the generator made (it has no
     * "Clock for ..." description). Without `clock` and `unclocked` that clock is kept and the recording is cut by it,
     * and its window cycle replaces the one read off a generated clock; with a generated `clock` it is the clock removed to
     * make room for it. Not with `unclocked`, nor in a staged start.
     */
    built_clock?: BuiltClock;
    /**
     * How many times the build holds the config, for a build of copies that share belts: a generated `clock` is wired to the
     * inserters of each. The copies are found from the build's machines and inserters (see matchCopies) and the run is refused
     * when their count differs. Absent, the build is one copy, and a machine or inserter beyond the config is refused as a
     * mismatch. Needs `clock`. In a staged start the inserters of every copy are built, and each config id of the clock is wired to
     * one inserter of each copy.
     */
    copies?: number;
    /** Remove the clock of the build and let its inserters run freely */
    unclocked: boolean;
    surface?: string;
    position?: { x: number; y: number };
    /**
     * The resource the harness creates under every mining drill of the blueprint before it builds it, as a drill is only
     * built on its ore and the save may have none there. Absent, it is what the config's drills mine when they all mine
     * one; a blueprint with drills that mine more than one is refused.
     */
    drill_resource?: string;
    /**
     * Lua run right before the recording starts, as a chunk called with (entities, surface, area, settle). `settle.finish()`
     * ends the settle in that tick, so a probe that runs until something happens in the game ends it then; `settle_ticks` stays
     * the most it may take. `settle.record_samples(n)` shortens a recording without a clock (a staged start, `record_at_once`)
     * to n samples; `ticks` stays the most it may take
     */
    lua?: string;
    /**
     * Record exactly `ticks` from the end of the settle, without waiting for the clock to wrap: the recording carries no clock.
     * For a probe that times its run in game ticks (a clock's window cycle can be far longer than the run)
     */
    record_at_once?: boolean;
    /** Scratch folder for Factorio's write data; a temporary folder that is removed afterwards when absent */
    work_dir?: string;
    /** Speed the game is set to as the build is built; absent, it stays what it is, as someone watching may have set it */
    game_speed?: number;
    /**
     * Build the cell in two stages and record from the tick its inserters and clock are placed in (see StagedStartOptions). The
     * belts, feeders, machines and chests are built first and run until the belts are saturated; then, in one tick, every inserter
     * of the cell is built in an order that is asked for and the clock is wired. `warmup_ticks` is not used and `settle_ticks`
     * must be absent: the recording starts the tick after, which the new inserters need to know their ends, with the machines and
     * their buffers empty. Needs `config`, unless the build
     * order is a list and there is no clock.
     */
    staged_start?: StagedStartOptions;
    /**
     * Also open the game with graphics, joined to the run as a spectator looking at the build, so it can be watched.
     * The run waits for it to join and, once recorded, for its window to be closed.
     */
    watch?: boolean;
    /** Show FPS and wake-up overlays in the graphical client. Defaults to true; disable for documentation captures. */
    watch_debug?: boolean;
    timeout_seconds: number;
    log: (message: string) => void;
    /**
     * false: this run always starts the game and keeps nothing. Without it, a recording the game already made for the same
     * game, save, mods, build, clock and probe is read back from the store of recordings instead (see recording-cache.ts), unless
     * the run is watched. For a check that proves a new clock in the game.
     */
    cache?: boolean;
}

/**
 * A staged start: the build is made without the inserters of the cell (those with an end on a crafting machine) and run until every
 * belt lane under a pickup of the cell is saturated; then the game is paused and, in that one tick, the inserters of the cell are
 * built one after the other and the clock is wired, and the recording starts. The game serves inserters that take from one
 * machine in the same tick in one fixed order while their hands are empty, and in an order that varies (mostly the one that went
 * to sleep first) when both hold part of a hand (docs/stability.md, #428). The build order of a staged start therefore fixes only
 * the start, not who is served first.
 */
export interface StagedStartOptions {
    /**
     * The order the inserters of the cell are BUILT in, by config id: "ascending" (the default: the highest config id is built last
     * and was served first in the #100 recording, which is what a blueprint of the cell in config order does), "descending" (the lowest is built last),
     * or a list of config ids, built in that order, followed by any not named in the order of the blueprint.
     */
    build_order?: "ascending" | "descending" | number[];
    /** Ticks in a row every lane that carries items has to be full at the pickup of an inserter of the cell. Default 30 */
    saturation_ticks?: number;
    /** Ticks the first stage may take before the run fails. Default 10,000 */
    saturation_cap_ticks?: number;
    /** Amount of the item put into every machine that makes and takes the same item (the egg loop), once, at the placement tick. Default 200 */
    loop_seed?: number;
    /** Ticks a trial build of the whole blueprint runs, to tell which built inserter is which config inserter. Default 900 */
    trial_build_ticks?: number;
    /**
     * Place the clock first: once the belts are saturated, the clock is built while the inserters of the cell are not, and runs alone
     * until its main counter (the decider described as "Clock for ...") reads this value on its own network. The counter is read with
     * the game paused, after every single tick, never worked out from the tick. In the paused tick it reads this value, the inserters
     * of the cell are built in the order asked for and wired to that same clock: nothing of the clock is built again, reset or
     * changed. 0 wires them in the tick the clock is placed in, when its counter has not counted yet. Needs a clock. Absent, the clock
     * is built in the tick the inserters are.
     */
    clock_phase?: number;
}

/** One inserter of the cell in a staged start, in the order the inserters are built: its config id, its copy (0 for the first) and where it stands from the middle of the blueprint */
export interface StagedInserter {
    config_id: number;
    copy: number;
    x: number;
    y: number;
}

/**
 * The order a staged start builds the inserters of the cell in (StagedStartOptions.build_order), from where each config inserter of
 * each copy stands. "ascending": by config id, and the copies of one id in the order of the copies; "descending": exactly that order
 * reversed; a list: the config ids named, each in every copy in the order of the copies, then the rest ascending. Refused when a
 * listed id matches no inserter of a copy.
 */
export function stagedBuildOrder(copies: Map<number, { x: number; y: number }>[], build_order: StagedStartOptions["build_order"]): StagedInserter[] {
    const ascending = copies
        .flatMap((stands_at, copy) => Array.from(stands_at, ([config_id, at]) => ({ config_id, copy, x: at.x, y: at.y })))
        .sort((a, b) => a.config_id - b.config_id || a.copy - b.copy);
    if (Array.isArray(build_order)) {
        const named = build_order.flatMap(id => copies.map((stands_at, copy) => {
            const found = ascending.find(it => it.config_id === id && it.copy === copy);
            if (!found) {
                const matched = Array.from(stands_at.keys()).sort((a, b) => a - b).join(", ");
                throw new Error(`The build order names config inserter ${id}, which matches no inserter of the build`
                    + `${copies.length > 1 ? ` in copy ${copy + 1} of ${copies.length}` : ""} (matched: ${matched})`);
            }
            return found;
        }));
        return [...named, ...ascending.filter(it => !build_order.includes(it.config_id))];
    }
    return build_order === "descending" ? [...ascending].reverse() : ascending;
}

/** One reading of the main counter of a clock placed first, with the game paused after the tick */
export interface ClockReading {
    tick: number;
    counter: number;
}

/**
 * Throws when the readings of a clock placed first are not one a tick from its placement on: each after exactly one more tick than
 * the one before, the last the first to read the phase asked for, and within two window cycles and two ticks of the placement.
 */
export function assertClockPriming(trace: ClockReading[], clock_phase: number, window_cycle_ticks: number): void {
    if (trace.length === 0) {
        throw new Error("The clock placed first was never read");
    }
    for (let index = 1; index < trace.length; index++) {
        if (trace[index].tick !== trace[index - 1].tick + 1) {
            throw new Error(`The clock placed first was read at tick ${trace[index - 1].tick} and next at tick ${trace[index].tick}: every tick is read`);
        }
    }
    const first = trace.findIndex(it => it.counter === clock_phase);
    if (first !== trace.length - 1) {
        throw new Error(first === -1
            ? `The main counter of the clock placed first never read ${clock_phase}: it read ${trace.map(it => it.counter).join(", ")}`
            : `The main counter of the clock placed first read ${clock_phase} at tick ${trace[first].tick}, before its last reading`);
    }
    if (trace.length - 1 > 2 * window_cycle_ticks + 2) {
        throw new Error(`The main counter of the clock placed first took ${trace.length - 1} ticks to read ${clock_phase}, over two window cycles of ${window_cycle_ticks} ticks and two`);
    }
}

/** What the game reports of a clock placed first, when it is placed (harness_place_clock) and when the inserters are wired to it (harness_start) */
interface PlacedClockReport {
    tick: number;
    counter: number;
    main_unit: number;
    combinators: Record<string, number> | number[];
    cell_ghosts: number;
    stock?: Record<string, { type: string; name: string; unit_number: number; input?: number; output?: number }> | { type: string; name: string; unit_number: number; input?: number; output?: number }[];
    placed_tick?: number;
}

/**
 * Throws when the inserters of a staged start were not wired to the clock placed first as it was placed and read: in the tick of its
 * last reading, with its counter reading the phase then, the same combinators and main counter, no inserter of the cell built
 * before, and the crafting machines empty.
 */
export function assertClockAttached(priming: { target: number; placed: PlacedClockReport; trace: ClockReading[] }, attach: PlacedClockReport | undefined): void {
    if (!attach) {
        throw new Error("The game did not report wiring the inserters to the clock placed first");
    }
    const last = priming.trace[priming.trace.length - 1];
    if (attach.tick !== last.tick || attach.placed_tick !== priming.placed.tick) {
        throw new Error(`The inserters were wired at tick ${attach.tick} to a clock placed at tick ${attach.placed_tick}, not at tick ${last.tick} to the one placed at tick ${priming.placed.tick}`);
    }
    if (attach.counter !== priming.target) {
        throw new Error(`The main counter read ${attach.counter} when the inserters were wired, not ${priming.target}`);
    }
    const placed_units = Object.values(priming.placed.combinators);
    const attach_units = Object.values(attach.combinators);
    if (attach.main_unit !== priming.placed.main_unit || attach_units.length !== placed_units.length || attach_units.some((unit, index) => unit !== placed_units[index])) {
        throw new Error(`The clock the inserters were wired to is not the one placed first: combinators ${attach_units.join(", ")} against ${placed_units.join(", ")}`);
    }
    if (attach.cell_ghosts !== priming.placed.cell_ghosts) {
        throw new Error(`${priming.placed.cell_ghosts - attach.cell_ghosts} inserters of the cell were built while the clock ran alone`);
    }
    const filled = Object.values(attach.stock ?? {}).filter(row => row.type !== "container" && ((row.input ?? 0) > 0 || (row.output ?? 0) > 0));
    if (filled.length > 0) {
        throw new Error(`Machines of the cell hold items before its inserters are built: ${filled.map(row => `${row.name} (unit ${row.unit_number}): ${row.input ?? 0} in, ${row.output ?? 0} out`).join("; ")}`);
    }
}

export interface HarnessResult {
    recording_path: string;
    recording: Recording;
    build: Record<string, unknown>;
    start: Record<string, unknown>;
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

/** The executable of an install folder, or the path itself when it already is a file */
async function resolveFactorioExecutable(factorio: string): Promise<string> {
    const stat = await fs.stat(factorio).catch(() => null);
    if (!stat) {
        throw new Error(`Factorio not found at ${factorio}`);
    }
    if (stat.isFile()) {
        return path.resolve(factorio);
    }
    const candidates = [
        ["bin", "x64", "factorio"],
        ["bin", "x64", "factorio.exe"],
        ["factorio.app", "Contents", "MacOS", "factorio"],
        ["Contents", "MacOS", "factorio"],
    ].map(parts => path.resolve(factorio, ...parts));
    for (const candidate of candidates) {
        if (await exists(candidate)) {
            return candidate;
        }
    }
    throw new Error(`No Factorio executable under ${factorio} (looked for ${candidates.join(", ")})`);
}

/** Game data sits beside MacOS inside an app bundle, or beside bin in a standalone install. */
export function factorioDataDir(executable: string): string {
    const executable_dir = path.dirname(executable);
    const app_bundle = path.basename(executable_dir) === "MacOS" && path.basename(path.dirname(executable_dir)) === "Contents";
    return app_bundle ? path.resolve(executable_dir, "..", "data") : path.resolve(executable_dir, "..", "..", "data");
}

async function freeTcpPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const port = (server.address() as net.AddressInfo).port;
            server.close(() => resolve(port));
        });
    });
}

async function freeUdpPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket("udp4");
        socket.once("error", reject);
        socket.bind(0, () => {
            const port = socket.address().port;
            socket.close(() => resolve(port));
        });
    });
}

/**
 * A write-data folder of its own for the game: the save, the mods of this repository and the mods that ship with
 * the game. Nothing in the Factorio install or the player's own saves and mods is written to.
 */
async function prepareWorkDir(work_dir: string, executable: string, save: string): Promise<{ config: string; save: string; settings: string }> {
    const data_dir = factorioDataDir(executable);
    const mods_dir = path.join(work_dir, "mods");
    await fs.rm(mods_dir, { recursive: true, force: true });
    await fs.rm(path.join(work_dir, "script-output"), { recursive: true, force: true });
    await fs.mkdir(mods_dir, { recursive: true });
    await fs.mkdir(path.join(work_dir, "saves"), { recursive: true });

    const mods: string[] = [];
    for (const entry of await fs.readdir(data_dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "core" && await exists(path.join(data_dir, entry.name, "info.json"))) {
            mods.push(entry.name);
        }
    }
    for (const mod of [RECORDER_MOD, SIDECAR_MOD]) {
        await fs.cp(path.join(REPOSITORY_ROOT, mod), path.join(mods_dir, mod), {
            recursive: true,
            filter: source => !source.endsWith(".zip"),
        });
        mods.push(mod);
    }
    await fs.writeFile(path.join(mods_dir, "mod-list.json"), JSON.stringify({ mods: mods.map(name => ({ name, enabled: true })) }, null, 2));

    const config = path.join(work_dir, "config.ini");
    await fs.writeFile(config, `[path]\nread-data=${data_dir}\nwrite-data=${work_dir}\n`);

    const settings = path.join(work_dir, "server-settings.json");
    await fs.writeFile(settings, JSON.stringify({
        name: "clock-generator-harness",
        description: "",
        tags: [],
        max_players: 0,
        visibility: { public: false, lan: false },
        username: "",
        password: "",
        token: "",
        game_password: "",
        require_user_verification: false,
        allow_commands: "true",
        autosave_interval: 0,
        autosave_slots: 1,
        // with nobody connected the server would never run a tick
        auto_pause: false,
        only_admins_can_pause_the_game: true,
        autosave_only_on_server: true,
        non_blocking_saving: false,
    }, null, 2));

    const save_copy = path.join(work_dir, "saves", path.basename(save));
    await fs.copyFile(save, save_copy);
    return { config, save: save_copy, settings };
}

/** Long bracket level that the text does not close, for passing JSON to Lua untouched */
function luaLongString(text: string): string {
    let level = 1;
    while (text.includes(`]${"=".repeat(level)}]`)) {
        level++;
    }
    const equals = "=".repeat(level);
    return `[${equals}[${text}]${equals}]`;
}

function decodeBlueprintString(blueprint: string): any {
    return JSON.parse(zlib.inflateSync(Buffer.from(blueprint.slice(1), "base64")).toString("utf-8"));
}

/**
 * A generated clock given only as a blueprint string, as `npm run record -- --clock=` takes it, with its schedule read
 * back from its combinators: the inserters each enables from its tags (ClockGeneratorTags), or, in a string from before
 * the tags, from its description ("Inserters 1, 2 for ..."); the clock is the decider described as "Clock for ..." (see
 * clockWindowCycleTicks). A clock from the generator itself comes with its schedule (BlueprintGenerationResult.schedule) and
 * needs none of this.
 */
export function clockOfBlueprintString(blueprint: string): GeneratedClock {
    const counted_ticks = clockWindowCycleTicks(blueprint);
    if (counted_ticks === null) {
        throw new Error("The clock blueprint has no clock the generator made: no decider described as \"Clock for ...\" that counts a window cycle");
    }
    const entities: { entity_number: number; player_description?: string; tags?: { clock_generator?: ClockGeneratorTags } }[] =
        decodeBlueprintString(blueprint).blueprint?.entities ?? [];
    const tagged = entities.some(entity => entity.tags?.clock_generator !== undefined);
    const inserter_combinators = entities.flatMap(entity => {
        if (tagged) {
            const inserter_ids = entity.tags?.clock_generator?.inserters ?? [];
            return inserter_ids.length > 0 ? [{ entity_number: entity.entity_number, inserter_ids }] : [];
        }
        const named = /^Inserters? ([\d, ]+) for/.exec(entity.player_description ?? "");
        return named ? [{ entity_number: entity.entity_number, inserter_ids: named[1].split(",").map(id => Number(id.trim())) }] : [];
    });
    return { blueprint, schedule: { counted_ticks, inserter_combinators } };
}

/** Config inserter ids the schedule combinators of a clock enable */
export function scheduledInserterIds(schedule: ClockSchedule): number[] {
    const ids = schedule.inserter_combinators.flatMap(it => it.inserter_ids);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

/** Ticks a clock counts before it starts over: the game keeps the whole part of the constant, so 90.947 counts 1 to 90 */
function clockWindowCycleOf(schedule: ClockSchedule): number {
    return Math.trunc(schedule.counted_ticks);
}

/**
 * The clock blueprint with each schedule combinator tagged with the config ids of the inserters it enables, and each
 * window combinator of drills with the config ids of those (its `clock_generator.drills` tag: the schedule lists
 * inserters only). The mod reads the tags off the ghosts it builds the clock from, to wire each combinator to its
 * inserters and drills.
 */
function withInserterTags(clock: GeneratedClock): string {
    const file = decodeBlueprintString(clock.blueprint);
    const inserter_ids = new Map(clock.schedule.inserter_combinators.map(it => [it.entity_number, it.inserter_ids]));
    for (const entity of file.blueprint?.entities ?? []) {
        const ids = inserter_ids.get(entity.entity_number);
        if (ids !== undefined) {
            entity.tags = { ...entity.tags, [INSERTERS_TAG]: ids };
        }
        const drill_ids = scheduledDrillIdsOf(entity);
        if (drill_ids.length > 0) {
            entity.tags = { ...entity.tags, [DRILLS_TAG]: drill_ids };
        }
    }
    return encodeBlueprintFile(file);
}

/**
 * The config ids of the drills a combinator of a clock enables: its `clock_generator.drills` tag, or, in a string from
 * before the tags, its description ("Drills 1, 2 for ...")
 */
function scheduledDrillIdsOf(entity: { player_description?: string; tags?: { clock_generator?: ClockGeneratorTags } }): number[] {
    if (entity.tags?.clock_generator !== undefined) {
        return entity.tags.clock_generator.drills ?? [];
    }
    const named = /^Drills? ([\d, ]+) for/.exec(entity.player_description ?? "");
    return named ? named[1].split(",").map(id => Number(id.trim())) : [];
}

/** The clock's drills are wired by the unit numbers of the built drills (see matchBuiltDrills) */
function assertDrillsWireable(clock: GeneratedClock, config: Config): void {
    const drill_ids = scheduledDrillIds(clock.blueprint);
    const config_ids = (config.drills?.configs ?? []).map(drill => drill.id);
    const unknown = drill_ids.filter(id => !config_ids.includes(id));
    if (unknown.length > 0) {
        throw new Error(`The clock enables drills ${drill_ids.join(", ")} and the config has drills ${config_ids.join(", ") || "none"}`);
    }
}

/** Config drill ids the window combinators of a clock blueprint enable */
export function scheduledDrillIds(blueprint: string): number[] {
    const entities: { player_description?: string; tags?: { clock_generator?: ClockGeneratorTags } }[] = decodeBlueprintString(blueprint).blueprint?.entities ?? [];
    return Array.from(new Set(entities.flatMap(scheduledDrillIdsOf))).sort((a, b) => a - b);
}

/** A part copy of the config: the entities it holds (as `EntityId` names them) and the share of a whole copy's output it is held to */
export interface PartCopy {
    ids: ReadonlySet<string>;
    share: number;
}

/**
 * The part copies of the config, as the generator lays them out on the lanes its copies share (`sharedLaneRunsOf`, one for
 * each way it lays them out that gives another part): where `copies` has a fraction, the upstream share of the takers of
 * each shared lane, rounded up for each taker, with the machines they feed, the inserters that feed those and the
 * inserters that take their results. None for a whole number of copies or a config whose copies share no lane.
 *
 * Its share is the generator's rule for a part copy's machine (shared-lane-verdict.ts, `machineShareOf`): a machine is held to
 * its whole target times the share of its takers (the inserters that take from it) that the part copy holds; the part copy's
 * output is that of its final machines (those making the target item), against all the final machines of a whole copy. Here a
 * taker counts as one, where the generator weighs each by what it moves in the output cycle: the same where a final machine's
 * takers move alike (one output inserter a machine, as in every build of copies recorded so far).
 */
export function partCopiesOf(config: Config): PartCopy[] {
    const fraction = config.setpoint.copies - Math.floor(config.setpoint.copies);
    if (fraction < FRACTION_EPSILON) return [];
    const parts = new Map<string, ReadonlySet<string>>();
    for (const reading of sharedLaneRunsOf(config).readings) {
        for (const layout of reading.layouts) {
            const part = layout.copies.later.find((later): later is ReadonlySet<string> => later !== "whole");
            if (part) parts.set(JSON.stringify([...part].sort()), part);
        }
    }
    const finals = config.machines.filter(machine => recipesMaking(config, config.setpoint.recipe).has(machine.recipe));
    const inserter_ids = config.inserters.map((inserter, index) => ({ inserter, id: EntityId.forInserter(inserter.id ?? index + 1).id }));
    return Array.from(parts.values()).map(ids => {
        const held = finals.filter(machine => ids.has(EntityId.forMachine(machine.id).id)).map(machine => {
            const takers = inserter_ids.filter(({ inserter }) => inserter.source.type === "machine" && inserter.source.id === machine.id);
            return takers.length === 0 ? 1 : takers.filter(({ id }) => ids.has(id)).length / takers.length;
        });
        return { ids, share: held.reduce((sum, share) => sum + share, 0) / finals.length };
    });
}

/** A fraction of copies smaller than this is none: `copies` is read as a float */
const FRACTION_EPSILON = 1e-9;

/**
 * The build as a recording without samples, matched to the config by structure, as a recording is: as one copy of the
 * config, whatever else the build holds, unless the test names the copies the build holds (see HarnessOptions.copies),
 * which are then found and counted. A count with a fraction is that many whole copies and one part copy of the config
 * (`partCopiesOf`), which comes last in `copies`.
 */
function matchBuild(described: any, config: Config, named_copies?: number) {
    const as_recording = parseRecording({
        format: "clock-generator-recording",
        version: 1,
        start_game_tick: 0,
        sample_count: 0,
        config: described.config,
        inserters: Object.values<any>(described.inserters).map(inserter => ({
            ...inserter,
            samples: { held_count: [], held_item: [], status: [] },
        })),
        machines: Object.values<any>(described.machines).map(machine => ({
            ...machine,
            samples: { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} },
        })),
    });
    if (named_copies === undefined) {
        const match = matchRecordingToConfig(as_recording, config);
        return { as_recording, match, copies: [match], part: null };
    }
    const whole = Math.floor(named_copies + FRACTION_EPSILON);
    if (named_copies - whole < FRACTION_EPSILON) {
        const { copies, merged } = matchCopies(as_recording, config);
        if (copies.length !== named_copies) {
            throw new Error(`The test says the build holds the config ${named_copies} time${named_copies === 1 ? "" : "s"}, and the build holds it ${copies.length}: `
                + "a copy is a group of machines that inserters move items between, with a machine for every machine of the config");
        }
        return { as_recording, match: merged, copies, part: null };
    }
    const configured = config.setpoint.copies;
    if (Math.abs((named_copies - whole) - (configured - Math.floor(configured))) > FRACTION_EPSILON) {
        throw new Error(`The test says the build holds the config ${named_copies} times, and the config's copies are ${configured}: `
            + "a part copy is the fraction of a copy the config's copies have");
    }
    const parts = partCopiesOf(config);
    if (parts.length === 0) {
        throw new Error(`The test says the build holds the config ${named_copies} times, and the config has no part copy: its copies share no lane`);
    }
    const found = matchCopies(as_recording, config, parts.map(part => part.ids));
    const recipes = new Set(config.machines.map(machine => machine.recipe));
    const others = (found.others ?? []).filter(group => group.machines.some(machine => recipes.has(machine.recipe)));
    const part_count = found.parts!.length;
    if (found.copies.length !== whole || part_count !== 1) {
        const numbers = (ids: ReadonlySet<string>, of: (id: number) => EntityId, count: number) =>
            Array.from({ length: count }, (_, index) => index + 1).filter(id => ids.has(of(id).id)).join(", ");
        const of_part = (ids: ReadonlySet<string>) => `machines ${numbers(ids, id => EntityId.forMachine(id), Math.max(0, ...config.machines.map(machine => machine.id)))}; `
            + `inserters ${numbers(ids, id => EntityId.forInserter(id), config.inserters.length)}`;
        throw new Error(`The test says the build holds the config ${named_copies} times: ${whole} whole copies and one part copy (${parts.map(part => of_part(part.ids)).join(" or ")}). `
            + `It found ${found.copies.length} whole copies and ${part_count === 0 ? "no part copy" : `${part_count} part copies`}`
            + (others.length > 0 ? `, and ${others.length} group${others.length === 1 ? "" : "s"} of the config's recipes that ${others.length === 1 ? "is" : "are"} neither: `
                + others.map(group => `${group.machines.length} machines: ${group.machines.map(machine => machine.recipe).sort().join(", ")}`).join("; ") : ""));
    }
    const part = parts.find(it => it.ids === found.parts![0].ids)!;
    return { as_recording, match: found.merged, copies: [...found.copies, found.parts![0].match], part: { index: whole, ...part } };
}

/**
 * Ticks the clock of a blueprint counts before it starts over (its window cycle), which is what the recorder cuts a recording into; null
 * when the blueprint has no clock the generator made or its counter is not one this reads. The clock is the decider
 * described as "Clock for ...", which counts while its signal is under a constant: from 1 when something adds the 1
 * for it (a constant combinator next to it, or an else output), from 0 as clocks made before 0.6.0 did.
 */
export function clockWindowCycleTicks(blueprint: string): number | null {
    let entities: any[];
    try {
        entities = decodeBlueprintString(blueprint).blueprint?.entities ?? [];
    } catch {
        return null;
    }
    const clock = entities.find(entity => entity.name === "decider-combinator" && /^Clock for/.test(entity.player_description ?? ""));
    const conditions = clock?.control_behavior?.decider_conditions;
    const counted = conditions?.conditions?.[0];
    if (!counted || (counted.comparator ?? "<") !== "<" || typeof counted.constant !== "number") {
        return null;
    }
    // the game keeps whole numbers: a constant of 90.947 is read as 90
    const limit = Math.trunc(counted.constant);
    const counts_from_one = entities.some(entity => entity.name === "constant-combinator") || (conditions.else_outputs ?? []).length > 0;
    const window_cycle_ticks = counts_from_one ? limit : limit + 1;
    return window_cycle_ticks > 0 ? window_cycle_ticks : null;
}

/**
 * Unit number of the built inserter behind each config inserter id. The recorder numbers the build its own way,
 * so the build is matched to the config by structure, as a recording is.
 */
export function matchBuiltInserters(described: any, config: Config): Map<number, number> {
    return matchBuiltCopies(described, config)[0];
}

/**
 * The same for a build the test says holds the config more than once (see matchCopies; refused when the count differs):
 * per copy, the unit number of the built inserter behind each config inserter id, the copies in the order of their lowest
 * machine ids. Without the count the build is one copy and anything beyond the config is left for buildPartsMissingFromConfig.
 */
export function matchBuiltCopies(described: any, config: Config, named_copies?: number): Map<number, number>[] {
    return builtCopies(described, config, named_copies).inserters;
}

/**
 * The copies of the build as matchBuiltCopies finds them, and the part copy among them where the count has a fraction: its
 * place (the last), the config entities it holds and the share of a whole copy's output it is held to (`partCopiesOf`)
 */
export function builtCopies(described: any, config: Config, named_copies?: number): { inserters: Map<number, number>[]; part: (PartCopy & { index: number }) | null } {
    const { as_recording, copies, part } = matchBuild(described, config, named_copies);
    return { part, inserters: copies.map(match => {
        const unit_numbers = new Map<number, number>();
        for (const inserter of as_recording.inserters) {
            const config_id = match.inserters.get(inserter.id);
            if (config_id !== undefined && inserter.unit_number !== undefined) {
                unit_numbers.set(config_id, inserter.unit_number);
            }
        }
        return unit_numbers;
    }) };
}

/**
 * Per copy, the unit number of the built drill behind each config drill id: a config drill is the one whose target is
 * what the built drill drops into, a machine matched to the config's or a chest (a car, a cargo wagon, a rocket silo)
 * that a matched inserter of the copy moves items of.
 */
export function matchBuiltDrills(described: any, config: Config, named_copies?: number): Map<number, number>[] {
    const { as_recording, copies } = matchBuild(described, config, named_copies);
    return copies.map(match => {
        const chests = matchedChests(as_recording, config, match);
        const unit_numbers = new Map<number, number>();
        for (const drill of Object.values<any>(described.drills ?? {})) {
            const target = drill.target as { type: string; id: number } | undefined;
            const target_id = target?.type === "machine" ? match.machines.get(target.id)
                : target?.type === "chest" ? chests.get(target.id) : undefined;
            const configured = (config.drills?.configs ?? []).find(it => it.target.type === target?.type && it.target.id === target_id);
            if (configured !== undefined && drill.unit_number !== undefined) {
                unit_numbers.set(configured.id, drill.unit_number);
            }
        }
        return unit_numbers;
    });
}

/**
 * The config chest behind each chest of the build that a matched inserter of the copy takes from or drops into, where
 * the config has one chest of its type. The inserters' match keys a chest end by "chest" and does not tell chests apart,
 * so two chests of one type in the config cannot be told apart and are left out (a drill into either is then refused).
 */
function matchedChests(recording: Recording, config: Config, match: { inserters: Map<number, number> }): Map<number, number> {
    const recorded_types = new Map(((recording.config.chests ?? []) as { id: number; type: string }[]).map(chest => [chest.id, chest.type]));
    const chests = new Map<number, number>();
    for (const inserter of recording.inserters) {
        if (!match.inserters.has(inserter.id)) continue;
        for (const end of [inserter.source, inserter.sink]) {
            const of_type = (config.chests ?? []).filter(chest => end.type === "chest" && chest.type === recorded_types.get(end.id));
            if (of_type.length === 1) {
                chests.set(end.id, of_type[0].id);
            }
        }
    }
    return chests;
}

/**
 * What the mod is told of the inserters a clock enables: per config id the unit number of its inserter, a list of them where
 * the build has copies; an inserter that a part copy does not hold is in the lists of the whole copies only
 */
export function clockInserters(copies: Map<number, number>[]): Record<string, number | number[]> {
    if (copies.length === 1) {
        return Object.fromEntries(copies[0]);
    }
    const ids = new Set(copies.flatMap(copy => Array.from(copy.keys())));
    return Object.fromEntries(Array.from(ids).map(id => [id, copies.flatMap(copy => copy.has(id) ? [copy.get(id)!] : [])]));
}

/** Something of the build that moves items of a machine of the config and that the config does not have */
interface BuildPartMissingFromConfig {
    kind: "inserter" | "machine" | "loader";
    /** For an error message */
    description: string;
    /** An inserter that takes from a belt: it is matched by what lay on its belt, so it may be an inserter of the config after all */
    takes_from_belt: boolean;
}

const BELT_ENTITY_TYPES = new Set(["transport-belt", "underground-belt", "splitter", "loader", "loader-1x1", "lane-splitter", "linked-belt"]);

/**
 * What the build has on the machines of the config that the config does not have. A clock made from the config knows
 * nothing of these, so the recording would not be of the clock:
 * - an inserter that takes from or drops into a machine of the config and is no inserter of the config, whatever is at
 *   its other end (a chest, a machine outside the config, a heating tower, the ground): wired to no clock it runs
 *   free, and a third output inserter that does empties the machine the clock means to hold back;
 * - a machine with a recipe of the config beyond the machines the config has of it;
 * - a loader on a machine of the config, which moves items like an inserter that is always enabled.
 * Inserters between belts and chests only, such as the ones that feed a scaffold's belt, and machines with other
 * recipes are the scaffold's own and not the config's business.
 * So is a group of machines outside the config that inserters join to each other, when it holds a machine with a recipe
 * the config does not have and no inserter joins it to a machine of the config: it makes something else beside the copies
 * (furnaces and a gear assembler that feed a foundry, say), and nothing of it moves items of the config's machines. A group
 * of the config's recipes alone, a whole copy more than the config has among them, cannot be told from a copy that no clock
 * holds, and is refused.
 */
export function buildPartsMissingFromConfig(described: any, config: Config, named_copies?: number): BuildPartMissingFromConfig[] {
    if (described.movers === undefined) {
        throw new Error("The recorder mod did not list the build's inserters and loaders (movers): it is older than this harness");
    }
    const { as_recording, match, copies } = matchBuild(described, config, named_copies);
    const recipeOf = (config_id: number | undefined) => config.machines.find(machine => machine.id === config_id)?.recipe;
    /** unit number of a built machine -> the config machine it is */
    const config_machines = new Map<number, number>();
    /** unit number of a built machine that is no machine of the config -> its recipe */
    const other_machines = new Map<number, string>();
    for (const machine of as_recording.machines) {
        if (machine.unit_number === undefined) {
            continue;
        }
        const config_id = match.machines.get(machine.id);
        if (config_id !== undefined) {
            config_machines.set(machine.unit_number, config_id);
        } else {
            other_machines.set(machine.unit_number, machine.recipe);
        }
    }
    const unit = (unit_number: number | undefined) => unit_number !== undefined ? ` (unit ${unit_number})` : "";
    type End = { unit_number?: number; type?: string; name?: string } | undefined;
    const onConfigMachine = (end: End) => end?.unit_number !== undefined && config_machines.has(end.unit_number);
    const endText = (end: End): string => {
        if (!end) {
            return "nothing (the ground)";
        }
        if (onConfigMachine(end)) {
            const config_id = config_machines.get(end.unit_number!);
            return `machine ${config_id} (${recipeOf(config_id)})`;
        }
        const recipe = end.unit_number !== undefined ? other_machines.get(end.unit_number) : undefined;
        return recipe !== undefined ? `${end.name} making ${recipe}, which is no machine of the config` : `${end.name ?? end.type ?? "an entity"}`;
    };

    const missing: BuildPartMissingFromConfig[] = [];
    const config_recipes = new Set(config.machines.map(machine => machine.recipe));
    const builds_own = machinesOfBuildOwnGroups(Object.values<any>(described.movers.inserters ?? {}), config_machines, other_machines, config_recipes);
    for (const machine of as_recording.machines) {
        if (!match.machines.has(machine.id) && config_recipes.has(machine.recipe) && !(machine.unit_number !== undefined && builds_own.has(machine.unit_number))) {
            const configured = config.machines.filter(it => it.recipe === machine.recipe).length;
            missing.push({
                kind: "machine",
                description: `${machine.name} making ${machine.recipe}${unit(machine.unit_number)}, beyond the ${configured}${copies.length > 1 ? ` in each of its ${copies.length} copies` : ""} the config has of that recipe`,
                takes_from_belt: false,
            });
        }
    }

    const matched_inserters = new Set(as_recording.inserters
        .filter(inserter => match.inserters.has(inserter.id) && inserter.unit_number !== undefined)
        .map(inserter => inserter.unit_number));
    for (const inserter of Object.values<any>(described.movers.inserters ?? {})) {
        if ((onConfigMachine(inserter.pickup) || onConfigMachine(inserter.drop)) && !matched_inserters.has(inserter.unit_number)) {
            missing.push({
                kind: "inserter",
                description: `${inserter.name} ${endText(inserter.pickup)} -> ${endText(inserter.drop)}${unit(inserter.unit_number)}`,
                takes_from_belt: BELT_ENTITY_TYPES.has(inserter.pickup?.type),
            });
        }
    }
    for (const loader of Object.values<any>(described.movers.loaders ?? {})) {
        if (onConfigMachine(loader.container)) {
            missing.push({
                kind: "loader",
                description: `${loader.name} ${loader.loader_type === "output" ? "emptying" : "filling"} ${endText(loader.container)}${unit(loader.unit_number)}`,
                takes_from_belt: false,
            });
        }
    }
    return missing;
}

/**
 * Unit numbers of the machines outside the config that are the build's own (see buildPartsMissingFromConfig): the groups of
 * them that inserters join machine to machine, where a group holds a recipe the config does not have and no inserter joins
 * one of its machines to a machine of the config
 */
function machinesOfBuildOwnGroups(
    inserters: { pickup?: { unit_number?: number }; drop?: { unit_number?: number } }[],
    config_machines: Map<number, number>,
    other_machines: Map<number, string>,
    config_recipes: Set<string>,
): Set<number> {
    const group_of = new Map<number, number>(Array.from(other_machines.keys()).map(unit_number => [unit_number, unit_number]));
    const root = (unit_number: number): number => {
        let at = unit_number;
        while (group_of.get(at) !== at) at = group_of.get(at)!;
        return at;
    };
    const joined_to_config = new Set<number>();
    for (const { pickup, drop } of inserters) {
        const ends = [pickup?.unit_number, drop?.unit_number];
        const [a, b] = ends.map(unit_number => unit_number !== undefined && other_machines.has(unit_number) ? unit_number : undefined);
        if (a !== undefined && b !== undefined) {
            group_of.set(root(a), root(b));
        }
        const to_config = ends.some(unit_number => unit_number !== undefined && config_machines.has(unit_number));
        for (const end of [a, b]) {
            if (end !== undefined && to_config) joined_to_config.add(end);
        }
    }
    const groups = new Map<number, { machines: number[]; own_recipe: boolean; joined: boolean }>();
    for (const [unit_number, recipe] of other_machines) {
        const group = groups.get(root(unit_number)) ?? { machines: [], own_recipe: false, joined: false };
        group.machines.push(unit_number);
        group.own_recipe ||= recipe !== undefined && recipe !== "" && !config_recipes.has(recipe);
        group.joined ||= joined_to_config.has(unit_number);
        groups.set(root(unit_number), group);
    }
    return new Set(Array.from(groups.values()).filter(group => group.own_recipe && !group.joined).flatMap(group => group.machines));
}

/** The error for a build with parts the config does not have */
export function missingFromConfigMessage(missing: BuildPartMissingFromConfig[]): string {
    return `The build has ${missing.length} part(s) on machines of the config that the config does not have: `
        + `${missing.map(it => it.description).join("; ")}. No clock made from the config holds them, so the recording would not be of the clock. `
        + "Add them to the config or take them out of the build."
        + (missing.some(it => it.takes_from_belt)
            ? " An inserter that takes from a belt is matched by what lies on its belt when the build is matched: if it is an inserter of the "
            + "config, a lane was empty or held something else then, and a longer warm-up may help."
            : "");
}

class FactorioServer {
    private output = "";
    private exited: { code: number | null; signal: string | null } | null = null;

    private constructor(private readonly child: ChildProcess, readonly rcon_port: number, readonly rcon_password: string, readonly game_port: number) {
        const collect = (chunk: Buffer) => { this.output += chunk.toString("utf-8"); };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        child.on("exit", (code, signal) => { this.exited = { code, signal }; });
    }

    static async start(executable: string, files: { config: string; save: string; settings: string }, mods_dir: string): Promise<FactorioServer> {
        const rcon_port = await freeTcpPort();
        const rcon_password = Math.random().toString(36).slice(2);
        const game_port = await freeUdpPort();
        const child = spawn(executable, [
            "--config", files.config,
            "--mod-directory", mods_dir,
            "--start-server", files.save,
            "--server-settings", files.settings,
            "--port", String(game_port),
            "--bind", "127.0.0.1",
            "--rcon-bind", `127.0.0.1:${rcon_port}`,
            "--rcon-password", rcon_password,
        ], { stdio: ["ignore", "pipe", "pipe"] });
        return new FactorioServer(child, rcon_port, rcon_password, game_port);
    }

    /** Throws with the end of the game's log once the game is gone */
    assertRunning(): void {
        if (this.exited) {
            throw new Error(`Factorio exited (code ${this.exited.code}, signal ${this.exited.signal}). End of its log:\n${this.logTail()}`);
        }
    }

    logTail(lines = 30): string {
        return this.output.trimEnd().split("\n").slice(-lines).join("\n");
    }

    async waitForRcon(deadline: number): Promise<RconClient> {
        while (!this.output.includes(RCON_READY)) {
            this.assertRunning();
            if (Date.now() > deadline) {
                throw new Error(`Factorio did not open its RCON port in time. End of its log:\n${this.logTail()}`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
        return RconClient.connect(this.rcon_port, this.rcon_password);
    }

    async stop(): Promise<void> {
        if (this.exited) {
            return;
        }
        // nothing of the scratch save is worth keeping, so the game is not given the time to save it
        this.child.kill("SIGKILL");
        await new Promise<void>(resolve => this.child.once("exit", () => resolve()));
    }
}

/**
 * The game with graphics, joined to the server as a player so the run can be watched. It has a write-data folder and
 * a copy of the mods of its own, next to the server's.
 */
async function startWatcher(executable: string, work_dir: string, game_port: number, debug: boolean): Promise<ChildProcess> {
    const data_dir = factorioDataDir(executable);
    const client_dir = path.join(work_dir, "watcher");
    await fs.rm(client_dir, { recursive: true, force: true });
    await fs.mkdir(client_dir, { recursive: true });
    await fs.cp(path.join(work_dir, "mods"), path.join(client_dir, "mods"), { recursive: true });
    const config = path.join(client_dir, "config.ini");
    // What a run is watched for: how fast the game runs, and which inserters and machines it wakes. The first line
    // looks like a comment and is the version of the config: the game resets a config without it, options and all.
    await fs.writeFile(config, `; version=13\n[path]\nread-data=${data_dir}\nwrite-data=${client_dir}\n`
        + (debug ? "[debug]\nshow-fps=always\nshow-wakeup-lists=always\n" : ""));
    await fs.writeFile(path.join(client_dir, "player-data.json"), JSON.stringify({ "service-username": "watcher" }));
    return spawn(executable, [
        "--config", config,
        "--mod-directory", path.join(client_dir, "mods"),
        "--mp-connect", `127.0.0.1:${game_port}`,
    ], { stdio: "ignore" });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
}

/** What a session starts its game with */
type SessionOptions = Pick<HarnessOptions, "factorio" | "save" | "work_dir" | "watch" | "watch_debug" | "timeout_seconds" | "log">;
/** One build to record in the game of a session */
type BuildOptions = Omit<HarnessOptions, "factorio" | "save" | "work_dir" | "watch" | "watch_debug">;

/** Throws when the build cannot be recorded as asked. Nothing of the game is needed to tell */
/** The resource to put under the blueprint's drills: as asked, else the one the config's drills mine */
export function drillResourceOf(options: Pick<BuildOptions, "drill_resource" | "config">): string | undefined {
    if (options.drill_resource !== undefined) {
        return options.drill_resource;
    }
    const mined = new Set((options.config?.drills?.configs ?? []).map(drill => drill.mined_item_name));
    if (mined.size > 1) {
        throw new Error(`The config's drills mine ${Array.from(mined).sort().join(", ")}: the harness puts one resource under its drills, so pass drill_resource`);
    }
    return mined.size === 1 ? Array.from(mined)[0] : undefined;
}

function assertBuildOptions(options: BuildOptions): void {
    if (options.clock && !options.config) {
        throw new Error("A clock needs the config it was generated from, to find the inserters its combinators name");
    }
    if (options.copies !== undefined && (!(options.copies >= 1) || !options.clock)) {
        throw new Error("`copies` is how many copies of the config a generated clock is wired to, at least one copy: a whole number, or whole "
            + "copies and one part copy with the fraction of the config's copies: it needs a clock");
    }
    if (options.built_clock && (options.unclocked || options.staged_start)) {
        throw new Error("A named clock of the build is kept or replaced: it cannot be asked for with an unclocked run or a staged start");
    }
    if (options.built_clock) {
        // the blueprint is checked against the clock named before anything is built
        blueprintWithNamedClock(options.blueprint, options.built_clock);
    }
    if (options.staged_start) {
        const order = options.staged_start.build_order;
        if (options.settle_ticks) {
            throw new Error("A staged start records from the tick its inserters are placed in: settle_ticks has to be absent or 0");
        }
        if (!options.config && (options.clock || !Array.isArray(order))) {
            throw new Error("A staged start needs the config, to tell which built inserter is which config id (unless the build order is a list and there is no clock)");
        }
        const phase = options.staged_start.clock_phase;
        if (phase !== undefined) {
            if (!options.clock || options.unclocked) {
                throw new Error("A staged start places its clock first only with a generated clock to place");
            }
            const window_cycle_ticks = clockWindowCycleOf(options.clock.schedule);
            if (!Number.isInteger(phase) || phase < 0 || phase > window_cycle_ticks) {
                throw new Error(`The phase the clock is placed first to is a value its main counter reads, a whole number from 0 to its window cycle of ${window_cycle_ticks} ticks, not ${phase}`);
            }
        }
        // the recording runs for exactly the ticks asked for, from the placement tick
        assertRecordableTicks(options.ticks, null);
        return;
    }
    // the clock the recording is cut by: the one swapped in, or the one the build came with when it is kept
    const window_cycle_ticks = options.unclocked || options.record_at_once ? null
        : options.clock ? clockWindowCycleOf(options.clock.schedule) : options.built_clock?.window_cycle_ticks ?? clockWindowCycleTicks(options.blueprint);
    assertRecordableTicks(options.ticks, window_cycle_ticks);
}

/**
 * A headless Factorio on a copy of the save that records builds one after another, each built in the place of the one
 * before it. The game runs on between them, so only the first build starts from the save as it is: a later one starts
 * at another tick, and with whatever the builds before it changed around them.
 */
export class HarnessSession {
    private rcon: RconClient | null = null;
    private watcher: ChildProcess | null = null;
    private has_build = false;

    private constructor(
        private readonly work_dir: string,
        /** The folder was given, not made for this session: it is left as it is */
        private readonly keeps_work_dir: boolean,
        private readonly server: FactorioServer,
        private readonly log: (message: string) => void,
    ) { }

    /** Starts the game and, to watch, opens it with graphics and waits for that to join */
    static async start(options: SessionOptions): Promise<HarnessSession> {
        const executable = await resolveFactorioExecutable(options.factorio);
        const work_dir = path.resolve(options.work_dir ?? await fs.mkdtemp(path.join(os.tmpdir(), "clock-generator-harness-")));
        await fs.mkdir(work_dir, { recursive: true });
        const files = await prepareWorkDir(work_dir, executable, options.save);
        const deadline = Date.now() + options.timeout_seconds * 1000;

        options.log(`Starting ${executable} with write data in ${work_dir}`);
        const server = await FactorioServer.start(executable, files, path.join(work_dir, "mods"));
        const session = new HarnessSession(work_dir, options.work_dir !== undefined, server, options.log);
        try {
            await session.connect(executable, deadline, options.watch ?? false, options.watch_debug ?? true);
        } catch (error) {
            await session.close(true);
            throw error;
        }
        return session;
    }

    private async connect(executable: string, deadline: number, watch: boolean, debug: boolean): Promise<void> {
        this.rcon = await this.server.waitForRcon(deadline);
        if (!watch) {
            return;
        }
        this.log("Opening the game to watch the run; waiting for it to join");
        const opened = this.watcher = await startWatcher(executable, this.work_dir, this.server.game_port, debug);
        for (;;) {
            this.server.assertRunning();
            if (!isRunning(opened)) {
                throw new Error(`The game opened to watch the run closed before it joined (code ${opened.exitCode}); its log is ${path.join(this.work_dir, "watcher", "factorio-current.log")}`);
            }
            if (Number(await this.command("/sc rcon.print(#game.connected_players)")) > 0) {
                break;
            }
            if (Date.now() > deadline) {
                throw new Error("Timed out waiting for the game opened to watch the run to join");
            }
            await sleep(POLL_INTERVAL_MS);
        }
        // Nobody is an admin on a server of its own. As one, whoever watches can set the game's speed, pause it and
        // open the editor. Alt mode is on for the recipes, and stays as they leave it after.
        await this.command("/sc for _, player in pairs(game.connected_players) do "
            + "player.admin = true player.game_view_settings.show_entity_info = true end");
    }

    private command(command: string): Promise<string> {
        return this.rcon!.command(command);
    }

    private async call(name: string, job?: unknown): Promise<any> {
        const argument = job === undefined ? "" : `, ${luaLongString(JSON.stringify(job))}`;
        const answer = await this.command(`/sc rcon.print(remote.call("${RECORDER_MOD}", "${name}"${argument}))`);
        try {
            return JSON.parse(answer);
        } catch {
            throw new Error(`${name} failed in game: ${answer.trim() || "no answer"}`);
        }
    }

    private async waitFor(what: string, deadline: number, done: (status: any) => boolean): Promise<any> {
        for (;;) {
            this.server.assertRunning();
            const status = await this.call("harness_status");
            if (done(status)) {
                return status;
            }
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${what}; last status ${JSON.stringify(status)}`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
    }

    /** Whether the game opened to watch is still open */
    get watched(): boolean {
        return this.watcher !== null && isRunning(this.watcher);
    }

    /** Native PNG captured by this session's graphical client, with no GUI. Headless Factorio cannot render it. */
    async takeScreenshot(options: {
        path: string; surface: string; position: { x: number; y: number };
        resolution: { x: number; y: number }; zoom: number; timeout_seconds?: number;
    }): Promise<string> {
        if (!this.watched) throw new Error("Screenshots need a graphical client: start the session with watch: true");
        if (path.basename(options.path) !== options.path || !options.path.endsWith(".png")) {
            throw new Error("Screenshot path must be a PNG filename without directories");
        }
        const file = path.join(this.work_dir, "watcher", "script-output", options.path);
        await fs.rm(file, { force: true });
        const { timeout_seconds = 60, ...request } = options;
        const params = { ...request, show_gui: false, show_entity_info: true, anti_alias: true,
            hide_clouds: true, hide_fog: true, daytime: 0, force_render: true };
        await this.command(`/sc game.take_screenshot(helpers.json_to_table(${luaLongString(JSON.stringify(params))}))`);
        const deadline = Date.now() + timeout_seconds * 1000;
        for (;;) {
            this.server.assertRunning();
            if (!this.watched) throw new Error("Graphical client closed before writing the screenshot");
            const png = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
                return null;
            });
            // Factorio writes asynchronously. Wait for PNG's terminal chunk, not just a newly created file.
            if (png && png.length >= 12 && png.subarray(-8, -4).toString("ascii") === "IEND") return file;
            if (Date.now() > deadline) throw new Error(`Timed out waiting for native screenshot ${file}`);
            await sleep(POLL_INTERVAL_MS);
        }
    }

    /** What the game is asked to build for a run that is not staged */
    private buildJob(options: BuildOptions) {
        const replaces_clock = options.clock !== undefined || options.unclocked;
        return {
            blueprint: options.built_clock ? blueprintWithNamedClock(options.blueprint, options.built_clock) : options.blueprint,
            surface: options.surface,
            position: options.position,
            clock: replaces_clock ? "remove" : "keep",
            // a clock built by hand gates its inserters with a condition that holds only while its signal is on the wire
            free_warmup: options.built_clock !== undefined && options.clock !== undefined,
            warmup_ticks: options.warmup_ticks,
            speed: options.game_speed,
            drill_resource: drillResourceOf(options),
        };
    }

    /** What the game is asked to build for the trial build of a staged start, which tells which built inserter is which */
    private trialJob(options: BuildOptions) {
        return {
            blueprint: options.blueprint,
            surface: options.surface,
            position: options.position,
            clock: "remove",
            warmup_ticks: options.staged_start?.trial_build_ticks ?? 900,
            speed: options.game_speed,
            drill_resource: drillResourceOf(options),
        };
    }

    /**
     * Builds what a run builds before it describes the build to match the config to it (the trial build of a staged start, else
     * the build after its warm-up) and returns that description, with nothing seeded, wired or recorded. The recording cache keys
     * a recording on it (see describedRecordingKey).
     */
    async describeBuild(options: BuildOptions): Promise<Record<string, unknown>> {
        assertBuildOptions(options);
        const deadline = Date.now() + options.timeout_seconds * 1000;
        if (this.has_build) {
            await this.call("harness_clear");
        }
        this.has_build = true;
        const build = await this.call("harness_build", options.staged_start ? this.trialJob(options) : this.buildJob(options));
        const not_built = Object.values<string>(build.failed);
        if (not_built.length > 0) {
            throw new Error(`Could not build ${not_built.length} of the blueprint's entities: ${Array.from(new Set(not_built)).join(", ")}`);
        }
        await this.waitFor("the warm-up", deadline, status => status.ready);
        return await this.call("harness_describe");
    }

    /**
     * Builds the blueprint, in the place of the build this session recorded before, optionally swaps its clock, seeds
     * it, records it with the recorder mod and writes the recording to options.out.
     */
    async record(options: BuildOptions): Promise<HarnessResult> {
        assertBuildOptions(options);
        const deadline = Date.now() + options.timeout_seconds * 1000;
        if (options.staged_start) {
            return this.recordStaged(options, deadline);
        }
        if (this.has_build) {
            const cleared = await this.call("harness_clear");
            options.log(`Removed the ${cleared.removed} entities of the build before`);
        }
        this.has_build = true;

        const replaces_clock = options.clock !== undefined || options.unclocked;
        const build = await this.call("harness_build", this.buildJob(options));
        const not_built = Object.values<string>(build.failed);
        if (not_built.length > 0) {
            throw new Error(`Could not build ${not_built.length} of the blueprint's entities: ${Array.from(new Set(not_built)).join(", ")}`);
        }
        options.log(`Built ${build.built} entities on ${build.surface}`
            + (replaces_clock ? `, removed ${build.removed_clock_combinators} clock combinators that held ${build.clocked_inserters} inserters` : ""));
        if (this.watched) {
            // A spectator has no character to walk into the build, and looks at its middle. Whoever has opened the
            // editor since keeps it, and whoever was made a spectator before keeps their zoom.
            const x = (build.area.left_top.x + build.area.right_bottom.x) / 2;
            const y = (build.area.left_top.y + build.area.right_bottom.y) / 2;
            await this.command(`/sc for _, player in pairs(game.connected_players) do `
                + `if player.controller_type ~= defines.controllers.spectator and player.controller_type ~= defines.controllers.editor then `
                + `player.set_controller{type = defines.controllers.spectator} player.zoom = 0.75 end `
                + `player.teleport({${x}, ${y}}, "${build.surface}") end`);
        }
        await this.waitFor("the warm-up", deadline, status => status.ready);

        let clock: { blueprint: string; inserters: Record<string, number | number[]>; drills?: Record<string, number | number[]> } | undefined;
        if (options.clock && options.config) {
            const described = await this.call("harness_describe");
            const { inserters: copies, part } = builtCopies(described, options.config, options.copies);
            const scheduled = scheduledInserterIds(options.clock.schedule);
            // a part copy holds some of the config's inserters: the clock is wired to those of them it names
            const of_copy = (copy: number) => part !== null && copy === part.index ? scheduled.filter(id => part.ids.has(EntityId.forInserter(id).id)) : scheduled;
            const missing = copies.flatMap((unit_numbers, copy) => of_copy(copy).filter(id => !unit_numbers.has(id)).map(id => ({ id, copy })));
            if (missing.length > 0) {
                throw new Error(`The clock names inserters ${Array.from(new Set(missing.map(it => it.id))).join(", ")} of the config, which match no inserter of the build`
                    + `${copies.length > 1 ? ` in copy ${Array.from(new Set(missing.map(it => it.copy + 1))).join(", ")} of ${copies.length}` : ""}. `
                    + "Belt inserters are matched by what lies on their belt, so a longer warm-up may help.");
            }
            if (copies.length > 1) {
                options.log(`The build holds the config ${options.copies} times: the clock is wired to each copy${part !== null ? ", and to the part copy's inserters" : ""}`);
            }
            const not_in_config = buildPartsMissingFromConfig(described, options.config, options.copies);
            if (not_in_config.length > 0) {
                throw new Error(missingFromConfigMessage(not_in_config));
            }
            assertDrillsWireable(options.clock, options.config);
            const scheduled_drills = scheduledDrillIds(options.clock.blueprint);
            const drill_copies = matchBuiltDrills(described, options.config, options.copies);
            const missing_drills = drill_copies.flatMap(unit_numbers => scheduled_drills.filter(id => !unit_numbers.has(id)));
            if (missing_drills.length > 0) {
                throw new Error(`The clock names drills ${Array.from(new Set(missing_drills)).join(", ")} of the config, which match no drill of the build`);
            }
            clock = { blueprint: withInserterTags(options.clock), inserters: clockInserters(copies), drills: clockInserters(drill_copies) };
        }

        const start = await this.call("harness_start", {
            clock,
            unclocked: options.unclocked,
            seed: options.seed,
            lua: options.lua,
            settle_ticks: options.settle_ticks,
            record: { ticks: options.ticks, at_once: options.record_at_once },
        });
        if (start.clock) {
            options.log(`Wired the clock to ${Object.values(start.clock.wired).length} inserters`
                + (Object.values(start.clock.wired_drills ?? {}).length > 0 ? ` and ${Object.values(start.clock.wired_drills).length} drill` : ""));
        }
        for (const seeded of Object.values<any>(start.seeds)) {
            options.log(`Seeded ${seeded.inserted} ${seeded.item} into ${seeded.entities} entities`);
        }
        options.log(`Recording from tick ${start.tick}`);

        const finished = await this.waitFor("the recording", deadline, status => !status.settling && !status.active);
        if (!finished.last_recording) {
            throw new Error(`The recorder stopped without writing a recording. End of the game's log:\n${this.server.logTail()}`);
        }
        const written = path.join(this.work_dir, "script-output", finished.last_recording.filename);
        const text = JSON.parse(await fs.readFile(written, "utf-8"));
        // the clock the build came with is kept: the recording says what it is, as it is read and kept with it
        const kept_clock = options.built_clock !== undefined && !replaces_clock && !options.record_at_once;
        const file = kept_clock ? recordingOfBuiltClock(text, options.built_clock!) : text;
        const recording = parseRecording(file);
        const recording_path = path.resolve(options.out);
        await fs.mkdir(path.dirname(recording_path), { recursive: true });
        if (kept_clock) {
            await fs.writeFile(recording_path, JSON.stringify(file));
        } else {
            await fs.copyFile(written, recording_path);
        }
        options.log(`Recorded ${recording.sample_count} ticks (${recording.stop_reason})`);
        return { recording_path, recording, build, start };
    }

    /**
     * The staged start (StagedStartOptions). A trial build of the whole blueprint tells which built inserter is which config
     * inserter (by structure, as the clock is wired) and where it stands; it is removed, and the build is made again without the
     * inserters of the cell and run until its belts are saturated; then the inserters are built in the order asked for, the clock
     * is wired and the recording starts, all in the tick the game is paused in.
     */
    private async recordStaged(options: BuildOptions, deadline: number): Promise<HarnessResult> {
        const staged = options.staged_start!;
        if (this.has_build) {
            const cleared = await this.call("harness_clear");
            options.log(`Removed the ${cleared.removed} entities of the build before`);
        }
        this.has_build = true;
        const replaces_clock = options.clock !== undefined || options.unclocked;

        // trial build: which inserter is which
        let order: { x: number; y: number; config_id: number; copy?: number }[] = [];
        let position = options.position;
        if (options.config) {
            const trial = await this.call("harness_build", this.trialJob(options));
            await this.waitFor("the trial build", deadline, status => status.ready);
            const described = await this.call("harness_describe");
            // one copy unless the test names the copies, which are then matched as a clock of copies is wired (see matchCopies)
            const copies = matchBuiltCopies(described, options.config, options.copies);
            const stands_at = new Map<number, { x: number; y: number }>(described.movers.inserters.map((it: any) => [it.unit_number, it.position]));
            const known = copies.map(unit_numbers => new Map(Array.from(unit_numbers).flatMap(([config_id, unit_number]) => {
                const at = stands_at.get(unit_number);
                return at === undefined ? [] : [[config_id, { x: at.x - trial.origin.x, y: at.y - trial.origin.y }] as const];
            })));
            order = stagedBuildOrder(known, staged.build_order);
            if (options.clock) {
                const missing = copies.flatMap((unit_numbers, copy) => scheduledInserterIds(options.clock!.schedule).filter(id => !unit_numbers.has(id)).map(id => ({ id, copy })));
                if (missing.length > 0) {
                    throw new Error(`The clock names inserters ${Array.from(new Set(missing.map(it => it.id))).join(", ")} of the config, which match no inserter of the build`
                        + `${copies.length > 1 ? ` in copy ${Array.from(new Set(missing.map(it => it.copy + 1))).join(", ")} of ${copies.length}` : ""}`);
                }
                const not_in_config = buildPartsMissingFromConfig(described, options.config, options.copies);
                if (not_in_config.length > 0) {
                    throw new Error(missingFromConfigMessage(not_in_config));
                }
                assertDrillsWireable(options.clock, options.config);
            }
            position = trial.origin;
            const cleared = await this.call("harness_clear");
            options.log(`Trial build matched ${copies.map(it => it.size).join(" + ")} config inserters`
                + `${copies.length > 1 ? ` in ${copies.length} copies` : ""} and was removed again (${cleared.removed} entities)`);
        }

        // first stage: everything but the inserters of the cell, until the belts are saturated
        const build = await this.call("harness_build", {
            blueprint: options.blueprint,
            surface: options.surface,
            position,
            clock: replaces_clock ? "remove" : "keep",
            speed: options.game_speed,
            drill_resource: drillResourceOf(options),
            staged: { saturation_ticks: staged.saturation_ticks, cap_ticks: staged.saturation_cap_ticks },
        });
        const not_built = Object.values<string>(build.failed);
        if (not_built.length > 0) {
            throw new Error(`Could not build ${not_built.length} of the blueprint's entities: ${Array.from(new Set(not_built)).join(", ")}`);
        }
        options.log(`Built ${build.built} entities on ${build.surface} and left ${build.staged.cell_inserters} inserters of the cell for later; ${build.staged.lanes} belt lanes under their pickups to saturate`);
        const saturated = await this.waitFor("the belts to saturate", deadline, status => {
            if (status.staged?.failed) {
                throw new Error(`The belts did not saturate: ${status.staged.failed}. Lanes: ${JSON.stringify(status.staged.lanes)}`);
            }
            return status.ready;
        });
        for (const lane of Object.values<any>(saturated.staged.lanes ?? {})) {
            options.log(`Lane ${lane.lane} of the belt at (${lane.x}, ${lane.y}) (unit ${lane.belt}): ${lane.in_use ? `full from tick ${lane.full_since}` : "carries nothing"}`);
        }
        options.log(`The belts are saturated at tick ${saturated.staged.saturated_tick} (${saturated.staged.saturated_tick - saturated.staged.started_tick} ticks after the build)`);

        // with the clock placed first: the clock alone, read after every tick until its counter reads the phase asked for
        let priming: { target: number; placed: any; trace: ClockReading[] } | undefined;
        if (staged.clock_phase !== undefined) {
            const window_cycle_ticks = clockWindowCycleOf(options.clock!.schedule);
            const placed = await this.call("harness_place_clock", { clock: { blueprint: withInserterTags(options.clock!) } });
            options.log(`Placed the clock at tick ${placed.tick} with the ${placed.cell_ghosts} inserters of the cell not built; its counter reads ${placed.counter}`);
            const trace: ClockReading[] = [{ tick: placed.tick, counter: placed.counter }];
            while (trace[trace.length - 1].counter !== staged.clock_phase && trace.length <= 2 * window_cycle_ticks + 3) {
                await this.call("harness_advance", { ticks: 1 });
                const status = await this.waitFor("one tick of the clock placed first", deadline, it => it.ready);
                trace.push({ tick: status.tick, counter: status.clock.counter });
            }
            assertClockPriming(trace, staged.clock_phase, window_cycle_ticks);
            options.log(`The counter reads ${staged.clock_phase} at tick ${trace[trace.length - 1].tick}, ${trace.length - 1} ticks after the clock was placed`);
            priming = { target: staged.clock_phase, placed, trace };
        }

        // second stage: the inserters of the cell and the clock, in one tick
        let clock: { blueprint: string; inserters: Record<string, number> } | { primed: true } | undefined;
        if (priming) {
            clock = { primed: true };
        } else if (options.clock) {
            clock = { blueprint: withInserterTags(options.clock), inserters: {} };
        }
        const start = await this.call("harness_start", {
            clock,
            unclocked: options.unclocked,
            seed: options.seed,
            lua: options.lua,
            staged: { order, loop_seed: staged.loop_seed, copies: options.copies },
            record: { ticks: options.ticks },
        });
        if (priming) {
            assertClockAttached(priming, start.staged.clock_attach);
            start.staged.clock_priming = { target: priming.target, placed: priming.placed, trace: priming.trace };
        }
        if (options.copies !== undefined && options.clock) {
            const wired: { inserter: number }[] = Object.values(start.clock?.wired ?? {});
            const short = scheduledInserterIds(options.clock.schedule).filter(id => wired.filter(it => it.inserter === id).length !== options.copies);
            if (short.length > 0) {
                throw new Error(`The clock is wired to inserters ${short.join(", ")} of the config not once in each of the ${options.copies} copies`);
            }
        }
        for (const placed of Object.values<{ unit_number: number; config_id?: number; x: number; y: number; tick: number }>(start.staged.placed ?? {})) {
            options.log(`Built inserter ${placed.config_id !== undefined ? `of config id ${placed.config_id}` : "not in the config"} at (${placed.x}, ${placed.y}) of the blueprint: unit_number ${placed.unit_number}, tick ${placed.tick}`);
        }
        if (start.clock) {
            options.log(`Wired the clock to ${Object.values(start.clock.wired).length} inserters`
                + (Object.values(start.clock.wired_drills ?? {}).length > 0 ? ` and ${Object.values(start.clock.wired_drills).length} drill` : "")
                + ` in tick ${start.staged.tick}`);
        }
        for (const seeded of Object.values<{ unit_number: number; item: string; inserted: number }>(start.loop_seeds ?? {})) {
            options.log(`Seeded ${seeded.inserted} ${seeded.item} into the machine with unit number ${seeded.unit_number} (a loop)`);
        }
        options.log(`Recording from tick ${start.tick}`);

        const finished = await this.waitFor("the recording", deadline, status => !status.settling && !status.active);
        if (!finished.last_recording) {
            throw new Error(`The recorder stopped without writing a recording. End of the game's log:\n${this.server.logTail()}`);
        }
        const written = path.join(this.work_dir, "script-output", finished.last_recording.filename);
        const recording = parseRecording(JSON.parse(await fs.readFile(written, "utf-8")));
        const recording_path = path.resolve(options.out);
        await fs.mkdir(path.dirname(recording_path), { recursive: true });
        await fs.copyFile(written, recording_path);
        options.log(`Recorded ${recording.sample_count} ticks (${recording.stop_reason})`);
        return { recording_path, recording, build: { ...build, saturation: saturated.staged }, start };
    }

    /** Lets the build run on, at this speed when one is given, until the window of the game opened to watch is closed; returns at once when none is open */
    async runUntilWatcherCloses(game_speed?: number): Promise<void> {
        const opened = this.watcher;
        if (!opened || !isRunning(opened)) {
            return;
        }
        const closed = new Promise<void>(resolve => opened.once("exit", () => resolve()));
        this.log("The build keeps running: close the game's window to finish");
        await this.command(`/sc ${game_speed === undefined ? "" : `game.speed = ${game_speed} `}game.tick_paused = false`);
        await closed;
    }

    /** Ends the game, and the one opened to watch it. The write data of a failed session is kept, for the game's log */
    async close(failed = false): Promise<void> {
        this.rcon?.close();
        const opened = this.watcher;
        // it writes to its folder on its way out, which would bring a folder removed under it back
        const closed = opened && isRunning(opened) ? new Promise<void>(resolve => opened.once("exit", () => resolve())) : null;
        opened?.kill();
        await this.server.stop();
        await closed;
        if (this.keeps_work_dir) {
            return;
        }
        if (failed) {
            this.log(`Kept ${this.work_dir} (factorio-current.log is in it)`);
        } else {
            await fs.rm(this.work_dir, { recursive: true, force: true });
        }
    }
}

/** The source files of the harness that decide what the game is given and what is kept of its answers (src, or dist once built) */
const HOST_SOURCES = [
    "harness/factorio-harness", "harness/rcon", "harness/built-clock", "harness/recording-cache",
    "blueprints/serde", "verification/entity-copies", "verification/entity-matching",
];

async function hostSources(): Promise<string[]> {
    return Promise.all(HOST_SOURCES.map(async name => {
        for (const extension of [".ts", ".js"]) {
            const file = path.resolve(__dirname, "..", name + extension);
            if (await exists(file)) {
                return file;
            }
        }
        throw new Error(`The source of ${name} was not found`);
    }));
}

/** What the game and the harness are made of, for the key of a recording */
export async function cacheEnvironmentOf(factorio: string, save: string): Promise<CacheEnvironment> {
    const executable = await resolveFactorioExecutable(factorio);
    return {
        protocol: RECORDING_CACHE_PROTOCOL,
        executable,
        data_dir: factorioDataDir(executable),
        save: path.resolve(save),
        mods: { [RECORDER_MOD]: path.join(REPOSITORY_ROOT, RECORDER_MOD) },
        // the Sidecar turns what the game holds into the description of a build: a recording is keyed on what it made of the
        // build, not on its files (see describedRecordingKey)
        transforms: { [SIDECAR_MOD]: path.join(REPOSITORY_ROOT, SIDECAR_MOD) },
        host_sources: await hostSources(),
    };
}

/** Appends one line about what the store did to the file named by CLOCK_RECORDING_CACHE_LOG, when it is set */
async function noteCache(event: string, detail: Record<string, unknown>): Promise<void> {
    const file = process.env.CLOCK_RECORDING_CACHE_LOG;
    if (file) {
        await fs.appendFile(file, JSON.stringify({ time: new Date().toISOString(), event, ...detail }) + "\n").catch(() => { });
    }
}

/** A recording through the store: read back when the game already made it, else made by `run` and kept */
interface CachedRecording {
    result: HarnessResult;
    /** The key the recording is stored under; null when the run was not through the store, and no key could be made */
    key: string | null;
    /** Whether the game was left alone */
    hit: boolean;
}

/**
 * Looks the recording up under the key of everything the game is given. A hit returns what the game made, with its recording
 * written to `out` and the files it left in script-output restored, and the game is not started. A miss, or a run that is
 * not through the store (cache: false, a watched run, CLOCK_RECORDING_CACHE=off, or anything that cannot be told for a key)
 * calls `run`, which starts the game; its result is kept unless the store is off. Errors of `run` are never kept.
 * `history` is the keys of the recordings made before this one in the same game; null when it cannot be told.
 * `describe` builds the build in a game of its own and describes it: the key holds what the Sidecar made of the build, asked
 * of the game only when the Sidecar's files, the game, the save or the options are not those a description was kept for.
 */
async function recordThroughCache(
    options: HarnessOptions, history: string[] | null, run: (log: (message: string) => void) => Promise<HarnessResult>,
    describe: () => Promise<Record<string, unknown>>,
): Promise<CachedRecording> {
    const mode = recordingCacheMode();
    const out = path.basename(options.out);
    if (options.cache === false || options.watch || mode === "off") {
        await noteCache("uncached", { out, why: options.cache === false ? "cache: false" : options.watch ? "watched" : "CLOCK_RECORDING_CACHE=off" });
        return { result: await run(options.log), key: null, hit: false };
    }
    let key: RecordingCacheKey | null = null;
    if (history !== null) {
        try {
            key = await describedRecordingKey(options, await cacheEnvironmentOf(options.factorio, options.save), history, recordingCacheDir(), mode === "refresh", describe);
        } catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            options.log(`Recording cache: not used, ${why}`);
            await noteCache("uncached", { out, why });
        }
    }
    if (key === null) {
        return { result: await run(options.log), key: null, hit: false };
    }
    const store = recordingCacheDir();
    if (mode === "on") {
        const stored = await restoreRecording(store, key.key, options);
        if (stored) {
            await noteCache("hit", { out, key: key.key });
            return { result: stored, key: key.key, hit: true };
        }
    }
    await noteCache("miss", { out, key: key.key, mode });
    const logs: string[] = [];
    const result = await run(message => { logs.push(message); options.log(message); });
    try {
        await storeRecording(store, key, options, result, logs);
        await noteCache("stored", { out, key: key.key });
    } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        options.log(`Recording cache: not stored, ${why}`);
        await noteCache("not stored", { out, key: key.key, why });
    }
    return { result, key: key.key, hit: false };
}

/**
 * Runs Factorio headless on a copy of the save, builds the blueprint, optionally swaps its clock, seeds it,
 * records it with the recorder mod and writes the recording to options.out: a session of one build. Through the store of
 * recordings (see recordThroughCache): a recording the game already made for the same inputs is read back without a game.
 */
export async function recordInFactorio(options: HarnessOptions): Promise<HarnessResult> {
    assertBuildOptions(options);
    return (await recordThroughCache(options, [], async log => {
        const logged = { ...options, log };
        const session = await HarnessSession.start(logged);
        let failed = true;
        try {
            const result = await session.record(logged);
            if (options.watch) {
                await session.runUntilWatcherCloses(options.game_speed);
            }
            failed = false;
            return result;
        } finally {
            await session.close(failed);
        }
    }, async () => {
        const quiet = { ...options, work_dir: undefined, watch: false, log: () => { } };
        const session = await HarnessSession.start(quiet);
        try {
            return await session.describeBuild(quiet);
        } finally {
            await session.close(false);
        }
    })).result;
}

/**
 * A game for a run of builds, one after the other in the same game, started when one of them has to be made and not before:
 * a build whose recording the store holds is answered from it. What a build leaves behind is what the next is built on, so a
 * recording is stored under the keys of the builds before it too; when one has to be made after others were read back, the
 * game is started and those are made again first (their results thrown away), so it is made in the game its key says.
 */
export class CachedHarnessSession {
    private session: HarnessSession | null = null;
    private answered: { options: BuildOptions; key: string | null }[] = [];
    /** How many of `answered` the game has made */
    private played = 0;
    private replay_dir: string | null = null;

    constructor(private readonly started_with: SessionOptions) { }

    async record(options: BuildOptions): Promise<HarnessResult> {
        assertBuildOptions(options);
        const history = this.answered.every(it => it.key !== null) ? this.answered.map(it => it.key!) : null;
        const full: HarnessOptions = { ...options, ...this.started_with, timeout_seconds: options.timeout_seconds, log: options.log };
        const { result, key, hit } = await recordThroughCache(full, history, async log => {
            const session = await this.started();
            await this.replayAnswered(session);
            return session.record({ ...options, log });
        }, async () => {
            // a game of its own, where the builds before this one were made, so the description is of the build the run makes
            const quiet = { ...this.started_with, work_dir: undefined, watch: false, log: () => { } };
            const session = await HarnessSession.start(quiet);
            try {
                for (const [index, before] of this.answered.entries()) {
                    this.replay_dir ??= await fs.mkdtemp(path.join(os.tmpdir(), "clock-generator-replay-"));
                    await session.record({ ...before.options, out: path.join(this.replay_dir, `described-${index}.json`), log: () => { } });
                }
                return await session.describeBuild({ ...options, log: () => { } });
            } finally {
                await session.close(false);
            }
        });
        this.answered.push({ options, key });
        if (!hit) {
            this.played = this.answered.length;
        }
        return result;
    }

    private async started(): Promise<HarnessSession> {
        this.session ??= await HarnessSession.start(this.started_with);
        return this.session;
    }

    private async replayAnswered(session: HarnessSession): Promise<void> {
        for (; this.played < this.answered.length; this.played++) {
            this.replay_dir ??= await fs.mkdtemp(path.join(os.tmpdir(), "clock-generator-replay-"));
            await session.record({ ...this.answered[this.played].options, out: path.join(this.replay_dir, `${this.played}.json`), log: () => { } });
        }
    }

    async close(failed = false): Promise<void> {
        await this.session?.close(failed);
        this.session = null;
        if (this.replay_dir) {
            await fs.rm(this.replay_dir, { recursive: true, force: true });
        }
    }
}
