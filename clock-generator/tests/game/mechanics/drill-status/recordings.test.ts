import {describe, expect, test} from "vitest";
import {ConfigSchema} from "../../../../src/config";
import {MiningDrillArchetype} from "../../../../src/simulation/archetypes/mining-drill";
import {DrillStateTracker} from "../../../../src/simulation/observers/factorio-state-tracker";
import {MutableTickProvider} from "../../../../src/simulation/current-tick-provider";
import {ContainerStorage} from "../../../../src/simulation/components/container-storage";
import {DrillStatus, MachineState} from "../../../../src/state";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EnableControl} from "../../../../src/simulation/controls/enable-control";
import {DRILL_RUNS} from "./cases";
import {DrillRow, loadRecording, rowsOf, statusChanges, statusName} from "./recording";

/**
 * The retained recordings of the drill status runs (drill-status.game.test.ts, probe.lua), read offline: the status the game
 * shows for a burner, an electric and a big mining drill that is disabled by a circuit condition or by script, whose chest
 * is full or fills up, or that has dropped as much as a machine takes from it; and the state the simulator records for a
 * drill, tick by tick, in the same situations. See README.md.
 */
const stops = loadRecording("stops");
const machine = loadRecording("machine");
const stopsRun = DRILL_RUNS.find(run => run.name === "stops")!;
const DRILLS = ["burner", "electric", "big"] as const;
const WINDOWS = [[100, 300], [320, 500]];
/** The ticks a circuit condition takes to show: the combinator's output is read by the drill two ticks later, both ways */
const CIRCUIT_DELAY = 2;

const inside = (t: number, windows: number[][], delay = 0) => windows.some(([from, to]) => t >= from + delay && t < to + delay);

describe("the game's status of a drill", () => {
    test("the circuit condition was wired to every drill", () => {
        for (const name of DRILLS.map(drill => `${drill}-circuit`)) {
            expect(stops.info.scenarios.find(scenario => scenario.name === name)!.wired, name).toBe(true);
        }
    });

    describe.each(DRILLS)("%s mining drill", drill => {
        test("switched off by a circuit condition it shows disabled_by_control_behavior, two ticks after the condition and for as long", () => {
            const rows = rowsOf(stops, `${drill}-circuit`);
            for (const row of rows.filter(it => it.t >= 5)) {
                const disabled = statusName(stops, row) === "disabled_by_control_behavior";
                expect(disabled, `tick ${row.t}`).toBe(inside(row.t, WINDOWS, CIRCUIT_DELAY));
            }
        });

        test("disabled by script it shows disabled_by_script in exactly the ticks it is off", () => {
            for (const row of rowsOf(stops, `${drill}-script`).filter(it => it.t >= 5)) {
                expect(statusName(stops, row) === "disabled_by_script", `tick ${row.t}`).toBe(inside(row.t, WINDOWS));
            }
        });

        test("it never shows a disabled status while enabled, and no other status than working and waiting for space", () => {
            for (const mode of ["circuit", "script", "chest-full", "chest-room"]) {
                const names = new Set(rowsOf(stops, `${drill}-${mode}`).filter(row => row.t >= 5).map(row => statusName(stops, row)));
                const allowed = new Set(["working", "waiting_for_space_in_destination",
                    mode === "circuit" ? "disabled_by_control_behavior" : "disabled_by_script"]);
                for (const name of names) expect(allowed.has(name), `${drill}-${mode}: ${name}`).toBe(true);
            }
        });

        test("with a full chest it shows waiting_for_space_in_destination from the next ore it completes until room is made", () => {
            const rows = rowsOf(stops, `${drill}-chest-full`);
            // the chest is filled at tick 300 and 100 ore are taken at tick 800
            const blocked = rows.filter(row => statusName(stops, row) === "waiting_for_space_in_destination" && row.t > 300);
            const first = blocked[0].t, last = blocked[blocked.length - 1].t;
            // from the first tick it waits to tick 800 (when the take makes room) it waits in every tick; after it, it drops and works
            for (const row of rows.filter(it => it.t >= first && it.t < 800)) expect(statusName(stops, row), `tick ${row.t}`).toBe("waiting_for_space_in_destination");
            expect(last).toBe(799);
            expect(statusName(stops, rows[800])).toBe("working");
        });

        test("with room for two ore it waits for one tick at each drop and then stays blocked at the third ore", () => {
            const rows = rowsOf(stops, `${drill}-chest-room`).filter(row => row.t >= 5);
            const waiting = rows.filter(row => statusName(stops, row) === "waiting_for_space_in_destination");
            // the ore the drill holds for a tick before it drops it, then the ore that fills the chest and stays
            const runs = waiting.reduce<number[][]>((spans, row) => {
                const last = spans[spans.length - 1];
                if (last && last[1] === row.t - 1) last[1] = row.t; else spans.push([row.t, row.t]);
                return spans;
            }, []);
            expect(runs.length).toBe(2);
            expect(runs[0][1] - runs[0][0]).toBe(0);
            expect(runs[1][1]).toBe(rows[rows.length - 1].t);
            // the chest was full of ore when it stayed blocked
            expect(rows[rows.length - 1].out).toBe(48 * 50);
        });
    });

    test("a drop into a chest with room is shown as one tick of waiting for space, in the tick the drill holds the ore it mined", () => {
        const rows = rowsOf(stops, "electric-chest-full");
        const pulses = rows.filter(row => row.t < 300 && statusName(stops, row) === "waiting_for_space_in_destination");
        expect(pulses.length).toBeGreaterThan(0);
        for (const pulse of pulses) {
            // the ore is in the chest in the next tick
            expect(rows[pulse.t + 1].out - rows[pulse.t].out).toBe(1);
            expect(statusName(stops, rows[pulse.t + 1])).toBe("working");
        }
    });

    test("into a furnace that cannot craft a big drill stops at 114 ore (50 + 64) and shows waiting for space from then on", () => {
        const rows = rowsOf(machine, "big-machine");
        const waiting = rows.filter(row => statusName(machine, row) === "waiting_for_space_in_destination" && row.out >= 100);
        expect(waiting[0].out).toBe(114);
        for (const row of rows.filter(it => it.t >= waiting[0].t)) {
            expect(row.out).toBe(114);
            expect(statusName(machine, row)).toBe("waiting_for_space_in_destination");
        }
        expect(statusChanges(machine, "big-machine").map(change => change.status).slice(-2)).toEqual(["working", "waiting_for_space_in_destination"]);
    });

    test("every scenario ran the planned ticks", () => {
        for (const scenario of stopsRun.scenarios) expect(stops.runs[scenario.name].length).toBe(stopsRun.ticks + 1);
    });
});

/** The ore a steel chest holds: 48 slots of 50 */
const CHEST_ORE = 48 * 50;

/** A drill on iron ore into a steel chest as the simulator builds it; `room` is the ore the chest has room for at the start */
function simulatedChestDrill(entity: string, room: number | null, at: {tick: number}, enabled: (tick: number) => boolean) {
    const config = ConfigSchema.parse({target_output: {recipe: "iron-plate", items_per_second: 1, copies: 1}, belts: [], inserters: [],
        machines: [{id: 1, recipe: "iron-plate", crafting_speed: 1, productivity: 0, type: "furnace"}],
        drills: {configs: [{id: 1, type: entity, mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0, target: {type: "chest", id: 1}}]},
        chests: [{id: 1, type: "buffer-chest", storage_size: 48, item_filter: "iron-ore"}]});
    const context = SimulationContext.fromConfig(config);
    const drill_state = context.drills[0].drill_state;
    const chest = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id) as ContainerStorage;
    if (room !== null) chest.inventoryState.addQuantity("iron-ore", CHEST_ORE - room);
    const enable_control: EnableControl = {isEnabled: () => enabled(at.tick)};
    const drill = MiningDrillArchetype.create({drill_state, sink_state: chest, enable_control});
    return {drill, drill_state, chest};
}

/** The state of each tick 1 to `ticks` from the changes recorded: a tick the tracker has not recorded yet (the last) repeats the one before */
function statesOf(changes: {tick: number; state: string}[], ticks: number): string[] {
    const states: string[] = [];
    let next = 0, shown = "";
    for (let tick = 1; tick <= ticks; tick++) {
        while (next < changes.length && changes[next].tick <= tick) shown = changes[next++].state;
        states.push(shown);
    }
    return states;
}

interface Simulated {
    /** The state recorded for each tick of the run, from the changes the tracker recorded */
    states: string[];
    progress: number[];
    out: number[];
}

/**
 * Runs the drill for `ticks` ticks. The probe's rows start with the drill's first update at row 1 and a bar that has not
 * moved: simulated tick j is row j + 1. Between two ticks `between` may act, as the probe does after a tick's updates.
 */
function simulate(entity: string, room: number | null, ticks: number, enabled: (tick: number) => boolean, between: (tick: number, chest: ContainerStorage) => void = () => {}): Simulated {
    const at = {tick: 0};
    const {drill, drill_state, chest} = simulatedChestDrill(entity, room, at, enabled);
    const clock = MutableTickProvider.create(0);
    const changes: {tick: number; state: string}[] = [];
    drill.observers.add(new DrillStateTracker(clock, drill_state, {recordFactorioState: (tick, state) => changes.push({tick, state})}));
    const progress: number[] = [], out: number[] = [];
    for (at.tick = 1; at.tick <= ticks; at.tick++) {
        between(at.tick, chest);
        // the probe reads the chest after what it does between two ticks, which the tick before has not seen
        if (at.tick > 1) out.push(chest.getCurrentQuantity("iron-ore"));
        clock.setCurrentTick(at.tick);
        drill.executeForTick();
        progress.push(drill.mining.mining_progress);
    }
    out.push(chest.getCurrentQuantity("iron-ore"));
    const states = statesOf(changes, ticks);
    return {states, progress, out};
}

/**
 * The row before the drill's first drop of the run: the game shows waiting_for_space_in_destination there with room in the
 * chest, once, and at no later drop. The simulator has no such state, so the row is left out of the comparison.
 */
const firstDropPulse = (rows: {out: number}[]) => rows.findIndex((row, index) => index > 0 && row.out > rows[index - 1].out) - 1;

/**
 * The big drill's blocked span starts one row after the item it cannot drop is mined in the game, the burner and the
 * electric drill's in the same row: the row before it, where the game shows working, is left out of the comparison for it.
 */
const lateBlock = (drill: string, rows: {t: number}[], row: {t: number}, rowStatus: (row: {t: number}) => string) =>
    drill === "big" && rowStatus(row) === "working" && rowStatus(rows[row.t + 1]) === "waiting_for_space_in_destination";

const TYPE = {burner: "burner-mining-drill", electric: "electric-mining-drill", big: "big-mining-drill"};
/** The ticks compared: from the probe's row 5 (the first rows show no_power and the network's first tick), without the run's last two */
const FIRST = 4;

describe.each(DRILLS)("the state the simulator records for a %s mining drill", drill => {
    test("switched off by a circuit condition it is disabled_by_control_behavior in the game's ticks, and mines as the bar of the game does", () => {
        // the circuit's delay is the control's: the drill mines until two ticks after the probe's window starts, as the bar
        // shows, and the network's first tick leaves it off
        const rows = rowsOf(stops, `${drill}-circuit`);
        const run = simulate(TYPE[drill], null, 600, tick => tick >= 2 && !inside(tick - 2, WINDOWS));
        for (let tick = FIRST; tick <= 598; tick++) {
            const row = rows[tick + 1];
            expect(run.states[tick - 1] === "disabled_by_control_behavior", `tick ${tick}`).toBe(statusName(stops, row) === "disabled_by_control_behavior");
            expect(run.progress[tick - 1], `bar at tick ${tick}`).toBeCloseTo(row.progress, 5);
        }
    });

    test("a drill disabled in the same ticks shows the state the game shows for a circuit, where the game's script shows disabled_by_script", () => {
        const rows = rowsOf(stops, `${drill}-script`);
        const run = simulate(TYPE[drill], null, 600, tick => !inside(tick, WINDOWS));
        for (let tick = FIRST; tick <= 598; tick++) {
            const row = rows[tick + 1];
            expect(run.states[tick - 1] === "disabled_by_control_behavior", `tick ${tick}`).toBe(statusName(stops, row) === "disabled_by_script");
            expect(run.progress[tick - 1], `bar at tick ${tick}`).toBeCloseTo(row.progress, 5);
        }
    });

    test("with room for two ore it shows waiting_for_space_in_destination from the third ore, which it holds without room to drop it", () => {
        const rows = rowsOf(stops, `${drill}-chest-room`);
        const ticks = 1500;
        const run = simulate(TYPE[drill], 2, ticks, () => true);
        const pulse = firstDropPulse(rows);
        for (let tick = FIRST; tick <= ticks - 2; tick++) {
            const row = rows[tick + 1];
            if (row.t !== pulse && !lateBlock(drill, rows, row, it => statusName(stops, it as DrillRow))) expect(run.states[tick - 1], `tick ${tick}`).toBe(statusName(stops, row));
            expect(run.out[tick - 1], `ore at tick ${tick}`).toBe(row.out);
        }
        expect(new Set(run.states)).toEqual(new Set(["working", "waiting_for_space_in_destination"]));
    });

    test("into a chest that is filled and emptied of 100 ore it shows waiting from the ore it cannot drop until room is made", () => {
        const rows = rowsOf(stops, `${drill}-chest-full`);
        const ticks = 1500;
        // the probe fills the chest after row 300 and takes 100 ore after row 800: before the simulated ticks 300 and 800
        const run = simulate(TYPE[drill], null, ticks, () => true, (tick, chest) => {
            if (tick === 300) chest.inventoryState.addQuantity("iron-ore", CHEST_ORE - chest.getCurrentQuantity("iron-ore"));
            if (tick === 800) chest.inventoryState.removeQuantity("iron-ore", 100);
        });
        const pulse = firstDropPulse(rows);
        for (let tick = FIRST; tick <= ticks - 2; tick++) {
            const row = rows[tick + 1];
            // row 800 is read after the probe's take, so the game shows working for the tick the drill still holds the ore it can now drop
            if (row.t === pulse || row.t === 800 || lateBlock(drill, rows, row, it => statusName(stops, it as DrillRow))) continue;
            expect(run.states[tick - 1], `tick ${tick}`).toBe(statusName(stops, row));
            expect(run.out[tick - 1], `ore at tick ${tick}`).toBe(row.out);
        }
    });
});

test("into a furnace that cannot craft a big drill stops at 114 ore and shows waiting for space from then on, tick by tick as the game does", () => {
    const config = ConfigSchema.parse({target_output: {recipe: "iron-plate", items_per_second: 1, copies: 1}, belts: [], inserters: [],
        machines: [{id: 1, recipe: "iron-plate", crafting_speed: 1, productivity: 0, type: "furnace"}],
        drills: {configs: [{id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0, target: {type: "machine", id: 1}}]}});
    const context = SimulationContext.fromConfig(config);
    const drill = context.drills[0];
    const sink = context.state_registry.getStateByEntityIdOrThrow(drill.drill_state.drill.sink_id) as MachineState;
    const clock = MutableTickProvider.create(0);
    const changes: {tick: number; state: string}[] = [];
    drill.observers.add(new DrillStateTracker(clock, drill.drill_state, {recordFactorioState: (tick, state) => changes.push({tick, state})}));
    const rows = rowsOf(machine, "big-machine");
    const ticks = 3000;
    const ore: number[] = [];
    for (let tick = 1; tick <= ticks; tick++) {
        clock.setCurrentTick(tick);
        drill.executeForTick();
        ore.push(sink.inventoryState.getItemOrThrow("iron-ore").quantity);
    }
    const states = statesOf(changes, ticks);
    const pulse = firstDropPulse(rows);
    for (let tick = FIRST; tick <= ticks - 2; tick++) {
        const row = rows[tick + 1];
        expect(ore[tick - 1], `ore at tick ${tick}`).toBe(row.out);
        if (row.t === pulse || lateBlock("big", rows, row, it => statusName(machine, it as DrillRow))) continue;
        expect(states[tick - 1], `tick ${tick}`).toBe(statusName(machine, row));
    }
    expect(sink.inventoryState.getItemOrThrow("iron-ore").quantity).toBe(114);
    expect(drill.drill_state.status).toBe(DrillStatus.WORKING);
});
