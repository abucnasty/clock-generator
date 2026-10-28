import {describe, expect, test} from "vitest";
import {ConfigSchema} from "../../../../src/config";
import {DrillStateMachine} from "../../../../src/control-logic/drill/drill-state-machine";
import {DrillStatus, factorioDrillState, MachineState} from "../../../../src/state";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EnableControl} from "../../../../src/control-logic/enable-control";
import {DRILL_RUNS} from "./cases";
import {loadRecording, rowsOf, statusChanges, statusName} from "./recording";

/**
 * The retained recordings of the drill status runs (drill-status.game.test.ts, probe.lua), read offline: the status the game
 * shows for a burner, an electric and a big mining drill that is disabled by a circuit condition or by script, whose chest
 * is full or fills up, or that has dropped as much as a machine takes from it; and the state the simulator records for a
 * drill today, which never leaves "working". See README.md.
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

/** A drill into a stone furnace's machine (rail) as the simulator builds it, with the windows of the circuit condition */
function simulatedDrill(windows: number[][], at: {tick: number}) {
    const config = ConfigSchema.parse({target_output: {recipe: "rail", items_per_second: 0.1, copies: 1}, belts: [], inserters: [],
        machines: [{id: 1, recipe: "rail", crafting_speed: 0.5, productivity: 0}],
        drills: {configs: [{id: 1, type: "big-mining-drill", mined_item_name: "stone", speed_bonus: 5, productivity: 0, target: {type: "machine", id: 1}}]}});
    const context = SimulationContext.fromConfig(config);
    const drill_state = context.drills[0].drill_state;
    const sink = context.state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id) as MachineState;
    const enable_control: EnableControl = {isEnabled: () => !inside(at.tick, windows)};
    return {drill: DrillStateMachine.create({drill_state, sink_state: sink, enable_control}), drill_state};
}

describe("the state the simulator records for a drill", () => {
    test("is working in every tick, also in the ticks its mode is disabled", () => {
        const at = {tick: 0};
        const {drill, drill_state} = simulatedDrill(WINDOWS, at);
        const modes = new Set<string>(), states = new Set<string>();
        for (at.tick = 1; at.tick <= 600; at.tick++) {
            drill.executeForTick();
            modes.add(drill.current_mode.status);
            states.add(factorioDrillState(drill_state));
        }
        // the machine's own disabled mode was entered, and DrillState.status stayed at its default
        expect(modes).toEqual(new Set([DrillStatus.WORKING, DrillStatus.DISABLED]));
        expect(drill_state.status).toBe(DrillStatus.WORKING);
        expect(states).toEqual(new Set(["working"]));
    });

    test("is working when the drill holds what the machine will not take, where the game shows waiting_for_space_in_destination", () => {
        const at = {tick: 0};
        const {drill, drill_state} = simulatedDrill([], at);
        // a big drill with +500% mines about 1.5 stone a tick: it passes the machine's stop within a few hundred ticks
        for (at.tick = 1; at.tick <= 600; at.tick++) drill.executeForTick();
        expect(drill_state.inventoryState.getQuantity("stone")).toBeGreaterThan(0);
        expect(factorioDrillState(drill_state)).toBe("working");
    });
});
