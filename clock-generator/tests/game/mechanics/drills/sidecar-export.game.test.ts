import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {ConfigPaths} from "../../../../src/config/config-paths";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {REPOSITORY_ROOT} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";

/**
 * Sidecar's export of a mining drill that has not mined or dropped yet (sidecar-export-probe.lua; README.md, "Sidecar's
 * export of a drill"): the steel wagon build's drill fast-replaced by a legendary one next to the full wagon, and a
 * legendary drill before its first tick against a chest, a car, a tank, a cargo wagon, a rocket silo and a furnace, each
 * just inside and just outside the tile under its drop position, the targets legendary too.
 */

// Factorio permits require only while parsing control.lua: the sidecar's sources are loaded into closures of the chunk
const MODULES = ["types", "helpers", "pickup-supply", "drop-merge", "suggested-target", "extraction", "export"];
const sidecarModules = `local capture_modules, require = {}, nil
require = function(name) return assert(capture_modules[name], name) end
` + MODULES.map(name => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, `clock-generator-sidecar/scripts/${name}.lua`), "utf8");
    return `capture_modules["__clock-generator-sidecar__.scripts.${name}"] = (function()\n${source}\nend)() or true\n`;
}).join("");

const TICKS = 300;

type Ref = {type: "machine" | "chest"; id: number} | false;
interface DrillConfig {type: string; mined_item_name: string; speed_bonus: number; productivity: number;
    target: {type: string; id: number}; position: {x: number; y: number}; direction: number}
interface Selection {
    counts: Record<string, number>;
    export: {drills: {configs: DrillConfig[] | Record<string, never>}; chests: {type: string; id: number; quality?: string}[] | Record<string, never>};
    left_out_drills: {target_name: string | false; no_resource: boolean}[] | Record<string, never>;
    targets: Ref[];
}
interface Trial {name: string; hit: boolean; at_build: Selection; at_end: Selection; mining_target_at_build: boolean;
    drop_target_at_build: boolean; filled: number[]; dropped_into: number}
interface Report {
    before: Selection & {drill: {quality: string; speed_bonus: number; productivity_bonus: number}};
    replaced: {quality: string; mining_target: boolean; drop_target: boolean; at_build: Selection; at_end: Selection;
        mining_target_at_end: boolean; drop_target_at_end: boolean};
    trials: Trial[];
}

const list = <T>(value: T[] | Record<string, never>): T[] => Array.isArray(value) ? value : [];

/** The steel wagon scaffold with its cargo wagon legendary (its drill stays normal: the probe replaces it) */
function scaffold(): string {
    const text = fs.readFileSync(path.join(path.dirname(ConfigPaths.STEEL_CARGO_WAGON), "steel-wagon-scaffold.txt"), "utf8").trim();
    const file = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = file.blueprint!.entities as unknown as {name: string; quality?: string}[];
    for (const entity of entities) if (entity.name === "cargo-wagon") entity.quality = "legendary";
    return encodeBlueprintFile(file);
}

test("Sidecar exports a drill that has not mined or dropped yet", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DRILLS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, "sidecar-export") : fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-drill-"));
    fs.mkdirSync(scratch, {recursive: true});
    let passed = false;
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!, blueprint: scaffold(), drill_resource: "iron-ore",
            lua: sidecarModules + composeProbeSource(path.join(__dirname, "sidecar-export-probe.lua"), {ticks: TICKS, output: "sidecar-export.json"}),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: TICKS + 10, warmup_ticks: 600, settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000,
            watch: false, timeout_seconds: 300, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/sidecar-export.json"), "utf8")) as Report;

        // 1. the build as given: the drill fast-replaced by a legendary one, the wagon's ore slots full
        const [before] = list(report.before.export.drills.configs);
        expect(report.before.drill.quality).toBe("normal");
        expect(before.target).toEqual(report.before.targets[0]);
        const {replaced} = report;
        expect(replaced.quality).toBe("legendary");
        // the game has told nothing yet, and with the wagon full the new drill does not mine
        expect([replaced.mining_target, replaced.drop_target, replaced.mining_target_at_end]).toEqual([false, false, false]);
        expect(replaced.drop_target_at_end).toBe(true);
        for (const selection of [replaced.at_build, replaced.at_end]) {
            expect(selection.counts.drills).toBe(1);
            expect(list(selection.left_out_drills)).toEqual([]);
            // the same drill as before, into the wagon, with its modules' and research's bonuses
            expect(list(selection.export.drills.configs)).toEqual([{...before, id: 1}]);
            expect(before).toMatchObject({type: "big-mining-drill", mined_item_name: "iron-ore", target: {type: "chest"},
                speed_bonus: report.before.drill.speed_bonus, productivity: report.before.drill.productivity_bonus * 100});
            const wagon = list(selection.export.chests).find(chest => chest.type === "cargo-wagon");
            expect(wagon).toMatchObject({id: before.target.id, quality: "legendary"});
            expect(list(selection.export.chests).map(chest => chest.type).sort()).toEqual(["cargo-wagon", "infinity-chest"]);
        }

        // 2. the drop rule: what the game fills is the export's target before the first tick (no drop_target yet)
        expect(report.trials.map(trial => trial.name)).toHaveLength(39);
        const outcomes = report.trials.map(trial => {
            const configs = (selection: Selection) => list(selection.export.drills.configs);
            const left = (selection: Selection) => list(selection.left_out_drills);
            const dropped = trial.dropped_into > 0;
            return {
                name: trial.name, hit: trial.hit, game: dropped && trial.filled[trial.dropped_into - 1] > 0,
                untouched: !dropped && trial.filled.every(count => count === 0),
                told_at_build: trial.mining_target_at_build || trial.drop_target_at_build,
                at_build: configs(trial.at_build).map(config => config.target), left_at_build: left(trial.at_build),
                at_end: configs(trial.at_end).map(config => config.target), left_at_end: left(trial.at_end),
                // what the game dropped into, as the export refers to it
                into: dropped ? trial.at_end.targets[trial.dropped_into - 1] : false,
                built_into: trial.at_build.targets[0],
                mined: configs(trial.at_end).map(config => config.mined_item_name),
            };
        });
        for (const outcome of outcomes) {
            expect(outcome.told_at_build, outcome.name).toBe(false);
            if (!outcome.hit) {
                expect(outcome.untouched, `${outcome.name}: the game fills nothing`).toBe(true);
                expect([outcome.at_build, outcome.at_end], outcome.name).toEqual([[], []]);
                expect([outcome.left_at_build, outcome.left_at_end], outcome.name)
                    .toEqual([[{target_name: false, no_resource: false}], [{target_name: false, no_resource: false}]]);
                continue;
            }
            expect(outcome.game, `${outcome.name}: the game fills its target`).toBe(true);
            // the end's export goes by the game's drop_target
            expect(outcome.at_end, outcome.name).toEqual([outcome.into]);
            if (outcome.name === "mixed-ore") {
                expect(outcome.left_at_build).toEqual([{target_name: "steel-chest", no_resource: true}]);
                expect(["iron-ore", "copper-ore"]).toContain(outcome.mined[0]);
            } else if (outcome.name === "two-targets") {
                expect(outcome.left_at_build).toEqual([{target_name: false, no_resource: false}]);
            } else if (outcome.name === "furnace" || outcome.name === "chest") {
                // a furnace has no recipe before its first ore and an empty steel chest is no buffer chest yet, so neither
                // is exported before the first tick: the drill is left out naming it, the one the game fills
                expect(outcome.left_at_build).toEqual([{target_name: outcome.name === "chest" ? "steel-chest" : "electric-furnace", no_resource: false}]);
                expect(outcome.into).toMatchObject({type: outcome.name === "chest" ? "chest" : "machine"});
            } else {
                // found by the rule before the first tick, and the one the game fills
                expect(outcome.at_build, outcome.name).toEqual([outcome.built_into]);
                expect(outcome.built_into, outcome.name).toEqual(outcome.into);
                expect(outcome.mined, outcome.name).toEqual(["iron-ore"]);
            }
        }
        passed = true;
    } finally {
        if (!retained && passed) fs.rmSync(scratch, {recursive: true, force: true});
    }
}, 400_000);
