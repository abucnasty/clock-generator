import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import type { HarnessOptions, HarnessResult } from "./factorio-harness";
import { parseRecording } from "../verification/recording";

/**
 * A store of the recordings the game made, so a test that asks for a recording the game already made once does not start the
 * game again. A recording is kept under a key of everything the game is given to make it (see recordingCacheKey); anything
 * that cannot be told is a reason not to use the store, never a guess.
 */

/** Bump when what is kept per recording, or how a key is made, changes: every key made before is then another key */
export const RECORDING_CACHE_PROTOCOL = 2;

/** The environment variable that sets how the store is used: unset or "on" (look up, store), "off" (neither), "refresh" (always run the game, store the result) */
export const RECORDING_CACHE_MODE_VARIABLE = "CLOCK_RECORDING_CACHE";
/** The environment variable that sets the folder of the store */
export const RECORDING_CACHE_DIR_VARIABLE = "CLOCK_RECORDING_CACHE_DIR";
/** Entries not used for this many days are removed when a new one is stored */
const KEEP_DAYS = 30;

export type RecordingCacheMode = "on" | "off" | "refresh";

/** How the store is used: anything but "on" and "refresh" is "off", so a misspelt value never reads a stored recording */
export function recordingCacheMode(env: NodeJS.ProcessEnv = process.env): RecordingCacheMode {
    const value = env[RECORDING_CACHE_MODE_VARIABLE]?.trim().toLowerCase();
    if (value === undefined || value === "" || value === "on") {
        return "on";
    }
    return value === "refresh" ? "refresh" : "off";
}

/** The folder of the store: outside the repository and the temporary folder, so it survives a reboot */
export function recordingCacheDir(env: NodeJS.ProcessEnv = process.env): string {
    const set = env[RECORDING_CACHE_DIR_VARIABLE];
    if (set) {
        return path.resolve(set);
    }
    const base = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(base, "clock-generator", "game-recordings");
}

/** What the game and the harness are made of, found by the harness for the key */
export interface CacheEnvironment {
    protocol: number;
    /** The game's executable */
    executable: string;
    /** The game's data folder: the mods that ship with it */
    data_dir: string;
    /** The save the game starts from */
    save: string;
    /** The folders of the mods the harness copies in, by the name they are installed under; `.zip` files in them are not copied */
    mods: Record<string, string>;
    /**
     * The folders of the mods that turn what the game holds into the description of a build (the Sidecar), by the name they are
     * installed under; copied in like `mods`. Their files are not part of the key of a recording, only what they produced for the
     * build is (see describedRecordingKey): a change to them that leaves the description as it was keeps every recording.
     */
    transforms?: Record<string, string>;
    /** The source files of the harness that decide what the game is given and what is kept of what it answers */
    host_sources: string[];
}

/** Options that name where or how a run goes and not what the game is given; every other option is part of the key */
const NOT_INPUTS = ["factorio", "save", "out", "work_dir", "log", "timeout_seconds", "cache"] as const;

/**
 * A text form of a value that is the same for the same data whatever order its keys were written in. Throws on what is not
 * data (a function, a symbol, an object of a class, a number that is not finite), as the key of what cannot be told is no key.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`A number that is not finite (${value}) cannot be part of a key`);
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
    }
    if (value instanceof Map) {
        return `{"map":${canonicalJson(Array.from(value.entries()).sort(([a], [b]) => String(a) < String(b) ? -1 : 1))}}`;
    }
    if (value instanceof Set) {
        return `{"set":${canonicalJson(Array.from(value.values()).map(canonicalJson).sort())}}`;
    }
    if (typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error(`An object of the class ${prototype.constructor?.name ?? "unknown"} cannot be part of a key`);
        }
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(",")}}`;
    }
    throw new Error(`A ${typeof value} cannot be part of a key`);
}

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

function sha256(...parts: (string | Buffer)[]): string {
    const hash = crypto.createHash("sha256");
    for (const part of parts) {
        hash.update(part);
    }
    return hash.digest("hex");
}

const file_hashes = new Map<string, Promise<string>>();

/** The SHA-256 of a file's bytes; remembered for the life of the process while the file's size and time stay the same */
async function fileSha256(file: string): Promise<string> {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
        throw new Error(`${file} is not a file`);
    }
    const id = `${path.resolve(file)}|${stat.size}|${stat.mtimeMs}|${stat.ino}`;
    let hash = file_hashes.get(id);
    if (!hash) {
        hash = fs.readFile(file).then(bytes => sha256(bytes));
        file_hashes.set(id, hash);
        hash.catch(() => file_hashes.delete(id));
    }
    return hash;
}

/** Every file below a folder, as paths relative to it, sorted. A link is followed no further than its own name: it is part of what is hashed */
async function filesBelow(folder: string): Promise<{ relative: string; full: string }[]> {
    const found: { relative: string; full: string }[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else {
                found.push({ relative: path.relative(folder, full).split(path.sep).join("/"), full });
            }
        }
    };
    await walk(folder);
    return found.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}

/** The names and sizes of every file of a folder: the game's own data, which is too large to read for every key */
async function dataFingerprint(folder: string): Promise<string> {
    const files = await filesBelow(folder);
    const sizes = await Promise.all(files.map(async file => (await fs.lstat(file.full)).size));
    return sha256(canonicalJson(files.map((file, index) => [file.relative, sizes[index]])));
}

/** The names and contents of every file of a folder that is copied into the game, but for `.zip` files, as the harness copies it */
async function modFingerprint(folder: string): Promise<string> {
    const files = (await filesBelow(folder)).filter(file => !file.full.endsWith(".zip"));
    return sha256(canonicalJson(await Promise.all(files.map(async file => [file.relative, await fileSha256(file.full)]))));
}

/** The options a key is made of: all of them but the ones that only say where or how the run goes */
function inputsOfOptions(options: Partial<HarnessOptions>): Record<string, unknown> {
    const inputs: Record<string, unknown> = { ...options };
    for (const name of NOT_INPUTS) {
        delete inputs[name];
    }
    return inputs;
}

/** A key: its parts, each a hash of one kind of input, and the key they make together */
export interface RecordingCacheKey {
    key: string;
    parts: Record<string, unknown>;
}

/** The parts of the key that do not depend on the mods that transform: all but `description` */
async function baseParts(options: Partial<HarnessOptions>, environment: CacheEnvironment, history: string[]): Promise<Record<string, unknown>> {
    const mods: Record<string, string> = {};
    for (const [name, folder] of Object.entries(environment.mods)) {
        mods[name] = await modFingerprint(folder);
    }
    const sources: Record<string, string> = {};
    for (const file of environment.host_sources) {
        sources[path.basename(file)] = await fileSha256(file);
    }
    return {
        protocol: environment.protocol,
        executable: await fileSha256(environment.executable),
        game_data: await dataFingerprint(environment.data_dir),
        save: await fileSha256(environment.save),
        mods,
        host_sources: sources,
        options: sha256(canonicalJson(inputsOfOptions(options))),
        history,
    };
}

/**
 * The key of a recording: a hash of the game's executable and data, the save, the mods the harness copies in, the sources of
 * the harness, the protocol, and every option of the run that is not a place to write to (scaffold, clock and its schedule,
 * config, probe script, seeds, ticks and the rest, so an option added later is part of the key without being named). `history`
 * is the keys of the recordings made before this one in the same game, when a game makes more than one: what a build leaves
 * behind is what the next is built on. `description` is the hash of what the transforming mods produced for the build (see
 * buildFacts), left out when the environment has none. Throws when any of it cannot be read or told.
 */
export async function recordingCacheKey(options: Partial<HarnessOptions>, environment: CacheEnvironment, history: string[] = [], description?: string): Promise<RecordingCacheKey> {
    const parts: Record<string, unknown> = await baseParts(options, environment, history);
    if (description !== undefined) {
        parts.description = description;
    }
    return { key: sha256(canonicalJson(parts)), parts };
}

/**
 * What the transforming mods (the Sidecar) made of a build, as far as it decides what a recording measures: which inserters the
 * config's are matched to and wired as, and which entities get tracks, with their ids, sources and sinks, belts and lanes. The
 * suggested target and the version of the mod (stamped on the config and on every pickup and drop capture) are what the Sidecar offers or says of itself and a person decides or reads: the
 * target a recording is judged against reaches the key through the config and the clock. `sidecar` is the same export as a
 * player gets it, `movers` is the game's own facts about the build: neither is left to this to hash.
 */
export function buildFacts(described: Record<string, unknown>): Record<string, unknown> {
    const { suggested_target: _target, ...config } = (described.config ?? {}) as Record<string, unknown>;
    return withoutVersions({
        config,
        inserters: described.inserters, machines: described.machines, drills: described.drills,
        left_out: described.left_out, left_out_drills: described.left_out_drills,
    }) as Record<string, unknown>;
}

/** The value without any `sidecar_version`: the Sidecar stamps its version on the config and on each pickup and drop capture */
function withoutVersions(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(withoutVersions);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "sidecar_version").map(([name, item]) => [name, withoutVersions(item)]));
    }
    return value;
}

/** The hash of what the transforming mods made of a build (see buildFacts) */
export function descriptionHash(described: Record<string, unknown>): string {
    return sha256(canonicalJson(buildFacts(described)));
}

function descriptionFile(store: string, id: string): string {
    return path.join(store, "descriptions", `${id}.json.gz`);
}

/**
 * The key of a recording when the mods that transform are keyed on what they make of the build and not on their files. The
 * description is asked of the game (`describe`, a run that builds and describes and records nothing) once for the same
 * game, save, options and files of the transforming mods; the answer is kept under the store, in `descriptions`, and read back
 * the next time. So a change to the transforming mods costs one such run per build, and a build whose description came out
 * the same keeps its key and its recording. "refresh" asks the game again.
 */
export async function describedRecordingKey(
    options: Partial<HarnessOptions>, environment: CacheEnvironment, history: string[], store: string, refresh: boolean,
    describe: () => Promise<Record<string, unknown>>,
): Promise<RecordingCacheKey> {
    const base = await baseParts(options, environment, history);
    const transforms: Record<string, string> = {};
    for (const [name, folder] of Object.entries(environment.transforms ?? {})) {
        transforms[name] = await modFingerprint(folder);
    }
    const file = descriptionFile(store, sha256(canonicalJson({ ...base, transforms })));
    let hash: string | undefined;
    if (!refresh) {
        hash = await fs.readFile(file).then(gunzip).then(bytes => JSON.parse(bytes.toString("utf-8")).hash as string, () => undefined);
        if (hash !== undefined) {
            await fs.utimes(file, new Date(), new Date()).catch(() => { });
        }
    }
    if (hash === undefined) {
        const described = await describe();
        hash = descriptionHash(described);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, await gzip(JSON.stringify({ hash, transforms, facts: buildFacts(described) }), { level: 1 }));
        await fs.rename(temporary, file);
    }
    const parts = { ...base, description: hash };
    return { key: sha256(canonicalJson(parts)), parts };
}

/** What is kept of one recording besides the files: the game's answers, and what the harness said while it ran */
interface EntryMeta {
    protocol: number;
    key: string;
    parts: Record<string, unknown>;
    stored: string;
    build: Record<string, unknown>;
    start: Record<string, unknown>;
    logs: string[];
    /** The files of the game's script-output folder kept, by path from it; the recording itself is kept once, as recording.json.gz */
    script_output: string[];
    /** The files of script-output that are the recording, which are restored from it */
    script_output_recording: string[];
}

function entryDir(store: string, key: string): string {
    return path.join(store, key);
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

/** The recording stored under the key, written to `options.out` along with the files the game left in script-output; null when there is none, or it cannot be read whole */
export async function restoreRecording(store: string, key: string, options: Pick<HarnessOptions, "out" | "work_dir" | "log">): Promise<HarnessResult | null> {
    const dir = entryDir(store, key);
    try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8")) as EntryMeta;
        if (meta.protocol !== RECORDING_CACHE_PROTOCOL || meta.key !== key) {
            return null;
        }
        const recording_bytes = await gunzip(await fs.readFile(path.join(dir, "recording.json.gz")));
        const recording = parseRecording(JSON.parse(recording_bytes.toString("utf-8")));
        const others = await Promise.all(meta.script_output.map(async name => [name, await gunzip(await fs.readFile(path.join(dir, "script-output", `${name}.gz`)))] as const));

        const recording_path = path.resolve(options.out);
        await fs.mkdir(path.dirname(recording_path), { recursive: true });
        await fs.writeFile(recording_path, recording_bytes);
        if (options.work_dir !== undefined) {
            const output = path.join(path.resolve(options.work_dir), "script-output");
            await fs.rm(output, { recursive: true, force: true });
            await fs.mkdir(output, { recursive: true });
            for (const [name, bytes] of others) {
                await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
                await fs.writeFile(path.join(output, name), bytes);
            }
            for (const name of meta.script_output_recording) {
                await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
                await fs.writeFile(path.join(output, name), recording_bytes);
            }
        }
        for (const message of meta.logs) {
            options.log(message);
        }
        const now = new Date();
        await fs.utimes(path.join(dir, "meta.json"), now, now).catch(() => { });
        return { recording_path, recording, build: meta.build, start: meta.start };
    } catch {
        return null;
    }
}

/**
 * Keeps the recording the game just made under the key: the file at `options.out`, the files in script-output of the write
 * folder when there is one, the game's answers and the harness's messages. Written to a folder of its own first and moved
 * into place, so a reader never meets half an entry and a second writer of the same key changes nothing.
 */
export async function storeRecording(store: string, key: RecordingCacheKey, options: Pick<HarnessOptions, "out" | "work_dir">, result: HarnessResult, logs: string[]): Promise<void> {
    await fs.mkdir(store, { recursive: true });
    const temporary = await fs.mkdtemp(path.join(store, `.${key.key.slice(0, 12)}-`));
    try {
        const recording_bytes = await fs.readFile(path.resolve(options.out));
        await fs.writeFile(path.join(temporary, "recording.json.gz"), await gzip(recording_bytes, { level: 1 }));
        const script_output: string[] = [];
        const script_output_recording: string[] = [];
        if (options.work_dir !== undefined) {
            const output = path.join(path.resolve(options.work_dir), "script-output");
            if (await exists(output)) {
                for (const file of await filesBelow(output)) {
                    const bytes = await fs.readFile(file.full);
                    if (bytes.equals(recording_bytes)) {
                        script_output_recording.push(file.relative);
                        continue;
                    }
                    const target = path.join(temporary, "script-output", `${file.relative}.gz`);
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.writeFile(target, await gzip(bytes, { level: 1 }));
                    script_output.push(file.relative);
                }
            }
        }
        const meta: EntryMeta = {
            protocol: RECORDING_CACHE_PROTOCOL, key: key.key, parts: key.parts, stored: new Date().toISOString(),
            build: JSON.parse(JSON.stringify(result.build)), start: JSON.parse(JSON.stringify(result.start)),
            logs, script_output, script_output_recording,
        };
        await fs.writeFile(path.join(temporary, "meta.json"), JSON.stringify(meta));
        const target = entryDir(store, key.key);
        // refresh replaces what is there; otherwise an entry another writer made first stays
        await fs.rm(target, { recursive: true, force: true });
        await fs.rename(temporary, target).catch(async error => {
            if (!(await exists(target))) {
                throw error;
            }
        });
    } finally {
        await fs.rm(temporary, { recursive: true, force: true });
    }
    await pruneStore(store);
}

/** Removes the entries (and leftovers of writes that did not finish) nobody has used for KEEP_DAYS days */
async function pruneStore(store: string): Promise<void> {
    const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    for (const entry of await fs.readdir(path.join(store, "descriptions"), { withFileTypes: true }).catch(() => [])) {
        const file = path.join(store, "descriptions", entry.name);
        const used = await fs.stat(file).catch(() => null);
        if (used && used.mtimeMs < limit) {
            await fs.rm(file, { force: true }).catch(() => { });
        }
    }
    for (const entry of await fs.readdir(store, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !/^\.?[0-9a-f]{12,64}/.test(entry.name)) {
            continue;
        }
        const used = await fs.stat(path.join(store, entry.name, entry.name.startsWith(".") ? "." : "meta.json")).catch(() => null);
        if (used && used.mtimeMs < limit) {
            await fs.rm(path.join(store, entry.name), { recursive: true, force: true }).catch(() => { });
        }
    }
}
