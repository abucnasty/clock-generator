import { ChildProcess, spawn } from "child_process";
import dgram from "dgram";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import zlib from "zlib";
import { Config } from "../config";
import { matchRecordingToConfig } from "../verification/entity-matching";
import { parseRecording, Recording } from "../verification/recording";
import { RconClient } from "./rcon";

const RECORDER_MOD = "clock-generator-recorder";
const SIDECAR_MOD = "clock-generator-sidecar";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");
const RCON_READY = "Starting RCON interface";
const POLL_INTERVAL_MS = 100;

/**
 * The most ticks one run in Factorio may record: 20 minutes of game time. It keeps the game-backed tests and
 * recordings from running excessively long; a longer recording is refused up front, not shortened. The ticks a build
 * warms up and settles for before it is recorded are not counted: a build takes what it takes to fill its belts and
 * settle.
 */
export const MAX_RECORDED_TICKS = 72_000;

/**
 * Ticks a recording of the requested length will hold. Without a clock, the ticks asked for. With one, the recorder
 * records whole periods of the clock until it has at least the ticks asked for, so the next multiple of the period.
 */
export function recordedTicks(requested_ticks: number, clock_period_ticks: number | null): number {
    return clock_period_ticks === null ? requested_ticks : Math.ceil(requested_ticks / clock_period_ticks) * clock_period_ticks;
}

/**
 * Throws when the request is no whole positive number of ticks, or when what it would record is over
 * MAX_RECORDED_TICKS. `clock_period_ticks` is the period the clock of the build counts, null when it has none or
 * the period is not known before the run; the request alone is limited then.
 */
export function assertRecordableTicks(requested_ticks: number, clock_period_ticks: number | null = null): void {
    if (!Number.isInteger(requested_ticks) || requested_ticks <= 0) {
        throw new Error(`Ticks to record must be a whole number above 0, not ${requested_ticks}`);
    }
    const limit = `the limit of ${MAX_RECORDED_TICKS} ticks (${MAX_RECORDED_TICKS / 3600} minutes of game time) for one run in Factorio`;
    if (clock_period_ticks === null) {
        if (requested_ticks > MAX_RECORDED_TICKS) {
            throw new Error(`A recording of ${requested_ticks} ticks is over ${limit}. Record fewer ticks; warm-up and settle ticks do not count.`);
        }
        return;
    }
    const recorded = recordedTicks(requested_ticks, clock_period_ticks);
    if (recorded > MAX_RECORDED_TICKS) {
        const fits = Math.floor(MAX_RECORDED_TICKS / clock_period_ticks) * clock_period_ticks;
        throw new Error(`A request for ${requested_ticks} ticks records ${recorded}: whole periods of the clock, which counts ${clock_period_ticks} ticks. `
            + `That is over ${limit}. `
            + (fits > 0 ? `The most that fits is ${fits} ticks (${fits / clock_period_ticks} periods).` : "Not one period of this clock fits.")
            + " Warm-up and settle ticks do not count.");
    }
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
    /** Ticks to record. With a clock, whole clock periods until at least this many ticks */
    ticks: number;
    /** Ticks the build runs before seeding and recording, so belts are full */
    warmup_ticks: number;
    /** Ticks the build runs on its new clock and seeds before it is recorded, so its start-up is not in the recording */
    settle_ticks?: number;
    seed: Seed[];
    /** Blueprint string of a generated clock that replaces the clock of the build; needs config */
    clock?: string;
    /** The config the clock was generated from: its inserter ids are the ones the clock's combinators name */
    config?: Config;
    /** Remove the clock of the build and let its inserters run freely */
    unclocked: boolean;
    surface?: string;
    position?: { x: number; y: number };
    /** Lua run right before the recording starts, as a chunk called with (entities, surface, area) */
    lua?: string;
    /** Scratch folder for Factorio's write data; a temporary folder that is removed afterwards when absent */
    work_dir?: string;
    game_speed: number;
    /**
     * Also open the game with graphics, joined to the run as a spectator looking at the build, so it can be watched.
     * The run waits for it to join and, once recorded, for its window to be closed.
     */
    watch?: boolean;
    timeout_seconds: number;
    log: (message: string) => void;
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
export async function resolveFactorioExecutable(factorio: string): Promise<string> {
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
    const data_dir = path.resolve(path.dirname(executable), "..", "..", "data");
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

/** Config inserter ids named by the schedule combinators of a generated clock ("Inserters 1, 2 for ...") */
export function clockInserterIds(clock_blueprint: string): number[] {
    const entities: { player_description?: string }[] = decodeBlueprintString(clock_blueprint).blueprint?.entities ?? [];
    const ids = entities.flatMap(entity => {
        const named = /^Inserters? ([\d, ]+) for/.exec(entity.player_description ?? "");
        return named ? named[1].split(",").map(id => Number(id.trim())) : [];
    });
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

/** The build as a recording without samples, matched to the config by structure, as a recording is */
function matchBuild(described: any, config: Config) {
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
    return { as_recording, match: matchRecordingToConfig(as_recording, config) };
}

/**
 * Ticks the clock of a blueprint counts before it starts over, which is what the recorder cuts a recording into; null
 * when the blueprint has no clock the generator made or its counter is not one this reads. The clock is the decider
 * described as "Clock for ...", which counts while its signal is under a constant: from 1 when something adds the 1
 * for it (a constant combinator next to it, or an else output), from 0 as clocks made before 0.6.0 did.
 */
export function clockPeriodTicks(blueprint: string): number | null {
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
    const period = counts_from_one ? limit : limit + 1;
    return period > 0 ? period : null;
}

/**
 * Unit number of the built inserter behind each config inserter id. The recorder numbers the build its own way,
 * so the build is matched to the config by structure, as a recording is.
 */
export function matchBuiltInserters(described: any, config: Config): Map<number, number> {
    const { as_recording, match } = matchBuild(described, config);
    const unit_numbers = new Map<number, number>();
    for (const inserter of as_recording.inserters) {
        const config_id = match.inserters.get(inserter.id);
        if (config_id !== undefined && inserter.unit_number !== undefined) {
            unit_numbers.set(config_id, inserter.unit_number);
        }
    }
    return unit_numbers;
}

/** Something of the build that moves items of a machine of the config and that the config does not have */
export interface BuildPartMissingFromConfig {
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
 */
export function buildPartsMissingFromConfig(described: any, config: Config): BuildPartMissingFromConfig[] {
    if (described.movers === undefined) {
        throw new Error("The recorder mod did not list the build's inserters and loaders (movers): it is older than this harness");
    }
    const { as_recording, match } = matchBuild(described, config);
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
    for (const machine of as_recording.machines) {
        if (!match.machines.has(machine.id) && config_recipes.has(machine.recipe)) {
            const configured = config.machines.filter(it => it.recipe === machine.recipe).length;
            missing.push({
                kind: "machine",
                description: `${machine.name} making ${machine.recipe}${unit(machine.unit_number)}, beyond the ${configured} the config has of that recipe`,
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
async function startWatcher(executable: string, work_dir: string, game_port: number): Promise<ChildProcess> {
    const data_dir = path.resolve(path.dirname(executable), "..", "..", "data");
    const client_dir = path.join(work_dir, "watcher");
    await fs.rm(client_dir, { recursive: true, force: true });
    await fs.mkdir(client_dir, { recursive: true });
    await fs.cp(path.join(work_dir, "mods"), path.join(client_dir, "mods"), { recursive: true });
    const config = path.join(client_dir, "config.ini");
    await fs.writeFile(config, `[path]\nread-data=${data_dir}\nwrite-data=${client_dir}\n`);
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

/**
 * Runs Factorio headless on a copy of the save, builds the blueprint, optionally swaps its clock, seeds it,
 * records it with the recorder mod and writes the recording to options.out.
 */
export async function recordInFactorio(options: HarnessOptions): Promise<HarnessResult> {
    if (options.clock && !options.config) {
        throw new Error("A clock needs the config it was generated from, to find the inserters its combinators name");
    }
    // the clock the recording is cut by: the one swapped in, or the one the build came with when it is kept
    assertRecordableTicks(options.ticks, options.unclocked ? null : clockPeriodTicks(options.clock ?? options.blueprint));
    const executable = await resolveFactorioExecutable(options.factorio);
    const work_dir = path.resolve(options.work_dir ?? await fs.mkdtemp(path.join(os.tmpdir(), "clock-generator-harness-")));
    await fs.mkdir(work_dir, { recursive: true });
    const files = await prepareWorkDir(work_dir, executable, options.save);
    const deadline = Date.now() + options.timeout_seconds * 1000;

    options.log(`Starting ${executable} with write data in ${work_dir}`);
    const server = await FactorioServer.start(executable, files, path.join(work_dir, "mods"));
    let rcon: RconClient | null = null;
    let watcher: ChildProcess | null = null;
    let failed = true;
    try {
        rcon = await server.waitForRcon(deadline);
        const connected = rcon;

        if (options.watch) {
            options.log("Opening the game to watch the run; waiting for it to join");
            watcher = await startWatcher(executable, work_dir, server.game_port);
            const opened = watcher;
            for (;;) {
                server.assertRunning();
                if (opened.exitCode !== null) {
                    throw new Error(`The game opened to watch the run closed before it joined (code ${opened.exitCode}); its log is ${path.join(work_dir, "watcher", "factorio-current.log")}`);
                }
                if (Number(await connected.command("/sc rcon.print(#game.connected_players)")) > 0) {
                    break;
                }
                if (Date.now() > deadline) {
                    throw new Error("Timed out waiting for the game opened to watch the run to join");
                }
                await sleep(POLL_INTERVAL_MS);
            }
        }

        const call = async (name: string, job?: unknown): Promise<any> => {
            const argument = job === undefined ? "" : `, ${luaLongString(JSON.stringify(job))}`;
            const answer = await connected.command(`/sc rcon.print(remote.call("${RECORDER_MOD}", "${name}"${argument}))`);
            try {
                return JSON.parse(answer);
            } catch {
                throw new Error(`${name} failed in game: ${answer.trim() || "no answer"}`);
            }
        };
        const waitFor = async (what: string, done: (status: any) => boolean): Promise<any> => {
            for (;;) {
                server.assertRunning();
                const status = await call("harness_status");
                if (done(status)) {
                    return status;
                }
                if (Date.now() > deadline) {
                    throw new Error(`Timed out waiting for ${what}; last status ${JSON.stringify(status)}`);
                }
                await sleep(POLL_INTERVAL_MS);
            }
        };

        const replaces_clock = options.clock !== undefined || options.unclocked;
        const build = await call("harness_build", {
            blueprint: options.blueprint,
            surface: options.surface,
            position: options.position,
            clock: replaces_clock ? "remove" : "keep",
            warmup_ticks: options.warmup_ticks,
            speed: options.game_speed,
        });
        const not_built = Object.values<string>(build.failed);
        if (not_built.length > 0) {
            throw new Error(`Could not build ${not_built.length} of the blueprint's entities: ${Array.from(new Set(not_built)).join(", ")}`);
        }
        options.log(`Built ${build.built} entities on ${build.surface}`
            + (replaces_clock ? `, removed ${build.removed_clock_combinators} clock combinators that held ${build.clocked_inserters} inserters` : ""));
        if (options.watch) {
            // a spectator has no character to walk into the build, and looks at its middle
            const x = (build.area.left_top.x + build.area.right_bottom.x) / 2;
            const y = (build.area.left_top.y + build.area.right_bottom.y) / 2;
            await connected.command(`/sc for _, player in pairs(game.connected_players) do `
                + `player.set_controller{type = defines.controllers.spectator} `
                + `player.teleport({${x}, ${y}}, "${build.surface}") player.zoom = 0.75 end`);
        }
        await waitFor("the warm-up", status => status.ready);

        let clock: { blueprint: string; inserters: Record<string, number> } | undefined;
        if (options.clock && options.config) {
            const described = await call("harness_describe");
            const unit_numbers = matchBuiltInserters(described, options.config);
            const missing = clockInserterIds(options.clock).filter(id => !unit_numbers.has(id));
            if (missing.length > 0) {
                throw new Error(`The clock names inserters ${missing.join(", ")} of the config, which match no inserter of the build. `
                    + "Belt inserters are matched by what lies on their belt, so a longer warm-up may help.");
            }
            const not_in_config = buildPartsMissingFromConfig(described, options.config);
            if (not_in_config.length > 0) {
                throw new Error(missingFromConfigMessage(not_in_config));
            }
            clock = { blueprint: options.clock, inserters: Object.fromEntries(unit_numbers) };
        }

        const start = await call("harness_start", {
            clock,
            unclocked: options.unclocked,
            seed: options.seed,
            lua: options.lua,
            settle_ticks: options.settle_ticks,
            record: { ticks: options.ticks },
        });
        if (start.clock) {
            options.log(`Wired the clock to ${Object.values(start.clock.wired).length} inserters`);
        }
        for (const seeded of Object.values<any>(start.seeds)) {
            options.log(`Seeded ${seeded.inserted} ${seeded.item} into ${seeded.entities} entities`);
        }
        options.log(`Recording from tick ${start.tick}`);

        const finished = await waitFor("the recording", status => !status.settling && !status.active);
        if (!finished.last_recording) {
            throw new Error(`The recorder stopped without writing a recording. End of the game's log:\n${server.logTail()}`);
        }
        const written = path.join(work_dir, "script-output", finished.last_recording.filename);
        const recording = parseRecording(JSON.parse(await fs.readFile(written, "utf-8")));
        const recording_path = path.resolve(options.out);
        await fs.mkdir(path.dirname(recording_path), { recursive: true });
        await fs.copyFile(written, recording_path);
        options.log(`Recorded ${recording.sample_count} ticks (${recording.stop_reason})`);
        if (watcher && watcher.exitCode === null) {
            options.log("The build keeps running: close the game's window to finish");
            await connected.command(`/sc game.speed = ${options.game_speed} game.tick_paused = false`);
            const opened = watcher;
            await new Promise<void>(resolve => opened.once("exit", () => resolve()));
        }
        failed = false;
        return { recording_path, recording, build, start };
    } finally {
        rcon?.close();
        watcher?.kill();
        await server.stop();
        if (failed && options.work_dir === undefined) {
            options.log(`Kept ${work_dir} (factorio-current.log is in it)`);
        } else if (options.work_dir === undefined) {
            await fs.rm(work_dir, { recursive: true, force: true });
        }
    }
}
