import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheEnvironmentOf, CachedHarnessSession, HarnessOptions, HarnessResult, recordInFactorio } from "./factorio-harness";
import {
    buildFacts, CacheEnvironment, canonicalJson, describedRecordingKey, RECORDING_CACHE_DIR_VARIABLE, RECORDING_CACHE_MODE_VARIABLE, RECORDING_CACHE_PROTOCOL,
    recordingCacheDir, recordingCacheKey, recordingCacheMode, restoreRecording, storeRecording,
} from "./recording-cache";
import { parseRecording } from "../verification/recording";

/** What the game that fails to start says: whatever is not answered from the store reaches it */
const STARTED = "Factorio exited (code 3";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "recording-cache-test-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function write(relative: string, text: string): string {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

/** A game that is a script which fails when started, with data, a save, a mod, a transforming mod and two source files */
function environment(): CacheEnvironment {
    const executable = write("game/bin/x64/factorio", "#!/bin/sh\nexit 3\n");
    fs.chmodSync(executable, 0o755);
    write("game/data/base/info.json", `{"version":"2.1.0"}`);
    write("game/data/base/prototypes/item.lua", "items");
    write("save.zip", "save bytes");
    write("mods/recorder/control.lua", "recorder");
    write("mods/recorder/scripts/events.lua", "events");
    write("mods/sidecar/control.lua", "sidecar");
    write("src/harness.ts", "harness");
    write("src/rcon.ts", "rcon");
    return {
        protocol: RECORDING_CACHE_PROTOCOL,
        executable,
        data_dir: path.join(root, "game/data"),
        save: path.join(root, "save.zip"),
        mods: { recorder: path.join(root, "mods/recorder") },
        transforms: { sidecar: path.join(root, "mods/sidecar") },
        host_sources: [path.join(root, "src/harness.ts"), path.join(root, "src/rcon.ts")],
    };
}

/** Every option of a run that is an input of the game, with a value; the test below changes each in turn */
const BASE: Partial<HarnessOptions> = {
    blueprint: "0blueprint",
    ticks: 600,
    warmup_ticks: 300,
    settle_ticks: 60,
    seed: [{ item: "iron-plate", count: 1 }],
    clock: { blueprint: "0clock", schedule: { counted_ticks: 72, inserter_combinators: [] } },
    config: { inserters: [{ id: 1 }], drills: { configs: [] } } as never,
    built_clock: { counter: 3, period: 72, first_value: 0 },
    copies: 2,
    unclocked: false,
    surface: "nauvis",
    position: { x: 1, y: 2 },
    drill_resource: "iron-ore",
    lua: "probe + helpers",
    game_speed: 1000,
    staged_start: { build_order: "ascending" },
    watch_debug: true,
};

const CHANGES: Record<string, Partial<HarnessOptions>> = {
    blueprint: { blueprint: "0other" },
    ticks: { ticks: 601 },
    warmup_ticks: { warmup_ticks: 301 },
    settle_ticks: { settle_ticks: 61 },
    seed: { seed: [{ item: "iron-plate", count: 2 }] },
    "clock blueprint": { clock: { ...BASE.clock!, blueprint: "0other" } },
    "clock schedule": { clock: { ...BASE.clock!, schedule: { counted_ticks: 73, inserter_combinators: [] } } },
    config: { config: { inserters: [{ id: 2 }], drills: { configs: [] } } as never },
    built_clock: { built_clock: { counter: 3, period: 73, first_value: 0 } },
    copies: { copies: 3 },
    unclocked: { unclocked: true },
    surface: { surface: "other" },
    position: { position: { x: 1, y: 3 } },
    drill_resource: { drill_resource: "copper-ore" },
    "probe script": { lua: "probe + other helpers" },
    game_speed: { game_speed: 500 },
    staged_start: { staged_start: { build_order: "descending" } },
    watch_debug: { watch_debug: false },
};

describe("the key of a recording", () => {
    it("is the same for the same inputs, whatever else a run says about where it goes", async () => {
        const game = environment();
        const first = await recordingCacheKey(BASE, game);
        expect(first.key).toMatch(/^[0-9a-f]{64}$/);
        expect(await recordingCacheKey({ ...BASE, config: { drills: { configs: [] }, inserters: [{ id: 1 }] } as never }, game)).toEqual(first);
        for (const where of [{ out: "/elsewhere/a.json" }, { work_dir: "/elsewhere/game" }, { log: () => { } }, { timeout_seconds: 1 }, { cache: false },
            { factorio: "/other/factorio" }, { save: "/other/save.zip" }]) {
            expect((await recordingCacheKey({ ...BASE, ...where }, game)).key, JSON.stringify(Object.keys(where))).toBe(first.key);
        }
    });

    it.each(Object.entries(CHANGES))("changes with the option %s", async (_, change) => {
        const game = environment();
        expect((await recordingCacheKey({ ...BASE, ...change }, game)).key).not.toBe((await recordingCacheKey(BASE, game)).key);
    });

    it("covers every option of a run: one added later is part of the key without being named", async () => {
        const game = environment();
        expect((await recordingCacheKey({ ...BASE, a_future_option: 1 } as never, game)).key).not.toBe((await recordingCacheKey(BASE, game)).key);
    });

    it("changes with the protocol, and with the recordings made before in the same game", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        expect((await recordingCacheKey(BASE, { ...game, protocol: game.protocol + 1 })).key).not.toBe(base);
        const after_one = (await recordingCacheKey(BASE, game, ["a"])).key;
        expect(after_one).not.toBe(base);
        expect((await recordingCacheKey(BASE, game, ["b"])).key).not.toBe(after_one);
        expect((await recordingCacheKey(BASE, game, ["a", "b"])).key).not.toBe(after_one);
    });

    it("changes with the game's executable, and with the names or sizes of the game's data", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        write("game/bin/x64/factorio", "#!/bin/sh\nexit 4\n");
        const changed_executable = (await recordingCacheKey(BASE, game)).key;
        expect(changed_executable).not.toBe(base);
        write("game/data/base/prototypes/item.lua", "items, more");
        const changed_size = (await recordingCacheKey(BASE, game)).key;
        expect(changed_size).not.toBe(changed_executable);
        write("game/data/space-age/info.json", `{"version":"2.1.0"}`);
        expect((await recordingCacheKey(BASE, game)).key).not.toBe(changed_size);
    });

    it("changes with the save", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        write("save.zip", "another save");
        expect((await recordingCacheKey(BASE, game)).key).not.toBe(base);
    });

    it("changes with any file of a mod the harness copies in, but not with a zip beside them", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        write("mods/recorder/build.zip", "a package");
        expect((await recordingCacheKey(BASE, game)).key).toBe(base);
        for (const [file, text] of [["mods/recorder/control.lua", "recorder, changed"], ["mods/recorder/scripts/events.lua", "events, changed"],
            ["mods/recorder/new.lua", "new"]]) {
            const before = (await recordingCacheKey(BASE, game)).key;
            write(file, text);
            expect((await recordingCacheKey(BASE, game)).key, file).not.toBe(before);
        }
    });

    it("takes no file of a transforming mod: only the description of the build moves the key", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        write("mods/sidecar/control.lua", "sidecar, changed");
        write("mods/sidecar/new.lua", "new");
        expect((await recordingCacheKey(BASE, game)).key).toBe(base);
        expect((await recordingCacheKey(BASE, game, [], "one")).key).not.toBe(base);
        expect((await recordingCacheKey(BASE, game, [], "one")).key).not.toBe((await recordingCacheKey(BASE, game, [], "two")).key);
    });

    it("changes with the harness's sources", async () => {
        const game = environment();
        const base = (await recordingCacheKey(BASE, game)).key;
        write("src/rcon.ts", "rcon, changed");
        expect((await recordingCacheKey(BASE, game)).key).not.toBe(base);
    });

    it("is refused, so the game runs, when an input cannot be read or told", async () => {
        const game = environment();
        await expect(recordingCacheKey(BASE, { ...game, save: path.join(root, "missing.zip") })).rejects.toThrow();
        await expect(recordingCacheKey(BASE, { ...game, executable: path.join(root, "missing") })).rejects.toThrow();
        await expect(recordingCacheKey(BASE, { ...game, data_dir: path.join(root, "missing") })).rejects.toThrow();
        await expect(recordingCacheKey(BASE, { ...game, mods: { missing: path.join(root, "missing") } })).rejects.toThrow();
        await expect(describedRecordingKey(BASE, { ...game, transforms: { missing: path.join(root, "missing") } }, [], path.join(root, "store"), false, async () => DESCRIPTION)).rejects.toThrow();
        await expect(recordingCacheKey(BASE, { ...game, host_sources: [path.join(root, "missing.ts")] })).rejects.toThrow();
        await expect(recordingCacheKey({ ...BASE, config: { run() { } } as never }, game)).rejects.toThrow("function");
        await expect(recordingCacheKey({ ...BASE, config: new (class Odd { x = 1 })() as never }, game)).rejects.toThrow("Odd");
        await expect(recordingCacheKey({ ...BASE, ticks: NaN }, game)).rejects.toThrow("not finite");
    });
});

/** What the game says of a build: the facts that decide what is measured, and what the Sidecar only offers or says of itself */
const DESCRIPTION: Record<string, unknown> = {
    config: {
        sidecar_version: "0.15.0",
        suggested_target: { items_per_second: 4, copies: 1 },
        machines: [{ id: 1, recipe: "gear" }],
        belts: [{ id: 1, lanes: [{ ingredient: "iron-plate" }] }],
        inserters: [{ source: { type: "belt", id: 1, pickup_capture: { sidecar_version: "0.15.0", tiles: 2 } }, sink: { type: "machine", id: 1 }, near_lane: 1 }],
    },
    inserters: [{ id: 1, unit_number: 40, source: { type: "belt", id: 1, near_lane: 1, pickup_capture: { sidecar_version: "0.15.0", tiles: 2 } }, sink: { type: "machine", id: 1 } }],
    machines: [{ id: 1, unit_number: 30, recipe: "gear" }],
    drills: [],
    left_out: [],
    left_out_drills: [],
    sidecar: { config: { sidecar_version: "0.15.0", suggested_target: { items_per_second: 4 } }, left_out: [] },
    movers: { inserters: [{ unit_number: 40 }] },
};

describe("a key made from the description of the build", () => {
    const store = () => path.join(root, "store");
    /** The key, and how many times the game was asked to describe the build */
    async function keyed(game: CacheEnvironment, described: Record<string, unknown>, options = BASE, refresh = false) {
        let asked = 0;
        const key = await describedRecordingKey(options, game, [], store(), refresh, async () => { asked++; return described; });
        return { key: key.key, asked };
    }

    it("keeps the key when the files of the transforming mod change and the description comes out the same", async () => {
        const game = environment();
        const first = await keyed(game, DESCRIPTION);
        expect(first.asked).toBe(1);
        write("mods/sidecar/control.lua", "sidecar, fixed");
        const config = DESCRIPTION.config as { inserters: { source: { pickup_capture: object } }[] };
        const newer = JSON.parse(JSON.stringify({ ...DESCRIPTION, config: { ...config, sidecar_version: "0.15.1" } }).replace(/0\.15\.0/g, "0.15.1"));
        const again = await keyed(game, newer);
        expect(again).toEqual({ key: first.key, asked: 1 });
        expect(JSON.stringify(buildFacts(DESCRIPTION))).not.toContain("0.15");
    });

    it("moves the key when the description changes, in a fact that decides what is measured", async () => {
        const game = environment();
        const first = await keyed(game, DESCRIPTION);
        write("mods/sidecar/control.lua", "sidecar, fixed");
        const config = DESCRIPTION.config as { belts: unknown[] };
        const changes: Record<string, Record<string, unknown>> = {
            "a belt lane's item": { config: { ...config, belts: [{ id: 1, lanes: [{ ingredient: "copper-plate" }] }] } },
            "an inserter's source": { inserters: [{ id: 1, unit_number: 40, source: { type: "belt", id: 1, near_lane: 2 }, sink: { type: "machine", id: 1 } }] },
            "a machine": { machines: [{ id: 1, unit_number: 31, recipe: "gear" }] },
            "an inserter left out": { left_out: [{ unit_number: 41 }] },
        };
        for (const [what, change] of Object.entries(changes)) {
            const key = await keyed(game, { ...DESCRIPTION, ...change });
            expect(key.key, what).not.toBe(first.key);
            write("mods/sidecar/control.lua", `sidecar, fixed for ${what}`);
        }
    });

    it("leaves out what the Sidecar suggests and says of itself, and what is not its own: a new suggested target keeps the key", async () => {
        const game = environment();
        const first = await keyed(game, DESCRIPTION);
        write("mods/sidecar/control.lua", "sidecar, suggests more");
        const config = DESCRIPTION.config as object;
        const suggested = await keyed(game, {
            ...DESCRIPTION,
            config: { ...config, suggested_target: { items_per_second: 12, copies: 3, copy_offset: { x: 0, y: 9 } } },
            sidecar: { config: { suggested_target: { items_per_second: 12 } }, left_out: [{ unit_number: 1 }] },
            movers: { inserters: [] },
        });
        expect(suggested.key).toBe(first.key);
        expect(Object.keys(buildFacts(DESCRIPTION))).toEqual(["config", "inserters", "machines", "drills", "left_out", "left_out_drills"]);
        expect(buildFacts(DESCRIPTION).config).not.toHaveProperty("suggested_target");
        expect(buildFacts(DESCRIPTION).config).not.toHaveProperty("sidecar_version");
    });

    it("still moves with a change of the recorder mod, the options, or what the build is made after", async () => {
        const game = environment();
        const first = await keyed(game, DESCRIPTION);
        write("mods/recorder/control.lua", "recorder, changed");
        const recorder = await keyed(game, DESCRIPTION);
        expect(recorder.key).not.toBe(first.key);
        expect((await keyed(game, DESCRIPTION, { ...BASE, ticks: 601 })).key).not.toBe(recorder.key);
    });

    it("asks the game once for the same files, game, save and options, and again for any of them changed, or when asked to refresh", async () => {
        const game = environment();
        expect((await keyed(game, DESCRIPTION)).asked).toBe(1);
        expect((await keyed(game, DESCRIPTION)).asked).toBe(0);
        expect((await keyed(game, DESCRIPTION, { ...BASE, ticks: 601 })).asked).toBe(1);
        write("save.zip", "another save");
        expect((await keyed(game, DESCRIPTION)).asked).toBe(1);
        expect((await keyed(game, DESCRIPTION, BASE, true)).asked).toBe(1);
    });

    it("is not made, so the game runs, when the game cannot describe the build", async () => {
        const game = environment();
        await expect(describedRecordingKey(BASE, game, [], store(), false, async () => { throw new Error("no build"); })).rejects.toThrow("no build");
        expect(fs.existsSync(path.join(store(), "descriptions"))).toBe(false);
    });
});

describe("canonicalJson", () => {
    it("writes the same text for the same data in any key order, and tells maps and sets from objects", () => {
        expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
        expect(canonicalJson(new Map([["a", 1]]))).not.toBe(canonicalJson({ a: 1 }));
        expect(canonicalJson(new Set([2, 1]))).toBe(canonicalJson(new Set([1, 2])));
        expect(canonicalJson("1")).not.toBe(canonicalJson(1));
    });
});

describe("where and whether the store is used", () => {
    it("is on unless asked otherwise, and off for a value it does not know", () => {
        const mode = (value?: string) => recordingCacheMode(value === undefined ? {} : { [RECORDING_CACHE_MODE_VARIABLE]: value });
        expect([mode(), mode(""), mode("on"), mode("ON")]).toEqual(["on", "on", "on", "on"]);
        expect([mode("off"), mode("0"), mode("of"), mode("cold")]).toEqual(["off", "off", "off", "off"]);
        expect(mode("refresh")).toBe("refresh");
    });

    it("is a folder outside the repository and the temporary folder", () => {
        expect(recordingCacheDir({ [RECORDING_CACHE_DIR_VARIABLE]: "/somewhere/else" })).toBe("/somewhere/else");
        expect(recordingCacheDir({ XDG_CACHE_HOME: "/cache" })).toBe("/cache/clock-generator/game-recordings");
        expect(recordingCacheDir({})).toBe(path.join(os.homedir(), ".cache", "clock-generator", "game-recordings"));
    });
});

/** A recording that parses: no samples, no machines */
const RECORDING = {
    format: "clock-generator-recording", version: 1, start_game_tick: 5, sample_count: 0, clock: { values: [] }, config: { inserters: [], belts: [] }, machines: [], inserters: [],
};

describe("a stored recording", () => {
    async function stored(store: string, logs: string[] = ["Built 3 entities"]) {
        const game = environment();
        const key = await recordingCacheKey(BASE, game);
        const bytes = JSON.stringify(RECORDING);
        write("run/recording.json", bytes);
        write("run/work/script-output/probe.json", `{"report":true}`);
        write("run/work/script-output/deeper/other.txt", "text");
        write("run/work/script-output/recording-2.json", bytes);
        const result: HarnessResult = { recording_path: path.join(root, "run/recording.json"), recording: parseRecording(RECORDING), build: { built: 3 }, start: { tick: 9 } };
        await storeRecording(store, key, { out: path.join(root, "run/recording.json"), work_dir: path.join(root, "run/work") }, result, logs);
        return key;
    }

    it("is read back with its recording, the files the game left, its answers and its messages", async () => {
        const store = path.join(root, "store");
        const key = await stored(store);
        const messages: string[] = [];
        const out = path.join(root, "again/out.json");
        const work_dir = path.join(root, "again/work");
        const restored = await restoreRecording(store, key.key, { out, work_dir, log: message => messages.push(message) });
        expect(restored?.build).toEqual({ built: 3 });
        expect(restored?.start).toEqual({ tick: 9 });
        expect(restored?.recording).toEqual(parseRecording(RECORDING));
        expect(restored?.recording_path).toBe(out);
        expect(messages).toEqual(["Built 3 entities"]);
        expect(fs.readFileSync(out, "utf-8")).toBe(JSON.stringify(RECORDING));
        expect(fs.readFileSync(path.join(work_dir, "script-output/probe.json"), "utf-8")).toBe(`{"report":true}`);
        expect(fs.readFileSync(path.join(work_dir, "script-output/deeper/other.txt"), "utf-8")).toBe("text");
        expect(fs.readFileSync(path.join(work_dir, "script-output/recording-2.json"), "utf-8")).toBe(JSON.stringify(RECORDING));
    });

    it("is not found under another key, and not read when the entry is damaged", async () => {
        const store = path.join(root, "store");
        const key = await stored(store);
        const options = { out: path.join(root, "again/out.json"), log: () => { } };
        expect(await restoreRecording(store, "0".repeat(64), options)).toBeNull();
        const entry = path.join(store, key.key);
        const meta = fs.readFileSync(path.join(entry, "meta.json"), "utf-8");
        for (const damage of [
            () => fs.writeFileSync(path.join(entry, "recording.json.gz"), "not gzip"),
            () => fs.rmSync(path.join(entry, "script-output/probe.json.gz")),
            () => fs.writeFileSync(path.join(entry, "meta.json"), "{"),
            () => fs.writeFileSync(path.join(entry, "meta.json"), meta.replace(`"protocol":${RECORDING_CACHE_PROTOCOL}`, `"protocol":${RECORDING_CACHE_PROTOCOL + 1}`)),
            () => fs.writeFileSync(path.join(entry, "meta.json"), meta.replace(key.key, "1".repeat(64))),
        ]) {
            const clean = await stored(path.join(root, "store2"));
            fs.cpSync(path.join(root, "store2", clean.key), entry, { recursive: true, force: true });
            damage();
            expect(await restoreRecording(store, key.key, options)).toBeNull();
        }
    });

    it("is replaced, not doubled, when stored again", async () => {
        const store = path.join(root, "store");
        await stored(store);
        await stored(store, ["second"]);
        expect(fs.readdirSync(store)).toHaveLength(1);
        const messages: string[] = [];
        await restoreRecording(store, (await recordingCacheKey(BASE, environment())).key, { out: path.join(root, "o.json"), log: m => messages.push(m) });
        expect(messages).toEqual(["second"]);
    });

    it("is removed when nobody has used it for a month, when another is stored", async () => {
        const store = path.join(root, "store");
        const old = await stored(store);
        const back = new Date(Date.now() - 31 * 24 * 3600 * 1000);
        fs.utimesSync(path.join(store, old.key, "meta.json"), back, back);
        const game = environment();
        const other = await recordingCacheKey({ ...BASE, ticks: 7 }, game);
        await storeRecording(store, other, { out: path.join(root, "run/recording.json") }, { recording_path: "", recording: parseRecording(RECORDING), build: {}, start: {} }, []);
        expect(fs.readdirSync(store)).toEqual([other.key]);
    });
});

/** A run through recordInFactorio against a game that cannot start: it answers only from the store, so a run that is not a hit rejects */
describe("a run through the store", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const name of [RECORDING_CACHE_DIR_VARIABLE, RECORDING_CACHE_MODE_VARIABLE, "CLOCK_RECORDING_CACHE_LOG"]) {
            saved[name] = process.env[name];
            delete process.env[name];
        }
        process.env[RECORDING_CACHE_DIR_VARIABLE] = path.join(root, "store");
    });
    afterEach(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
        }
    });

    function options(more: Partial<HarnessOptions> = {}, messages: string[] = []): HarnessOptions {
        const game = environment();
        return {
            factorio: game.executable, save: game.save, blueprint: "0", out: path.join(root, "out/recording.json"), ticks: 600, warmup_ticks: 0, seed: [],
            unclocked: true, game_speed: 1000, timeout_seconds: 5, log: message => messages.push(message), ...more,
        };
    }

    /** The key of a run, with the description of its build kept as the game would have made it */
    async function keyOf(run: Partial<HarnessOptions>, history: string[] = []) {
        const game = environment();
        return describedRecordingKey(run, await cacheEnvironmentOf(game.executable, game.save), history, process.env[RECORDING_CACHE_DIR_VARIABLE]!, false, async () => DESCRIPTION);
    }

    async function keep(run: HarnessOptions): Promise<void> {
        const key = await keyOf(run);
        write("kept/recording.json", JSON.stringify(RECORDING));
        await storeRecording(process.env[RECORDING_CACHE_DIR_VARIABLE]!, key, { out: path.join(root, "kept/recording.json") },
            { recording_path: "", recording: parseRecording(RECORDING), build: { from: "store" }, start: {} }, ["from the store"]);
    }

    it("is answered from the store without starting the game, and a change of any input starts it", async () => {
        const run = options();
        await keep(run);
        const messages: string[] = [];
        const log = path.join(root, "events.jsonl");
        process.env.CLOCK_RECORDING_CACHE_LOG = log;
        const result = await recordInFactorio({ ...run, log: message => messages.push(message) });
        expect(result.build).toEqual({ from: "store" });
        expect(messages).toEqual(["from the store"]);
        expect(JSON.parse(fs.readFileSync(path.join(root, "out/recording.json"), "utf-8")).start_game_tick).toBe(5);
        expect(fs.readFileSync(log, "utf-8")).toContain(`"event":"hit"`);
        // the game here fails to start: whatever is not a hit rejects
        for (const changed of [{ ticks: 601 }, { blueprint: "0x" }, { lua: "other probe" }, { seed: [{ item: "iron-plate" }] }, { cache: false }, { watch: true }]) {
            await expect(recordInFactorio({ ...run, ...changed }), JSON.stringify(changed)).rejects.toThrow(STARTED);
        }
        write("save.zip", "another save");
        await expect(recordInFactorio(run)).rejects.toThrow(STARTED);
    });

    it("runs the game when the store is off or asked to refresh, and when an input cannot be told", async () => {
        const run = options();
        await keep(run);
        for (const mode of ["off", "refresh", "cold"]) {
            process.env[RECORDING_CACHE_MODE_VARIABLE] = mode;
            await expect(recordInFactorio(run), mode).rejects.toThrow(STARTED);
        }
        delete process.env[RECORDING_CACHE_MODE_VARIABLE];
        await expect(recordInFactorio({ ...run, config: { run() { } } as never }), "a config with a function").rejects.toThrow(STARTED);
        await expect(recordInFactorio(run)).resolves.toBeDefined();
    });

    it("answers a session's builds from the store, and starts the game when one is missing", async () => {
        const first = options();
        const second = { ...first, out: path.join(root, "out/second.json") };
        // the second build is stored under the key of the first before it
        const first_key = await keyOf(first);
        const second_key = await keyOf({ ...second, ticks: 700 }, [first_key.key]);
        write("kept/recording.json", JSON.stringify(RECORDING));
        for (const key of [first_key, second_key]) {
            await storeRecording(process.env[RECORDING_CACHE_DIR_VARIABLE]!, key, { out: path.join(root, "kept/recording.json") },
                { recording_path: "", recording: parseRecording(RECORDING), build: { key: key.key }, start: {} }, []);
        }
        const { factorio, save, timeout_seconds, log } = first;
        const session = new CachedHarnessSession({ factorio, save, timeout_seconds, log });
        const { factorio: _f, save: _s, work_dir: _w, watch: _a, watch_debug: _d, ...build } = first;
        expect((await session.record(build)).build).toEqual({ key: first_key.key });
        expect((await session.record({ ...build, out: second.out, ticks: 700 })).build).toEqual({ key: second_key.key });
        // a build after those is not stored: the game is started, and fails here
        await expect(session.record({ ...build, ticks: 800 })).rejects.toThrow(STARTED);
        await session.close();
    });
});
