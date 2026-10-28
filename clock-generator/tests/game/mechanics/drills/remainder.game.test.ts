import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {bonusBarTick} from "../../../../src/simulation/components/mining";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {composeProbeSource} from "../../helpers/probe-source";

/**
 * A drill's bars near a whole item: the probe (remainder-probe.lua) sets a big mining drill's bars by script so that
 * its next mining tick lands a little above or below a whole mining time, and the simulator's bonus bar
 * (`bonusBarTick`) must give the game's bar and items in every trial; the mining bar has no tolerance. See README.md.
 */
interface Trial {x: number; bar: "bonus" | "tiny" | "main"; r: number; main_item: boolean}
interface Row {n: number; p: number; b: number; trial?: number; inc?: number; wb?: number; wp?: number}

/** From a whole mining time, both sides; no trial lands on the tolerances themselves (0.001 above, 0.0001 below), where
 * the game's sum and the simulator's can differ in the last bit */
const MAGNITUDES = [1e-9, 1e-6, 5e-5, 9.9e-5, 1.01e-4, 2.5e-4, 5e-4, 9.9e-4, 1.01e-3, 2e-3, 1e-2];
const OFFSETS = [...MAGNITUDES, ...MAGNITUDES.map(m => -m)];
/** The force's bonus: at 0.25 a tick the bonus bar moves 0.075, 0.975, 9.975 and 999.975 a tick */
const BONUSES = [0.3, 3.9, 39.9, 3999.9];
const TRIALS: Trial[] = [
    ...BONUSES.flatMap(x => [false, true].flatMap(main_item => OFFSETS.map(r => ({x, bar: "bonus" as const, r, main_item})))),
    ...OFFSETS.map(r => ({x: 0.7, bar: "main" as const, r, main_item: true})),
    ...[0, 1e-4, 5e-4, 9e-4].flatMap(r => [false, true].map(main_item => ({x: 0.002, bar: "tiny" as const, r, main_item}))),
];

interface RemainderCase {
    name: string;
    resource: "iron-ore" | "scrap" | "tungsten-ore";
    /** Legendary speed modules 3 in the drill: 4 move its mining bar 0.25 a tick, 1 0.094 */
    modules: number;
    drill_last?: boolean;
    position?: {x: number; y: number};
}

const CASES: RemainderCase[] = [
    {name: "remainder-iron", resource: "iron-ore", modules: 4},
    {name: "remainder-iron-drill-last", resource: "iron-ore", modules: 4, drill_last: true},
    {name: "remainder-iron-moved", resource: "iron-ore", modules: 4, position: {x: 203, y: -141}},
    {name: "remainder-iron-step", resource: "iron-ore", modules: 1},
    {name: "remainder-scrap", resource: "scrap", modules: 4},
    {name: "remainder-tungsten", resource: "tungsten-ore", modules: 4},
];

function blueprintOf(variant: RemainderCase): string {
    const drill = {name: "big-mining-drill", position: {x: 0.5, y: 0.5}, direction: 4, items: [{id: {name: "speed-module-3", quality: "legendary"},
        items: {in_inventory: Array.from({length: variant.modules}, (_, stack) => ({inventory: 2, stack}))}}]};
    const chest = {name: "steel-chest", quality: "legendary", position: {x: 3.5, y: 0.5}};
    // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the drill
    const idle = {name: "assembling-machine-1", position: {x: 0.5, y: 9.5}, recipe: "rail"};
    const entities = variant.drill_last ? [chest, idle, drill] : [drill, chest, idle];
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Drill remainder ${variant.name}`, version: 562949955649536,
        entities: entities.map((entity, index) => ({entity_number: index + 1, ...entity}))}} as unknown as FactorioBlueprintFile);
}

for (const variant of CASES) test(`drill bars near a whole item: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DRILLS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, variant.name) : fs.mkdtempSync(path.join(os.tmpdir(), "drills-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty DRILLS_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const blueprint = blueprintOf(variant);
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        await recordInFactorio({factorio: factorio!, save: save!, blueprint,
            lua: composeProbeSource(path.join(__dirname, "remainder-probe.lua"), {trials: TRIALS}),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"), drill_resource: variant.resource,
            ...(variant.position && {position: variant.position}),
            ticks: TRIALS.length + 3 * (BONUSES.length + 3) + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 300, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/remainder-probe.json"), "utf8"));
        const log = Object.values(report.log) as Row[];
        const {T, step} = report.info as {T: number; step: number};
        const checked = [];
        for (let k = 0; k + 2 < log.length; k++) {
            const row = log[k];
            if (row.trial === undefined) continue;
            const trial = TRIALS[row.trial - 1];
            const after = log[k + 1];
            // what the tick mined drops in the next tick, into the chest the probe has just emptied
            const items = log[k + 2].n - (trial.main_item ? 1 : 0);
            const label = `${trial.bar} at bonus ${trial.x}, r ${trial.r}${trial.main_item ? ", the mining bar's item too" : ""}`;
            if (trial.bar === "main") {
                const sum = row.wp! + step;
                expect(Math.abs(after.p - (sum >= T ? sum - T : sum)), `${label}: the mining bar has no tolerance`).toBeLessThan(1e-12);
                continue;
            }
            const simulated = bonusBarTick(row.wb!, row.inc!, T);
            checked.push({trial, wb: row.wb, inc: row.inc, game: {bar: after.b, items}, simulated});
            expect(simulated.items, `${label}: the bonus items`).toBe(items);
            expect(Math.abs(simulated.bar - after.b), `${label}: the bonus bar, ${simulated.bar} against ${after.b}`).toBeLessThan(1e-12);
        }
        expect(checked.length).toBe(TRIALS.filter(trial => trial.bar !== "main").length);
        fs.writeFileSync(path.join(scratch, "comparison.json"), JSON.stringify({info: report.info, checked}) + "\n");
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 360_000);
