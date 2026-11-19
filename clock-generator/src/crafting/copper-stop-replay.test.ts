import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { automation240WithFeeders } from "../../tests/configs/automation-240-feeders";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { Logger } from "../common/logger";
import { isWindowCycleClock } from "../simulation/controls/enable-control";
import { SimulationTick } from "./runner/simulation-tick";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";
import { switchOf } from "./disturbance-trial";
import { runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";

/**
 * The game's copper stop on the nine copies of AUTOMATION_SCIENCE_240 with one output swing (issue #737, the P1 cut): the
 * copper feeders of the scaffold stop 11 tiles before copy 1's pickup, with the belt between them full, and start again
 * 1,466 ticks later. Per tick from the cut to the tick before the next parting (+2,830, copy 4's taker), each copy's
 * copper, gears, packs, crafting and productivity bars, its taker's hand and its output hand, as the game's probe read
 * them at the start of the tick (fixtures/automation-science-240-copper-stop-game.json.zst).
 */
interface GameStop {
    window_cycle_ticks: number;
    cut: number;
    restore: number;
    columns: string[];
    rows: number[][];
}

const quiet: Logger = { log() { }, info() { }, warn() { }, error() { }, debug() { } } as unknown as Logger;
const COPPER = "copper-plate", GEARS = "iron-gear-wheel", PACKS = "automation-science-pack";
const COPIES = 9;

/** Each copy's columns as the game's probe reads them, from the model's context */
function columnsOf(context: SimulationContext): () => Map<string, number> {
    const copyOf = (id: { number: number }) => Math.floor(id.number / COPY_NUMBER_STRIDE);
    const machines = context.machines.map(machine => machine.machine_state);
    const inserters = context.inserters.map(inserter => inserter.inserter_state);
    const of = <T extends { entity_id: { number: number } }>(list: T[], copy: number, config_id?: number) => list.find(state =>
        copyOf(state.entity_id) === copy && (config_id === undefined || state.entity_id.number % COPY_NUMBER_STRIDE === config_id))!;
    return () => {
        const read = new Map<string, number>();
        for (let copy = 0; copy < COPIES; copy++) {
            const n = copy + 1, machine = of(machines, copy);
            read.set(`cu_${n}`, machine.inventoryState.getQuantity(COPPER));
            read.set(`gear_${n}`, machine.inventoryState.getQuantity(GEARS));
            read.set(`pack_${n}`, machine.inventoryState.getQuantity(PACKS));
            read.set(`progress_${n}`, machine.craftingProgress.progress);
            read.set(`bonus_${n}`, machine.bonusProgress.progress);
            read.set(`taker_${n}`, of(inserters, copy, 1).held_item?.quantity ?? 0);
            read.set(`out_${n}`, of(inserters, copy, 2).held_item?.quantity ?? 0);
        }
        return read;
    };
}

describe("the copper stop of the game on the nine copies of automation science 240 (#737)", () => {
    it("follows the game from the cut through the stop and the restart while the feeders stand 11 tiles before copy 1", async () => {
        const game: GameStop = JSON.parse(zlib.zstdDecompressSync(
            fs.readFileSync(path.join(__dirname, "fixtures", "automation-science-240-copper-stop-game.json.zst"))).toString("utf8"));
        // the sample with its scaffold's feeders, the lanes' entries
        const loaded = await automation240WithFeeders();
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
        const read = columnsOf(ctx);
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
        game.rows.forEach(row => {
            const model_row = read();
            for (const [name, value] of model_row) {
                const same = name.startsWith("progress") || name.startsWith("bonus") ? Math.abs(value - at(row, name)) < 1e-3 : value === at(row, name);
                if (!same && parted.length < 5) parted.push(`${name} at ${at(row, "t")}: game ${at(row, name)}, model ${value}`);
            }
            if (at(row, "t") === game.cut) stop.cut();
            if (at(row, "t") === game.restore) stop.restore();
            tick.executeForTick();
        });
        expect(parted).toEqual([]);
        expect(last_stack_at_cut).toEqual([-0.125, 4]);
    });
});
