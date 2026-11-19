import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { Logger } from "../common/logger";
import { isWindowCycleClock } from "../simulation/controls/enable-control";
import { SimulationTick } from "./runner/simulation-tick";
import type { SimulationContext } from "./sequence/simulation-context";
import { switchOf } from "./disturbance-trial";
import { runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";
import { copyColumnsOf, differingColumns } from "./copies-replay";

/**
 * The stacks of a lane wait a tick at an underground entrance as in the game (#737): the nine copies of
 * AUTOMATION_SCIENCE_240 against two more of the game's recordings on its scaffold (Factorio 2.1.24, ruling 60's start),
 * each row the probe's read at the start of a tick, every copy's copper, gears, packs, bars and hands.
 */
const quiet: Logger = { log() { }, info() { }, warn() { }, error() { }, debug() { } } as unknown as Logger;
const COPPER = "copper-plate";

const fixture = <T>(name: string): T => JSON.parse(zlib.zstdDecompressSync(fs.readFileSync(path.join(__dirname, "fixtures", name))).toString("utf8"));

/** The window cycles of a copy's output hand, each the items its hand put down, from the rows of a run */
function itemsPerWindowCycle(columns: readonly string[], rows: readonly number[][], copy: number, from_row: number, period: number): number[] {
    const hand = rows.map(row => row[columns.indexOf(`out_${copy}`)]);
    const cycles: number[] = [];
    for (let start = from_row; start + period < hand.length; start += period) {
        let items = 0;
        for (let k = start + 1; k <= start + period; k++) items += Math.max(0, hand[k - 1] - hand[k]);
        cycles.push(items);
    }
    return cycles;
}

/** The window cycle from which a copy stays at the expected output to the end of the series */
const backFrom = (cycles: readonly number[], expected: number) => {
    let from = cycles.length;
    while (from > 0 && cycles[from - 1] === expected) from--;
    return from;
};

describe("the copper stops of Euclidean Swings on the nine copies of automation science 240, from the game's settled state", () => {
    /** Four cuts (verdict gaps 21): copper off after the 101st to 104th reading 21, for 2,016 ticks; each to 25,198 */
    interface Cuts { window_cycle_ticks: number; columns: string[]; cuts: { name: string; phase: number; cut: number; restore: number; rows: number[][] }[] }
    const game = fixture<Cuts>("automation-science-240-euclidean-swings-cuts-game.json.zst");

    it.each(game.cuts.map(cut => [cut.name, cut] as const))("follows the game through the stop and back, every copy, every tick (%s)", async (_, cut) => {
        const P = game.window_cycle_ticks;
        const loaded = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const config = { ...loaded, overrides: { ...loaded.overrides, terminal_swing_count: 1 } };
        // Euclidean Swings 64237bf3, the clock the game ran
        const windows = new Map([["inserter:1", [OpenRange.from(1, 20)]],
            ["inserter:2", [OpenRange.from(1, 12), OpenRange.from(37, 48), OpenRange.from(73, 73)]]]);
        const [{ under, layouts }] = sharedLaneRunsOf(config).readings;
        let context: SimulationContext | undefined;
        const model = runOnSharedLanes(under, windows, P, layouts[0], 1, quiet, it => { context = it; });
        const ctx = context!;
        const tick = new SimulationTick(ctx);
        const [clock] = ctx.inserters.flatMap(inserter => { const asked: unknown = inserter.control.asked; return isWindowCycleClock(asked) ? [asked] : []; });
        const place = () => ((clock.clockTick() % P) + P) % P;
        const read = copyColumnsOf(ctx);
        const at = (row: number[], name: string) => row[game.columns.indexOf(name)];

        // the model runs free to the cut's place, in the window cycle of its repeat of four whose state is the game's at the cut
        const cut_place = (at(cut.rows[0], "reading") - 3 + P) % P;
        for (let t = 0; t < (100 + cut.phase) * P || place() !== cut_place; t++) tick.executeForTick();
        const stop = switchOf(ctx, { kind: "supply", item: COPPER }, {
            lanes: model.rows.map((row, index) => ({ belt_entity_id: EntityId.forBelt(row.belt_id).id,
                item: under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient, lane: model.lanes[index] })),
        });
        const parted: string[] = [];
        const model_rows: number[][] = [];
        cut.rows.forEach(row => {
            const t = at(row, "t");
            const now = read();
            for (const differ of differingColumns(now, game.columns, row)) if (parted.length < 5) parted.push(`at ${t}: ${differ}`);
            model_rows.push(game.columns.map(name => name === "t" || name === "reading" ? at(row, name) : now.get(name)!));
            if (t === cut.cut) stop.cut();
            if (t === cut.restore) stop.restore();
            tick.executeForTick();
        });
        expect(parted).toEqual([]);
        // so each copy is back at 32 a window cycle from where the game's is: copy 2 from 53, 53, 72, 53 at the four cuts
        const restore_row = cut.restore - cut.cut;
        const back = (rows: number[][]) => Array.from({ length: 9 }, (_, copy) => backFrom(itemsPerWindowCycle(game.columns, rows, copy + 1, restore_row, P), 32));
        expect(back(model_rows)).toEqual(back(cut.rows));
        expect(back(cut.rows)[1]).toBe({ e101: 53, e102: 53, e103: 72, e104: 53 }[cut.name]);
    }, 120_000);
});

describe("the Time-Study Windows clock on the nine copies of automation science 240, as the copies' judge runs it", () => {
    /** b1490c9f2c49 (216 ticks), no stop: probe ticks 2,379 to 13,998, the model's 2,592 to 14,211 (`offset` 213) */
    interface Run { window_cycle_ticks: number; offset: number; columns: string[]; rows: number[][] }
    const game = fixture<Run>("automation-science-240-time-study-windows-game.json.zst");

    it("follows the game on every tick: copy 4 makes 96 and 80 packs in turn, as the game's", async () => {
        const P = game.window_cycle_ticks;
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const windows = new Map([["inserter:1", [OpenRange.from(0, 50), OpenRange.from(122, 149), OpenRange.from(159, 186), OpenRange.from(215, 215)]],
            ["inserter:2", [OpenRange.from(1, 37), OpenRange.from(109, 145)]]]);
        const [{ under, layouts }] = sharedLaneRunsOf(config).readings;
        let context: SimulationContext | undefined;
        runOnSharedLanes(under, windows, P, layouts[0], 1, quiet, it => { context = it; });
        const ctx = context!;
        const tick = new SimulationTick(ctx);
        const read = copyColumnsOf(ctx);
        const at = (row: number[], name: string) => row[game.columns.indexOf(name)];
        expect(ctx.tick_provider.getCurrentTick()).toBe(at(game.rows[0], "t") + game.offset);

        const parted: string[] = [];
        for (const row of game.rows) {
            for (const differ of differingColumns(read(), game.columns, row)) if (parted.length < 5) parted.push(`at ${at(row, "t")}: ${differ}`);
            tick.executeForTick();
        }
        expect(parted).toEqual([]);
        // the game's copy 4 is short every other window cycle for good, from the second window cycle here: 96 and 80 packs in turn
        const copy4 = itemsPerWindowCycle(game.columns, game.rows, 4, 0, P).slice(1);
        expect(copy4.length).toBeGreaterThan(50);
        expect(copy4.every((items, k) => items === (k % 2 === 0 ? 96 : 80))).toBe(true);
    }, 120_000);
});
