import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { Logger } from "../common/logger";
import { SimulationTick } from "./runner/simulation-tick";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";
import { runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";
import type { SharedLane } from "../state/shared-lane";

/**
 * The game's opening of the nine copies of AUTOMATION_SCIENCE_240 with one output swing, from the tick the clock starts
 * to the copper stop's cut (#737; fixtures/automation-science-240-opening-game.json.zst): per tick, each copy's taker hand,
 * the two copper feeders' hands (upstream first), and the copper lane from the feeders' tiles to copy 3's pickup, in
 * eighths of a tile from x `x0`, the first feeder's tile middle at 4.
 */
interface GameOpening {
    x0: number;
    columns: string[];
    rows: (number | string)[][];
}

const quiet: Logger = { log() { }, info() { }, warn() { }, error() { }, debug() { } } as unknown as Logger;
const COPPER = "copper-plate";
const COPIES = 9;
/** The model's tick of the probe's first row: its clock starts at 72 and every taker first picks up at 75, the game's 6 */
const OFFSET = 69;
/** The first feeder's tile middle, which is the lane's entry, in eighths of a tile from the fixture's x0 */
const ENTRY_EIGHTHS = 4;
/** The lane the fixture holds: to copy 3's pickup tile's end, in eighths from x0 */
const LAST_EIGHTHS = 244;

describe("the feeders' entry onto the copper lane of automation science 240 (#737)", () => {
    it("puts the game's stacks on the lane where and when the game's feeders do, from the opening to the copper stop", async () => {
        const game: GameOpening = JSON.parse(zlib.zstdDecompressSync(
            fs.readFileSync(path.join(__dirname, "fixtures", "automation-science-240-opening-game.json.zst"))).toString("utf8"));
        // the sample states its scaffold's feeders, the lanes' entries
        const loaded = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const config = { ...loaded, overrides: { ...loaded.overrides, terminal_swing_count: 1 } };
        // pitch_pickups 0f8a8504, the clock the game ran
        const windows = new Map([["inserter:1", [OpenRange.from(1, 24)]], ["inserter:2", [OpenRange.from(0, 3), OpenRange.from(36, 39)]]]);
        const [{ under, layouts }] = sharedLaneRunsOf(config).readings;
        const copper_row = layouts[0].rows.findIndex(row => under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient === COPPER);
        const at = (name: string) => game.columns.indexOf(name);
        const by_tick = new Map(game.rows.map(row => [(row[0] as number) + OFFSET, row]));
        const last_tick = (game.rows[game.rows.length - 1][0] as number) + OFFSET;

        // the first tick each of the lane, the feeders' hands and the takers' hands parts from the game's
        const parted = new Map<string, string>();
        let compared = 0;
        // what the model holds after the inserters of a tick, against the game's row of that tick
        const observe = (context: SimulationContext, lane: SharedLane) => {
            const copyOf = (id: { number: number }) => Math.floor(id.number / COPY_NUMBER_STRIDE);
            const takers = Array.from({ length: COPIES }, (_, copy) =>
                context.inserters.find(it => copyOf(it.entity_id) === copy && it.entity_id.number % COPY_NUMBER_STRIDE === 1)!.inserter_state);
            return () => {
                const tick = context.tick_provider.getCurrentTick();
                const row = by_tick.get(tick);
                if (row === undefined) return;
                lane.advanceTo(tick);
                compared++;
                const probe = row[0];
                const model_lane = lane.stackPositions().map(([tiles, count]) => [Math.round(tiles * 8) + ENTRY_EIGHTHS, count] as const)
                    .filter(([eighths]) => eighths >= 0 && eighths <= LAST_EIGHTHS).reverse()
                    .map(([eighths, count]) => count === 4 ? `${eighths}` : `${eighths}x${count}`).join(" ");
                const checks: [string, unknown, unknown][] = [
                    ["lane", row[at("lane")], model_lane],
                    ["feeders", [row[at("feeder_1")], row[at("feeder_2")]], lane.feederHands()],
                    ["takers", Array.from({ length: COPIES }, (_, copy) => row[at(`taker_${copy + 1}`)]), takers.map(taker => taker.held_item?.quantity ?? 0)],
                ];
                for (const [name, in_game, in_model] of checks) {
                    if (!parted.has(name) && JSON.stringify(in_game) !== JSON.stringify(in_model)) {
                        parted.set(name, `${name} at probe tick ${probe}: game ${JSON.stringify(in_game)}, model ${JSON.stringify(in_model)}`);
                    }
                }
            };
        };
        let context: SimulationContext | undefined;
        runOnSharedLanes(under, windows, 72, layouts[0], 1, quiet, (ctx, model) => {
            context = ctx;
            const read = observe(ctx, model.lanes[copper_row]);
            ctx.after_inserters.push({ tick: read });
        });
        // the run returns after its own window cycles: tick on to the cut
        const tick = new SimulationTick(context!);
        while (context!.tick_provider.getCurrentTick() < last_tick) tick.executeForTick();

        expect(compared).toBe(game.rows.length);
        expect([...parted.values()]).toEqual([]);
    });
});
