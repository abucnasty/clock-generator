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
import { copyColumnsOf, differingColumns, laneWaits } from "./copies-replay";

/**
 * The game's copper stop on the nine copies of AUTOMATION_SCIENCE_240 with one output swing (issue #737, the P1 cut): the
 * copper feeders of the scaffold stop 11 tiles before copy 1's pickup, with the belt between them full, and start again
 * 1,466 ticks later. Per tick from the cut to the end of the recording (13,998), each copy's copper, gears, packs,
 * crafting and productivity bars, its taker's hand and its output hand, as the game's probe read them at the start of
 * the tick; and every tick and place a copper stack of the row waited with room ahead, from the game's lanes
 * (fixtures/automation-science-240-copper-stop-game.json.zst).
 */
interface GameStop {
    window_cycle_ticks: number;
    cut: number;
    restore: number;
    columns: string[];
    rows: number[][];
    copper_waits: { from: number; to: number; entry_x: number; waits: [tick: number, x: number][] };
}

const quiet: Logger = { log() { }, info() { }, warn() { }, error() { }, debug() { } } as unknown as Logger;
const COPPER = "copper-plate";

describe("the copper stop of the game on the nine copies of automation science 240 (#737)", () => {
    it("follows the game from the cut through the stop and the restart to the end, the copper waiting at the entrances as the game's", async () => {
        const game: GameStop = JSON.parse(zlib.zstdDecompressSync(
            fs.readFileSync(path.join(__dirname, "fixtures", "automation-science-240-copper-stop-game.json.zst"))).toString("utf8"));
        // the sample states its scaffold's feeders, the lanes' entries, and its underground entrances
        const loaded = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const config = { ...loaded, overrides: { ...loaded.overrides, terminal_swing_count: 1 } };
        // pitch_pickups 0f8a8504, the clock the game ran
        const windows = new Map([["inserter:1", [OpenRange.from(1, 24)]], ["inserter:2", [OpenRange.from(0, 3), OpenRange.from(36, 39)]]]);
        const [{ under, layouts }] = sharedLaneRunsOf(config).readings;
        let context: SimulationContext | undefined;
        const model = runOnSharedLanes(under, windows, game.window_cycle_ticks, layouts[0], 1, quiet, it => { context = it; });
        const ctx = context!;
        const tick = new SimulationTick(ctx);
        const [clock] = ctx.inserters.flatMap(inserter => { const asked: unknown = inserter.control.asked; return isWindowCycleClock(asked) ? [asked] : []; });
        const place = () => ((clock.clockTick() % game.window_cycle_ticks) + game.window_cycle_ticks) % game.window_cycle_ticks;
        const read = copyColumnsOf(ctx);
        const at = (row: number[], name: string) => row[game.columns.indexOf(name)];

        // the model runs free into its settled pattern, to the place of the game's cut: the model's place is the game's reading - 3
        const cut_place = (at(game.rows[0], "reading") - 3 + game.window_cycle_ticks) % game.window_cycle_ticks;
        for (let t = 0; t < 100 * game.window_cycle_ticks || place() !== cut_place; t++) tick.executeForTick();

        // the game's last copper stack at the cut stands 1/8 tile upstream of the first feeder's tile middle (x 387.375),
        // where that feeder put it down: the lane holds it when the stop closes the entry
        const copper = model.lanes[model.rows.findIndex(row => under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient === COPPER)];
        copper.advanceTo(ctx.tick_provider.getCurrentTick());
        const last_stack_at_cut = copper.stackPositions().at(-1);

        // the trial's supply stop of copper: the copper lane's entry closes after the read of the cut's tick, as the game's
        // feeders stop, and opens after the read of the restore's tick, as they start again
        const stop = switchOf(ctx, { kind: "supply", item: COPPER }, {
            lanes: model.rows.map((row, index) => ({ belt_entity_id: EntityId.forBelt(row.belt_id).id,
                item: under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient, lane: model.lanes[index] })),
        });
        const parted: string[] = [];
        // the copper lane where the game's probe reads it, at the start of each tick of the game's waits
        const copper_at = new Map<number, number[]>();
        game.rows.forEach(row => {
            const t = at(row, "t");
            for (const differ of differingColumns(read(), game.columns, row)) if (parted.length < 5) parted.push(`at ${t}: ${differ}`);
            if (t >= game.copper_waits.from && t <= game.copper_waits.to) {
                copper.advanceTo(ctx.tick_provider.getCurrentTick());
                copper_at.set(t, copper.stackPositions().map(([x]) => game.copper_waits.entry_x + x));
            }
            if (t === game.cut) stop.cut();
            if (t === game.restore) stop.restore();
            tick.executeForTick();
        });
        expect(parted).toEqual([]);
        expect(last_stack_at_cut).toEqual([-0.125, 4]);
        // every wait of the game's copper after the cut, at the underground entrances' ends, and none other
        expect(laneWaits(copper_at, 0.125)).toEqual(game.copper_waits.waits.filter(([t]) => t > game.cut));
        expect(game.copper_waits.waits).toHaveLength(55);
    });
});
