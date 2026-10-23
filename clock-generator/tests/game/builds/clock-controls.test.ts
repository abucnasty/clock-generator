import fs from "fs";
import {describe, expect, test} from "vitest";
import {ConfigPaths} from "../../../src/config/config-paths";
import {ClockControl, pinMismatches, readControls} from "./clock-controls";
import {ownerClockHash} from "./own-clock-fixtures";

/**
 * Every game test that runs a generated clock compares what the game did with a recording, and the recording belongs to
 * one clock. These tests read the controls files only (no generation, no Factorio, so they run with the unit tests) and
 * fail where a pin was moved to follow a selection and its recording was not made again: the generation tests (pull
 * requests to master) find the selection that moved, this finds the pin that was edited to follow it.
 */
const FAMILIES = ["blocked-output", "car", "container", "front", "lithium-silo", "over-hood", "own", "pickup", "steel-wagon"]
    .map(family => `${family}-clock-controls.json`);
const hash = /^[0-9a-f]{64}$/;
/** Entries whose native summary has no known clock yet: the list may only shrink */
const NOT_YET_TIED: Record<string, string[]> = {};
/** Entries that are the clock of an owner's build, not a selection: the identity of that clock in the blueprint the test builds */
const OWNER_CLOCKS: Record<string, Record<string, string>> = {"own-clock-controls.json": {"own-clock-three-copies": ownerClockHash()}};

test("every family of game tests with a controls file is checked here", () => {
    const files = fs.readdirSync(__dirname).filter(file => file.endsWith("-clock-controls.json") && !file.includes("history")).sort();
    expect(files).toEqual([...FAMILIES].sort());
});

describe.each(FAMILIES)("%s", file => {
    const controls = readControls(file);
    test("every native summary names the clock it was recorded on, and the pin names it too", () => {
        expect(Object.keys(controls.cases).length).toBeGreaterThan(0);
        expect(pinMismatches(controls.cases, NOT_YET_TIED[file], OWNER_CLOCKS[file])).toEqual([]);
    });
    test("the entries not tied yet are entries", () => {
        for (const name of NOT_YET_TIED[file] ?? []) expect(controls.cases[name], name).toBeDefined();
    });
});

describe("pinMismatches", () => {
    const entry = (recorded: object, pin = "b".repeat(64)): ClockControl => ({
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "capture", ...recorded},
        native: {generationVerdict: "stable", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        generation: {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: pin},
    });
    const a = "a".repeat(64), b = "b".repeat(64);

    test("accepts a recording on the pinned clock", () => {
        expect(pinMismatches({one: entry({clock_sha256: b})})).toEqual([]);
    });
    test("fails a pin that moved while the recording did not", () => {
        const found = pinMismatches({one: entry({clock_sha256: a})});
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("one: the pin names clock bbbbbbbbbbbb and the native summary was recorded on aaaaaaaaaaaa");
    });
    test("accepts a moved pin that says why the recording still holds, and nothing that says it for no reason", () => {
        expect(pinMismatches({one: entry({clock_sha256: a, carried: "5e904a10: same windows, verdicts and game result"})})).toEqual([]);
        expect(pinMismatches({one: entry({clock_sha256: a, carried: " "})}).length).toBeGreaterThan(0);
        expect(pinMismatches({one: entry({clock_sha256: b, carried: "stale"})})).toHaveLength(1);
    });
    test("fails a native summary with no clock, no basis or no pin", () => {
        expect(pinMismatches({one: entry({})})).toHaveLength(1);
        expect(pinMismatches({one: entry({clock_sha256: "xyz"})})).toHaveLength(1);
        expect(pinMismatches({one: entry({clock_sha256: b, clock_basis: undefined})})).toHaveLength(1);
        expect(pinMismatches({one: {...entry({clock_sha256: b}), generation: undefined}})).toHaveLength(1);
    });
    test("fails a native summary and a pin of different periods", () => {
        const other = entry({clock_sha256: b});
        other.generation!.period = 12;
        expect(pinMismatches({one: other})).toHaveLength(1);
    });
    test("lets an entry listed as not tied go without a clock, and not keep one", () => {
        expect(pinMismatches({one: entry({})}, ["one"])).toEqual([]);
        expect(pinMismatches({one: entry({clock_sha256: b})}, ["one"])).toHaveLength(1);
    });
});

describe("pinMismatches for a clock the owner built", () => {
    const hash = "c".repeat(64);
    const owner = (recorded: object = {}, extra: object = {}): ClockControl => ({
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "built", clock_sha256: hash, ...recorded},
        native: {generationVerdict: "the build's own clock", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        ...extra,
    });
    const built = {one: hash};

    test("accepts a recording on the owner's clock, with no pin", () => {
        expect(pinMismatches({one: owner()}, [], built)).toEqual([]);
    });
    test("fails a recording of another clock than the blueprint's, a missing hash, or another basis", () => {
        expect(pinMismatches({one: owner({clock_sha256: "d".repeat(64)})}, [], built)[0]).toContain("record it again in the game");
        expect(pinMismatches({one: owner({clock_sha256: undefined})}, [], built)).toHaveLength(1);
        expect(pinMismatches({one: owner({clock_basis: "capture"})}, [], built)).toHaveLength(1);
    });
    test("fails a pin or a carried note on it", () => {
        const pin = {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: hash};
        expect(pinMismatches({one: owner({}, {generation: pin})}, [], built)).toHaveLength(1);
        expect(pinMismatches({one: owner({carried: "x"})}, [], built)).toHaveLength(1);
    });
    test("does not let a generated entry take the basis: it is not named as a clock the owner built", () => {
        expect(pinMismatches({one: owner()})).toHaveLength(1);
        expect(pinMismatches({one: owner()}, ["one"])).toHaveLength(1);
    });
});

describe("cold starts", () => {
    const start = readControls<{cold_start: {clocks: Record<string, {clock_sha256: string; recorded_clock_sha256: string}>; runs: Record<string, {clock: string}>}}>("pickup-clock-start-controls.json").cold_start;
    test("every clock the runs were recorded on is the one the selection and the pinned windows make", () => {
        const found = Object.entries(start.clocks).filter(([, clock]) => clock.recorded_clock_sha256 !== clock.clock_sha256 || !hash.test(clock.clock_sha256))
            .map(([key, clock]) => `${key}: pinned ${clock.clock_sha256}, recorded on ${clock.recorded_clock_sha256}`);
        expect(found).toEqual([]);
    });
    test("every run names a clock, and every clock has a run", () => {
        const used = new Set(Object.values(start.runs).map(run => run.clock));
        expect([...used].filter(key => !start.clocks[key])).toEqual([]);
        expect(Object.keys(start.clocks).filter(key => !used.has(key))).toEqual([]);
    });
});

describe("scaffold recordings", () => {
    const pins = readControls<{cases: Record<string, {config: string; clock_sha256: string}>}>("scaffold-recordings-clock-pins.json").cases;
    test("each pinned build has a hash and a config that exists", () => {
        expect(Object.keys(pins).length).toBeGreaterThan(0);
        for (const [name, pin] of Object.entries(pins)) {
            expect(pin.clock_sha256, name).toMatch(hash);
            expect(fs.existsSync((ConfigPaths as Record<string, string>)[pin.config]), `${name}: ${pin.config}`).toBe(true);
        }
    });
});

test("the history files keep the recordings of clocks no pin names", () => {
    // a superseded recording belongs to no current pin: it has no hash to keep in step
    for (const file of fs.readdirSync(__dirname).filter(file => file.endsWith("history-controls.json"))) {
        const history = readControls<{cases: Record<string, {recorded: {clock_sha256?: string}}[]>}>(file);
        for (const entries of Object.values(history.cases)) for (const it of entries) expect(it.recorded.clock_sha256).toBeUndefined();
    }
});
