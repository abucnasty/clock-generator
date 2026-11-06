import fs from "fs";
import {describe, expect, test} from "vitest";
import {ConfigPaths} from "../../../src/config/config-paths";
import {ClockControl, ClockHistory, coldClockReferenceMismatches, fixtureAlternativeMismatches, historicalPinMismatches, pinMismatches, readControls, readRecordJob, RecordJob, recordMismatches, RecordLink} from "./clock-controls";
import {coldStart} from "./pickup-clock-cold-start-runs";
import {scaffoldClockPins} from "./scaffold-recordings-clock-pins";
import {handMadeClockHash as grenadeClockHash} from "./grenade-clock-fixtures";
import {handMadeClockHash, inserterCraftingClockCases} from "./inserter-crafting-240-shared-signal-clock-fixtures";
import {carCases} from "./iron-plate-80-car-chest-clock-fixtures";
import {steelWagonCases} from "./steel-plate-26-wagon-chest-clock-fixtures";
import {lithiumSiloCases} from "./lithium-plate-80-silo-chest-clock-fixtures";
import {GENERATED_ALTERNATIVE as LOGISTIC_ALTERNATIVE} from "./logistic-science-240-direct-insert-clock-fixtures";
import {GENERATED_ALTERNATIVE as GRENADE_ALTERNATIVE, grenadeClockCases} from "./grenade-clock-fixtures";
import {GENERATED_ALTERNATIVE as PRODUCTIVITY_ALTERNATIVE} from "./productivity-module-80-chest-chain-clock-fixtures";
import {GENERATED_ALTERNATIVE as UTILITY_ALTERNATIVE} from "./utility-science-480-lds-foundry-chain-clock-fixtures";
import {GENERATED_ALTERNATIVE as CIRCUIT_EXPORT_ALTERNATIVE, PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES} from "./processing-unit-80-circuit-export-clock-fixtures";

/**
 * Every game test that runs a generated clock compares what the game did with a recording, and the recording belongs to
 * one clock. These tests read the controls files only (no generation, no Factorio, so they run with the unit tests) and
 * fail where a pin was moved to follow a selection and its recording was not made again: the record (the Rec summary
 * check of a pull request) finds the selection that moved, this finds the pin that was edited to follow it.
 */
const FAMILIES = ["blocked-output", "container", "front", "grenade", "inserter-crafting-240-shared-signal", "iron-ore-voider-400", "iron-plate-80-car-chest", "electromagnetic-science-330-drained-end", "lithium-plate-80-silo-chest", "logistic-science-240-direct-insert", "over-hood", "pickup", "processing-unit-80-circuit-export", "productivity-module-80-chest-chain", "steel-plate-26-wagon-chest", "utility-science-480-lds-foundry-chain"]
    .map(family => `${family}-clock-controls.json`);
const hash = /^[0-9a-f]{64}$/;
/** Entries whose native summary has no known clock yet: the list may only shrink */
const NOT_YET_TIED: Record<string, string[]> = {};
/** Entries that are a build's hand-made clock, not a selection: the identity of that clock in the blueprint the test builds */
const OWNER_CLOCKS: Record<string, Record<string, string>> = {
    "inserter-crafting-240-shared-signal-clock-controls.json": {"hand-made-clock-three-copies": handMadeClockHash()},
    "grenade-clock-controls.json": {"hand-made-one-copy": grenadeClockHash("one copy"), "hand-made-full-build": grenadeClockHash("full build")},
};

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

describe("pinMismatches for a hand-made clock", () => {
    const hash = "c".repeat(64);
    const owner = (recorded: object = {}, extra: object = {}): ClockControl => ({
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "built", clock_sha256: hash, ...recorded},
        native: {generationVerdict: "the build's own clock", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        ...extra,
    });
    const built = {one: hash};

    test("accepts a recording on the hand-made clock, with no pin", () => {
        expect(pinMismatches({one: owner()}, [], built)).toEqual([]);
    });
    test("fails a recording of another clock than the blueprint's, a missing hash, or another basis", () => {
        expect(pinMismatches({one: owner({clock_sha256: "d".repeat(64)})}, [], built)[0]).toContain("record it again in the game");
        expect(pinMismatches({one: owner({clock_sha256: undefined})}, [], built)).toHaveLength(1);
        expect(pinMismatches({one: owner({clock_basis: "capture"})}, [], built)).toHaveLength(1);
    });
    test("fails a pin on it", () => {
        const pin = {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: hash};
        expect(pinMismatches({one: owner({}, {generation: pin})}, [], built)).toHaveLength(1);
    });
    test("does not let a generated entry take the basis: it is not named as a hand-made clock", () => {
        expect(pinMismatches({one: owner()})).toHaveLength(1);
        expect(pinMismatches({one: owner()}, ["one"])).toHaveLength(1);
    });
});

describe("cold starts", () => {
    const start = readControls<{cold_start: {clocks: Record<string, {clock_sha256: string; recorded_clock_sha256: string}>; runs: Record<string, {clock: string}>; historical_runs?: Record<string, {clock: string}>}}>("pickup-clock-start-controls.json").cold_start;
    test("every clock the runs were recorded on is the one the selection and the pinned windows make", () => {
        const found = Object.entries(start.clocks).filter(([, clock]) => clock.recorded_clock_sha256 !== clock.clock_sha256 || !hash.test(clock.clock_sha256))
            .map(([key, clock]) => `${key}: pinned ${clock.clock_sha256}, recorded on ${clock.recorded_clock_sha256}`);
        expect(found).toEqual([]);
    });
    test("every run names a clock, and every clock has a run", () => {
        expect(coldClockReferenceMismatches(start.clocks, start.runs, start.historical_runs)).toEqual([]);
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

test("known historical captures retain their own identity, separate from the active pin", () => {
    for (const file of fs.readdirSync(__dirname).filter(file => file.endsWith("history-controls.json"))) {
        const history = readControls<ClockHistory>(file);
        if (!Object.values(history.cases).some(entries => entries.some(it => it.recorded.clock_sha256 !== undefined))) continue;
        const current = readControls(file.replace("-history-controls.json", "-controls.json"));
        expect(historicalPinMismatches(history.cases, current.cases), file).toEqual([]);
    }
});

test("cold reference checks include history without accepting missing or orphaned clocks", () => {
    const clocks = {active: {}, old: {}};
    const runs = {now: {clock: "active"}}, history = {before: {clock: "old"}};
    expect(coldClockReferenceMismatches(clocks, runs, history)).toEqual([]);
    expect(coldClockReferenceMismatches(clocks, runs)).toEqual(["old: clock has no current or historical run"]);
    expect(coldClockReferenceMismatches({active: {}}, runs, history)).toEqual(["old: run names a missing clock"]);
});

describe("historical identity validation", () => {
    const entry: ClockControl = {
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_sha256: "a".repeat(64), clock_basis: "capture"},
        native: {generationVerdict: "stable", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        generation: {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: "a".repeat(64)},
    };
    const current = {...entry, generation: {...entry.generation!, clock_sha256: "b".repeat(64)}};
    test("keeps a known old hash and its complete control", () => {
        expect(historicalPinMismatches({one: [entry]}, {one: current})).toEqual([]);
    });
    test("rejects active identity, malformed identity, absent old pin and inconsistent quantities", () => {
        expect(historicalPinMismatches({one: [entry]}, {one: entry})[0]).toContain("still names the active pin");
        expect(historicalPinMismatches({one: [{...entry, recorded: {...entry.recorded, clock_sha256: "bad"}}]}, {one: current})[0]).toContain("recorded.clock_sha256 is missing");
        expect(historicalPinMismatches({one: [{...entry, generation: undefined}]}, {one: current})[0]).toContain("no generation pin");
        expect(historicalPinMismatches({one: [{...entry, native: {...entry.native, expected: 6}}]}, {one: current})[0]).toContain("different clocks");
    });
    test("a capture records actual source heads without invented pin publication metadata", () => {
        const captured = {...entry, recorded: {frozen_head: null, clock_sha256: "a".repeat(64), clock_basis: "capture" as const,
            capture: {validation_pr: 551, control_head: "c".repeat(40), harness_head: "d".repeat(40), game_version: "2.1.21"}}};
        expect(pinMismatches({one: captured})).toEqual([]);
        const invalid = {...captured, recorded: {...captured.recorded, capture: {...captured.recorded.capture, control_head: "short"}}};
        expect(pinMismatches({one: invalid})[0]).toContain("full control and harness commit identities");
        expect(pinMismatches({one: {...captured, recorded: {...captured.recorded, pr: 1, commit: "made-up"} as unknown as ClockControl["recorded"]}})[0]).toContain("must not claim pin publication identifiers");
        expect(pinMismatches({one: {...captured, recorded: {...captured.recorded, clock_basis: "history"}}})[0]).toContain("requires the capture clock basis");
    });
});

/**
 * The generation pins of the controls files against the record (`clock-generator/record/`, one file per blast job): a pin
 * is of the record job's alternative with the pin's id (clock hash, period, verdict, holds, rate, supply), so a moved
 * generation fails here without a generation test of its own for each pin. The record is committed beside the controls
 * and regenerated by CI (the Rec summary check), so a pin and a record that differ are two files that differ.
 */
const fixture = (group: string) => (name: string) => `${group}-${name}`;
const config = (key: string) => (): string => `config-${key}`;
/** The job of a variant of a sample (tests/game/builds/variant-jobs.ts): a build with its belts backed up, an ingredient left out of the period */
const variant = (name: string) => `variants-${name}`;
const backed = (name: string) => /-backed(-|$)/.test(name) ? "backed_up" as const : "moving" as const;
const RECORD_LINKS: Record<string, RecordLink & {runs?: boolean}> = {
    "blocked-output-clock-controls.json": {jobOf: fixture("blocked"), runs: true},
    "container-clock-controls.json": {jobOf: fixture("containers"), runs: true},
    // the front exit's inserter stands on the exit's output tile: its belt is backed up in the game whatever the config says
    "front-clock-controls.json": {jobOf: fixture("front"), runs: true, runSupply: name => name.startsWith("front-exit-") ? "backed_up" : backed(name)},
    "over-hood-clock-controls.json": {jobOf: fixture("overhood"), runs: true, runSupply: backed},
    "pickup-clock-controls.json": {jobOf: fixture("pickup"), runs: true, runSupply: backed},
    "electromagnetic-science-330-drained-end-clock-controls.json": {jobOf: config("ELECTROMAGNETIC_SCIENCE_330")},
    "grenade-clock-controls.json": {jobOf: config("GRENADE_240_FILLS_BELT_EXACTLY")},
    "inserter-crafting-240-shared-signal-clock-controls.json": {
        jobOf: name => name === "generated-backed-up-one-copy" ? variant("INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP") : "config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK",
        offered: ["generated-three-copies"]},
    "iron-ore-voider-400-clock-controls.json": {
        jobOf: name => name === "ore-voider-exact-speed" ? "config-IRON_ORE_VOIDER_400_EXACT_SPEED" : "config-IRON_ORE_VOIDER_400_OVERBEACONED", runs: true},
    "iron-plate-80-car-chest-clock-controls.json": {
        jobOf: config("IRON_PLATE_80_CAR_CHEST"), runs: true,
        offered: ["car-swings-1", "car-swings-2", "car-swings-2-takers-last", "car-swings-3", "car-swings-3-takers-last"]},
    "lithium-plate-80-silo-chest-clock-controls.json": {
        jobOf: config("LITHIUM_PLATE_80_SILO_CHEST"), offered: ["lithium-silo-swings-1", "lithium-silo-swings-3", "lithium-silo-swings-3-fill-last", "lithium-silo-swings-7"]},
    // its game test records fractional swings, selected until #595 (batched swings with the slack inside its windows since)
    "logistic-science-240-direct-insert-clock-controls.json": {jobOf: config("LOGISTIC_SCIENCE_240_DIRECT_INSERT"), offered: ["generated-one-copy"]},
    "processing-unit-80-circuit-export-clock-controls.json": {
        jobOf: name => name === "generated-backed-up" ? variant("PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP") : "config-PROCESSING_UNIT_80_CIRCUIT_EXPORT"},
    "productivity-module-80-chest-chain-clock-controls.json": {jobOf: config("PRODUCTIVITY_MODULE_80_CHEST_CHAIN")},
    "steel-plate-26-wagon-chest-clock-controls.json": {
        jobOf: name => name === "steel-wagon-iron-ore-out-of-period" ? variant("STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD") : "config-STEEL_PLATE_26_WAGON_CHEST", runs: true,
        offered: ["steel-wagon-belt-slack", "steel-wagon-belt-slack-fill-last", "steel-wagon-iron-ore-out-of-period"]},
    "utility-science-480-lds-foundry-chain-clock-controls.json": {jobOf: config("UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN")},
};

/**
 * The alternative each game test's fixture says it records, by entry name, for the families whose fixture names one (the
 * others record the job's selection, whatever it is). The record check above finds the pin's alternative in the record
 * by `generation.selection.id`; a fixture that names another one would be recorded in the game on a clock the pin is not
 * of, and nothing but this finds it now that the generation tests do not read the fixture's id.
 */
const FIXTURE_ALTERNATIVES: Record<string, Record<string, string>> = {
    "inserter-crafting-240-shared-signal-clock-controls.json": Object.fromEntries(inserterCraftingClockCases().filter(it => it.alternative !== undefined).map(it => [it.name, it.alternative!])),
    "iron-plate-80-car-chest-clock-controls.json": Object.fromEntries(carCases().map(it => [it.name, it.alternative])),
    "steel-plate-26-wagon-chest-clock-controls.json": Object.fromEntries(steelWagonCases().map(it => [it.name, it.alternative])),
    "lithium-plate-80-silo-chest-clock-controls.json": Object.fromEntries(lithiumSiloCases().map(it => [it.name, it.alternative])),
    "logistic-science-240-direct-insert-clock-controls.json": {"generated-one-copy": LOGISTIC_ALTERNATIVE},
    "grenade-clock-controls.json": Object.fromEntries(grenadeClockCases().filter(it => it.kind === "generated clock").map(it => [it.name, GRENADE_ALTERNATIVE])),
    "productivity-module-80-chest-chain-clock-controls.json": {"generated-one-copy": PRODUCTIVITY_ALTERNATIVE},
    "utility-science-480-lds-foundry-chain-clock-controls.json": {"generated-one-copy": UTILITY_ALTERNATIVE},
    "processing-unit-80-circuit-export-clock-controls.json": Object.fromEntries(PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES.map(it => [it.name, CIRCUIT_EXPORT_ALTERNATIVE])),
};

describe("the fixtures name the alternative their pin is of", () => {
    describe.each(Object.entries(FIXTURE_ALTERNATIVES))("%s", (file, named) => {
        const controls = readControls(file).cases;
        test("every entry with a generation pin has a fixture that names its alternative, and it is the pin's selection.id", () => {
            expect(fixtureAlternativeMismatches(controls, named)).toEqual([]);
        });
        test("every fixture that names an alternative has an entry in the controls", () => {
            expect(Object.keys(named).filter(name => controls[name] === undefined)).toEqual([]);
        });
    });
    test("a fixture and a pin that name different alternatives, or a pin with no fixture alternative, are found, with the entry and both ids", () => {
        const pin = (id: string) => ({generation: {selection: {id}}}) as unknown as ClockControl;
        expect(fixtureAlternativeMismatches({one: pin("swings-2")}, {one: "swings-2"})).toEqual([]);
        expect(fixtureAlternativeMismatches({one: pin("swings-2")}, {one: "swings-3"})).toEqual(["one: the fixture records swings-3 and the pin is of swings-2"]);
        expect(fixtureAlternativeMismatches({one: pin("swings-2")}, {})).toEqual(["one: has a generation pin and its fixture names no alternative"]);
        expect(fixtureAlternativeMismatches({one: {} as ClockControl}, {})).toEqual([]);
    });
});

describe("the record", () => {
    test("every family of controls with a generation pin has a link to the record", () => {
        expect(Object.keys(RECORD_LINKS).sort()).toEqual([...FAMILIES].sort());
    });
    describe.each(Object.entries(RECORD_LINKS))("%s", (file, link) => {
        const controls = readControls(file);
        test("each generation pin is the record's: clock hash, period, verdict, selection and earlier clock", () => {
            expect(recordMismatches(controls.cases, link, readRecordJob, link.runs)).toEqual([]);
        });
        test("every generation pin has a job in the record", () => {
            const without = Object.entries(controls.cases).filter(([name, control]) => control.generation && link.jobOf(name) === undefined).map(([name]) => name);
            expect(without).toEqual([]);
        });
    });

    describe("scaffold recordings", () => {
        const pins = Object.entries(scaffoldClockPins);
        test("each pin is the record's selected clock of its config, and its earlier clock is still made", () => {
            const found: string[] = [];
            for (const [name, pin] of pins) {
                const job = pin.backed_up_belts ? variant(`${pin.config}_BACKED_UP`) : `config-${pin.config}`;
                const made = readRecordJob(job);
                if (made === undefined) { found.push(`${name}: ${job} has no result in the record`); continue; }
                const selected = made.alternatives.find(it => it.id === made.selected)!;
                if (selected.clock_sha256 !== pin.clock_sha256) found.push(`${name}: the pin names clock ${pin.clock_sha256.slice(0, 12)} and record job ${job} selects ${selected.clock_sha256.slice(0, 12)}`);
                if (pin.previous) {
                    const earlier = made.alternatives.find(it => it.id === pin.previous!.id);
                    expect(pin.previous.why.trim(), `${name}: why the earlier clock is kept`).not.toBe("");
                    if (earlier?.clock_sha256 !== pin.previous.clock_sha256 || earlier.verdict !== "stable" || selected.verdict !== "stable") {
                        found.push(`${name}: the earlier clock ${pin.previous.id} is not a stable alternative with the hash ${pin.previous.clock_sha256.slice(0, 12)} in record job ${job}`);
                    }
                }
            }
            expect(found).toEqual([]);
        });
        test("a pin of a config with its belts backed up is of the variant's job, the others of the config's", () => {
            expect(pins.filter(([, pin]) => pin.backed_up_belts).map(([name, pin]) => `${name}: ${variant(`${pin.config}_BACKED_UP`)}`))
                .toEqual(["agricultural science (belts are backed up): variants-AGRICULTURAL_SCIENCE_250_BACKED_UP"]);
        });
    });

    describe("cold starts", () => {
        test("the clock a run started at the period's beginning was recorded on is the record's selected clock of its fixture", () => {
            const found: string[] = [];
            let linked = 0;
            for (const [name, run] of Object.entries(coldStart.runs)) {
                if (run.rotate !== 0 || run.decider_order !== "built") continue;
                const side = /^(\w+)-(.+)-(moving|backed)-l1$/.exec(run.case);
                const job = side ? `pickup-electromagnetic-${side[1]}-${side[2]}-${side[3]}` : run.case.startsWith("over-hood-") ? `overhood-${run.case}` : undefined;
                if (job === undefined) continue; // near lane 2 is a reflected fixture of its own, not a job
                const made = readRecordJob(job);
                if (made === undefined) { found.push(`${name}: record job ${job} has no result`); continue; }
                linked++;
                const selected = made.alternatives.find(it => it.id === made.selected)!;
                if (selected.clock_sha256 !== coldStart.clocks[run.clock].clock_sha256) {
                    found.push(`${name}: the run was recorded on clock ${coldStart.clocks[run.clock].clock_sha256.slice(0, 12)} and record job ${job} selects ${selected.clock_sha256.slice(0, 12)}`);
                }
            }
            expect(found).toEqual([]);
            expect(linked).toBeGreaterThan(0);
        });
    });

    describe("recordMismatches", () => {
        const pinned = "a".repeat(64), other = "b".repeat(64);
        const alternative = (extra: object = {}) => ({id: "x", verdict: "stable", holds: true, rate: 1, supply: null, period: 10, clock_sha256: pinned, ...extra});
        const job = (alternatives = [alternative()], selected = "x"): RecordJob => ({job: "config-ONE", selected, alternatives});
        const entry = (extra: Partial<ClockControl> = {}): ClockControl => ({
            recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "capture", clock_sha256: pinned},
            native: {generationVerdict: "stable", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
            generation: {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: pinned},
            ...extra,
        });
        const link: RecordLink = {jobOf: () => "config-ONE"};
        const check = (made: RecordJob | undefined, controls: ClockControl = entry(), at: RecordLink = link) =>
            recordMismatches({one: controls}, at, () => made);

        test("accepts a pin that is the record's", () => {
            expect(check(job())).toEqual([]);
        });
        test("a controls hash that differs from the record's fails, naming the entry, the job and both hashes", () => {
            const found = check(job([alternative({clock_sha256: other})]));
            expect(found).toHaveLength(1);
            expect(found[0]).toContain("one: the pin names clock aaaaaaaaaaaa");
            expect(found[0]).toContain("record job config-ONE, alternative x makes bbbbbbbbbbbb");
        });
        test("fails a job missing from the record, an alternative that is gone, and a period, verdict or supply that differ", () => {
            expect(check(undefined)[0]).toContain("record job config-ONE has no result");
            expect(check(job([alternative({id: "y"})]))[0]).toContain("has no alternative x");
            expect(check(job([alternative({period: 12})]))[0]).toContain("differ");
            expect(check(job([alternative({verdict: "unstable"})]))[0]).toContain("differ");
            expect(check(job([alternative({supply: "moving"})]))[0]).toContain("differ");
        });
        test("a pin of an alternative the job does not select fails unless the entry is listed, and the list does not keep a selected one", () => {
            const two = job([alternative({id: "y"}), alternative()], "y");
            expect(check(two)[0]).toContain("config-ONE selects y");
            expect(check(two, entry(), {...link, offered: ["one"]})).toEqual([]);
            expect(check(job(), entry(), {...link, offered: ["one"]})[0]).toContain("take it off the list");
        });
        test("the earlier clock is still an alternative with its hash", () => {
            const earlier = entry({previous: {id: "y", clock_sha256: other}});
            expect(check(job([alternative(), alternative({id: "y", clock_sha256: other})]), earlier)).toEqual([]);
            expect(check(job(), earlier)[0]).toContain("earlier clock y is no longer made");
            expect(check(job([alternative(), alternative({id: "y"})]), earlier)[0]).toContain("earlier clock y is bbbbbbbbbbbb");
        });
        test("a stable alternative whose game run does not hold fails, and so does a run that misses its target where the generator says it holds", () => {
            const run = (result: string, meets: boolean, generationVerdict = "stable") => ({protocol: "trailing-minute" as const, generationVerdict, target: 1, period: 10, window: 600, expected: 10,
                steady: 0, baseline: {ticks: 600, total: 10, expected: 10, min: 10, max: 10, held: true, meets}, disturbances: [], stock: null, result, ended: 600});
            const control = (result: string, meets: boolean, generationVerdict = "stable") => entry({native: run(result, meets, generationVerdict)});
            expect(recordMismatches({one: control("holds", true)}, link, () => job(), true)).toEqual([]);
            const missed = {...control("the output fell", false, "unstable"), generation: {...entry().generation!, verdict: "unstable", selection: {...entry().generation!.selection, holds: false}}};
            expect(recordMismatches({one: missed}, link, () => job([alternative({verdict: "unstable", holds: false})]), true)).toEqual([]);
            expect(recordMismatches({one: control("the output fell", false)}, link, () => job(), true).join("\n")).toContain("does not hold and recover");
            expect(recordMismatches({one: control("holds", true, "unstable")}, link, () => job(), true)[0]).toContain("recorded on a unstable clock");
            const holdsUnstable = {...control("holds", false, "unstable"), generation: {...entry().generation!, verdict: "unstable"}};
            expect(recordMismatches({one: holdsUnstable}, link, () => job([alternative({verdict: "unstable"})]), true)[0]).toContain("misses the target");
            const moving = {...holdsUnstable, generation: {...holdsUnstable.generation, selection: {...holdsUnstable.generation.selection, supply: "moving"}}};
            expect(recordMismatches({one: moving}, {...link, runSupply: () => "backed_up"}, () => job([alternative({verdict: "unstable", supply: "moving"})]), true)).toEqual([]);
        });
    });
});
