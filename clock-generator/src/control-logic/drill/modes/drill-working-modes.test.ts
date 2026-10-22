import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../../config";
import { SimulationContext } from "../../../crafting/sequence/simulation-context";
import { MiningDrill, miningDrillMaxInsertion } from "../../../entities";
import { EntityState, MachineState } from "../../../state";
import { EnableControl } from "../../enable-control";
import { DrillStateMachine } from "../drill-state-machine";
import { DrillChestWorkingMode } from "./chest-working-mode";
import { MiningProgress } from "./mining-progress";
import { DrillWorkingMode } from "./working-mode";

/**
 * A drill's progress model against the game, its cases from recordings in Factorio 2.1.21 of a big mining drill (4
 * legendary speed modules 3: its bar moves 0.25 a tick; 3: 0.198) at research set by script. The sink's takes come from
 * the recording and act before the drill in a tick, as in the game; every other number is the game's.
 */

const idle = { target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }], belts: [], inserters: [] };

/** A drill on iron ore into a car whose first `filtered` slots are filtered to copper plates */
/** `productivity` is the drill's, in percent */
function carBuild(productivity: number, speed_bonus: number, filtered: number) {
    const config = ConfigSchema.parse({ ...idle,
        drills: { configs: [{ id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus, productivity, target: { type: "chest", id: 1 } }] },
        chests: [{ type: "car", id: 1, slot_filters: Array.from({ length: filtered }, (_, index) => ({ slot: index + 1, item: "copper-plate" })) }] });
    const context = SimulationContext.fromConfig(config);
    const drill = context.drills[0];
    const car = context.state_registry.getStateByEntityIdOrThrow(drill.drill_state.drill.sink_id);
    if (!EntityState.isChest(car)) throw new Error("no car");
    const mode = drill.current_mode;
    if (!(mode instanceof DrillChestWorkingMode)) throw new Error("not a drill into a chest");
    return { drill, car, progress: mode.progress, held: () => drill.drill_state.inventoryState.getQuantity("iron-ore") };
}

/** A drill on stone into an assembling machine on rail (which never crafts here: nothing else feeds it) */
function machineBuild(productivity: number, enable_control?: EnableControl) {
    const config = ConfigSchema.parse({ target_output: { recipe: "rail", items_per_second: 0.1, copies: 1 }, belts: [], inserters: [],
        machines: [{ id: 1, recipe: "rail", crafting_speed: 0.5, productivity: 0 }],
        drills: { configs: [{ id: 1, type: "big-mining-drill", mined_item_name: "stone", speed_bonus: 5, productivity, target: { type: "machine", id: 1 } }] } });
    const context = SimulationContext.fromConfig(config);
    const drill_state = context.drills[0].drill_state;
    const machine = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id) as MachineState;
    const drill = enable_control ? DrillStateMachine.create({ drill_state, sink_state: machine, enable_control }) : context.drills[0];
    const mode = Array.from(drill.modes).find(it => it instanceof DrillWorkingMode);
    if (!mode) throw new Error("not a drill into a machine");
    return { drill, machine, progress: mode.progress, stop: miningDrillMaxInsertion(drill_state.drill, machine.machine),
        count: () => machine.inventoryState.getItemOrThrow("stone").quantity, held: () => drill_state.inventoryState.getQuantity("stone") };
}

describe("a drill's progress bars", () => {
    it("move by the drill's crafting rate a tick and by that times its productivity; a wrap is an item", () => {
        // the recording's research: mining productivity 3 at level 8, 7 levels, +70%
        const drill = carBuild(70, 5, 78).drill.drill_state.drill;
        const progress = new MiningProgress(drill);
        const items = Array.from({ length: 8 }, () => progress.mine());
        // bars of 0.25 and 0.175 a tick: the mining bar wraps at the 4th and 8th tick, the bonus bar at the 6th
        expect(items).toEqual([0, 0, 0, 1, 0, 1, 0, 1]);
        expect(progress.mining_progress).toBe(0);
        expect(progress.bonus_progress).toBeCloseTo(0.4, 12);
    });

    it("are doubles summed tick by tick: a step of 0.198 wraps at the 97th tick, as in the game, not at the 96th", () => {
        // 3 speed modules: 2.5 x 4.75 / 60 a tick, 19 items in exactly 96 ticks; the game's bar reads 0.9999999999999986
        // after its 96th tick and wraps in its 97th (car-l8-3m)
        const drill = MiningDrill.fromConfig(
            { id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 3.75, productivity: 0, target: { type: "chest", id: 1 } });
        const progress = new MiningProgress(drill);
        let mined = 0;
        for (let tick = 1; tick <= 96; tick++) mined += progress.mine();
        expect(mined).toBe(18);
        expect(progress.mining_progress).toBeCloseTo(0.9999999999999986, 15);
        expect(progress.mining_progress).toBeLessThan(1);
        expect(progress.mine()).toBe(1);
        expect(progress.mining_progress).toBeCloseTo(0.1979166666666654, 12);
    });
});

describe("a drill into a chest", () => {
    // car-l8: 0.425 a tick into a car with 100 ore of room, a yellow inserter taking 2, then 4 a swing
    const takes = new Map([[8, 2], [78, 4], [148, 4], [218, 4], [288, 4]]);
    const counts_to_44 = [0, 0, 0, 0, 0, 1, 1, 2, 0, 1, 1, 1, 1, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 6, 7, 8, 8, 8, 8, 9, 10, 10, 10, 11,
        11, 11, 12, 13, 13, 13, 13, 15, 15, 15, 15];
    const bonus_to_44 = [0, 0.175, 0.35, 0.525, 0.7, 0.875, 0.05, 0.225, 0.4, 0.575, 0.75, 0.925, 0.1, 0.275, 0.45, 0.625, 0.8,
        0.975, 0.15, 0.325, 0.5, 0.675, 0.85, 0.025, 0.2, 0.375, 0.55, 0.725, 0.9, 0.075, 0.25, 0.425, 0.6, 0.775, 0.95, 0.125, 0.3,
        0.475, 0.65, 0.825, 0, 0.175, 0.35, 0.525, 0.7];
    // the car full from tick 270: the drill mines on until its bar wraps (272), then holds that item and waits, its bars
    // still, until the inserter takes 4 (288): it drops the item in that tick and mines again
    const counts_262_to_291 = [96, 96, 97, 98, 98, 98, 98, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
        100, 100, 100, 100, 97, 97, 97, 98];
    const mining_262_to_291 = [0.5, 0.75, 0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0.25, 0.5, 0.75, 0];
    const bonus_262_to_291 = [0.85, 0.025, 0.2, 0.375, 0.55, 0.725, 0.9, 0.075, 0.25, 0.425, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6,
        0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.775, 0.95, 0.125, 0.3];

    it("drops what it mined a tick later, and waits while it holds what the car has no room for (car-l8)", () => {
        const { drill, car, progress, held } = carBuild(70, 5, 78);
        for (let tick = 1; tick <= 291; tick++) {
            const taken = takes.get(tick);
            if (taken) car.inventoryState.removeQuantity("iron-ore", taken);
            drill.executeForTick();
            if (tick <= 44) {
                expect(car.getCurrentQuantity("iron-ore"), `count at ${tick}`).toBe(counts_to_44[tick]);
                expect(progress.mining_progress, `mining bar at ${tick}`).toBe([0, 0.25, 0.5, 0.75][tick % 4]);
                expect(progress.bonus_progress, `bonus bar at ${tick}`).toBeCloseTo(bonus_to_44[tick], 9);
            }
            if (tick >= 262) {
                expect(car.getCurrentQuantity("iron-ore"), `count at ${tick}`).toBe(counts_262_to_291[tick - 262]);
                expect(progress.mining_progress, `mining bar at ${tick}`).toBe(mining_262_to_291[tick - 262]);
                expect(progress.bonus_progress, `bonus bar at ${tick}`).toBeCloseTo(bonus_262_to_291[tick - 262], 9);
            }
            if (tick >= 272 && tick < 288) expect(held(), `held at ${tick}`).toBe(1);
        }
    });

    it("puts in what it held when a full car gets room, and what it mines that tick in the next (5, then 11)", () => {
        // drill-into-filtered-car at the harness's research (7,999 levels, +79,990%: 200.2 ore a tick) into a car with 3,750 ore of
        // room, a stack inserter taking 16 every 8 ticks from tick 3
        const totals = [0, 0, 199, 383, 583, 784, 984, 1184, 1384, 1585, 1785, 1969, 2169, 2370, 2570, 2770, 2970, 3171, 3371, 3555,
            3750, 3750, 3750, 3750, 3750, 3750, 3750, 3739, 3750, 3750, 3750, 3750, 3750, 3750];
        const mining = [0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0.75,
            0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0, 0, 0, 0, 0, 0, 0];
        const { drill, car, progress, held } = carBuild(79990, 5, 5);
        for (let tick = 1; tick < totals.length; tick++) {
            if ((tick - 3) % 8 === 0) car.inventoryState.removeQuantity("iron-ore", 16);
            drill.executeForTick();
            expect(car.getCurrentQuantity("iron-ore"), `total at ${tick}`).toBe(totals[tick]);
            expect(progress.mining_progress, `mining bar at ${tick}`).toBe(mining[tick]);
            // tick 27: 5 dropped, then 201 mined (the bar wraps); tick 28: 11 dropped, 190 held
            if (tick === 27) expect(held()).toBe(201);
            if (tick === 28) expect(held()).toBe(190);
        }
    });
});

describe("a drill into a machine", () => {
    it("drops up to its stop, keeps the rest and waits; at the stop it mines on until it holds an item", () => {
        // +79,990% (7,999 levels): 199 ore in the first tick, more than the stop
        const { drill, machine, progress, stop, count, held } = machineBuild(79990);
        // the game's stop on rail (stack 50, limit 3): 50 + 64 (rail-l28, rail-l45, rail-l8-gated of the drills family)
        expect(stop).toBe(114);
        drill.executeForTick();
        expect([count(), held()]).toEqual([0, 199]);
        drill.executeForTick();
        expect([count(), held()]).toEqual([stop, 199 - stop]);
        const bars = [progress.mining_progress, progress.bonus_progress];
        drill.executeForTick();
        expect([count(), held(), progress.mining_progress, progress.bonus_progress]).toEqual([stop, 199 - stop, ...bars]);
        // a craft takes what the drill holds and one more: the drill drops all it holds and mines in the same tick
        machine.inventoryState.removeQuantity("stone", 199 - stop + 1);
        drill.executeForTick();
        expect(count()).toBe(stop - 1);
        expect(held()).toBeGreaterThan(0);
        expect(progress.mining_progress).not.toBe(bars[0]);
        // 1.35 a tick (+440%, 44 levels): the machine at its stop takes nothing, yet the drill mines until it holds an item
        const slow = machineBuild(440);
        slow.machine.inventoryState.addQuantity("stone", slow.stop);
        slow.drill.executeForTick();
        expect([slow.count(), slow.held(), slow.progress.mining_progress]).toEqual([slow.stop, 1, 0.25]);
        slow.drill.executeForTick();
        expect([slow.count(), slow.held(), slow.progress.mining_progress]).toEqual([slow.stop, 1, 0.25]);
    });

    it("disabled, neither drops nor mines, and keeps what it holds and both bars", () => {
        let enabled = true;
        const { drill, progress, count, held } = machineBuild(440, { isEnabled: () => enabled });
        drill.executeForTick();
        drill.executeForTick();
        const [mining, bonus, holding, dropped] = [progress.mining_progress, progress.bonus_progress, held(), count()];
        expect(holding).toBeGreaterThan(0);
        enabled = false;
        for (let tick = 0; tick < 5; tick++) drill.executeForTick();
        expect([progress.mining_progress, progress.bonus_progress, held(), count()]).toEqual([mining, bonus, holding, dropped]);
        enabled = true;
        drill.executeForTick();
        expect(count()).toBe(dropped + holding);
        expect(progress.mining_progress).toBe(mining + 0.25);
    });
});
