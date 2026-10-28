import {describe, expect, test} from "vitest";
import {FUEL_RUNS, FuelCase} from "./cases";
import {statusSpans, swaps} from "./checks";
import {FuelRecording, loadRecording, rowsOf, scenarioOf} from "./recording";
import {machineOf, SimRow, simulateDrill, simulateMachine} from "./simulation";
import {MachineState} from "../../../../src/state/machine-state";
import {CraftingStatus} from "../../../../src/simulation/status-codes";

/**
 * The simulator against the retained recordings of the burner runs (recordings.test.ts reads the game's figures; this
 * file runs the simulator's burner on the same scenarios, with the probe's cheats, and holds it to them tick by tick):
 * the buffer in J, what is left of the burning item in J, the items in the fuel slot, and the craft or mining bar.
 * Row t is the state after t ticks, before the probe acts in tick t.
 *
 * Not compared: a machine disabled by script (the simulator has no such control for a crafting machine; a drill's
 * control is compared), a furnace that takes a drill's ore (compared by what it burns a plate), and a drill that runs out
 * of fuel (its fuel is assumed supplied, see docs/burner-fuel.md).
 */
const TOLERANCE = 0.01;
/** Where the simulator's rows differ from the game's, as text: the ticks and the columns */
function differences(recording: FuelRecording, name: string, sim: SimRow[], columns: ("heat" | "remaining" | "fuel_count" | "progress" | "output")[]): string[] {
    const found: string[] = [];
    const machine = scenarioOf(recording, name).entity !== "burner-mining-drill";
    rowsOf(recording, name).forEach((game, k) => {
        const row = sim[k];
        for (const column of columns) {
            if (column === "progress" && game.progress === 1) {
                // the game shows a finished bar at 1 for a tick; the simulator has it at 1 (a drill) or back at 0 (a machine)
                if (Math.min(Math.abs(row.progress - 1), Math.abs(row.progress)) > 1e-6) found.push(`t=${k} progress: game 1, simulator ${row.progress}`);
                continue;
            }
            // the game shows the product of a finished craft a tick later than the simulator puts it in the output
            const mine = column === "output" && machine ? sim[Math.max(0, k - 1)].output : row[column];
            if (Math.abs(game[column] - mine) > (column === "progress" ? 1e-6 : TOLERANCE)) found.push(`t=${k} ${column}: game ${game[column]}, simulator ${mine}`);
        }
    });
    return found.slice(0, 3);
}

const steady = loadRecording("steady");
const stops = loadRecording("stops");
const hand1 = loadRecording("feed-hand-1");
const hand4 = loadRecording("feed-hand-4");
const run = (name: string) => FUEL_RUNS.find(it => it.name === name)!;
const caseOf = (name: string, scenario: string): FuelCase => run(name).scenarios.find(it => it.name === scenario)!;

describe("the buffer and the top-up, every tick of a machine at work", () => {
    // each burner on its fuels from a full slot: the first tick fills the buffer, each next draws a tick and tops up, the item changes
    // when the burning one has less than the top-up needs, taking the leftover first
    test.each(steady.info.scenarios.filter(it => it.entity !== "burner-mining-drill").map(it => it.name))("steady %s", name => {
        const spec = caseOf("steady", name);
        const sim = simulateMachine(scenarioOf(steady, name), spec, run("steady").ticks);
        expect(differences(steady, name, sim, ["heat", "remaining", "fuel_count", "progress"])).toEqual([]);
        // crafts finished: the game counts a craft a tick after the simulator, at most (the biochamber's bonus crafts are the
        // game's base productivity, which this simulated machine does not have)
        if (!name.startsWith("biochamber")) {
            expect(Math.abs(rowsOf(steady, name)[run("steady").ticks].finished - sim[run("steady").ticks].finished)).toBeLessThanOrEqual(1);
        }
    });
});

describe("a machine with nothing to work on, stopped, or out of fuel", () => {
    // an idle machine takes no item and burns nothing; a stop spends its last tick without a top-up and restarts on 1/15 of
    // a tick; a machine out of fuel works its buffer down, keeps its bar, and after one item it loads the buffer before it works
    test.each(["stone-idle", "spawner-full-output", "stone-runout", "steel-runout", "spawner-runout", "biochamber-runout"])("stops %s", name => {
        const spec = caseOf("stops", name);
        const sim = simulateMachine(scenarioOf(stops, name), spec, run("stops").ticks);
        expect(differences(stops, name, sim, ["heat", "remaining", "fuel_count", "progress"])).toEqual([]);
    });

    // A craft whose bar sums to exactly 1 (192 steps of 1/192) is finished by the game a tick after its bar shows 1: that tick
    // tops the buffer up, and the next draws a tick's energy with no top-up. The simulator finishes it in the tick its bar
    // reaches 1, so a machine that stops there is one tick of fuel ahead of the game from then on (the biochamber's model has
    // it too): the buffer is 1/15 of a tick a tick sooner and the fuel left is a tick's usage higher from the tick it stops, for the rest of the run.
    test.each(["stone-no-ingredients", "steel-no-ingredients", "stone-full-output", "steel-full-output", "biochamber-no-ingredients"])("stops %s, a tick of fuel ahead of the game", name => {
        const spec = caseOf("stops", name);
        const info = scenarioOf(stops, name);
        const sim = simulateMachine(info, spec, run("stops").ticks);
        const game = rowsOf(stops, name);
        // the energy left: the buffer, the burning item and the items in the slot
        const left = (row: { heat: number; remaining: number; fuel_count: number }) => row.heat + row.remaining + row.fuel_count * info.fuel_value;
        // up to the tick the game's fuel is all burned (a biochamber with 10 nutrients runs out in the run)
        const burned_out = game.findIndex(row => row.t > 0 && left(row) < TOLERANCE);
        const until = burned_out < 0 ? game.length : burned_out - 1;
        const ahead = sim.slice(0, until).map((row, k) => left(row) - left(game[k]));
        const first = ahead.findIndex(it => Math.abs(it) > TOLERANCE);
        const [span] = statusSpans(stops, game, name.endsWith("full-output") ? "full_output" : name.startsWith("biochamber") ? "full_output" : "no_ingredients").filter(([from]) => from > 300);
        expect(first).toBe(span[0]);
        // from the tick it stops the simulator burned nothing more; the game burned the tick before
        // (in the tick an item changes at most: the game changes it a tick later)
        const changes = swaps(game).length + 1;
        expect(ahead.slice(first).filter(it => Math.abs(it - info.energy_usage) > TOLERANCE).length).toBeLessThanOrEqual(changes);
        // the buffer and the fuel items agree in every other tick: the buffer shows 1/15 of a tick a tick sooner, only in the tick before
        const same = sim.slice(0, until).map((row, k) => k === first - 1 ? "" : [Math.abs(row.heat - game[k].heat) < TOLERANCE, row.fuel_count === game[k].fuel_count].every(Boolean) ? "" : `t=${k}`).filter(Boolean);
        expect(same.length).toBeLessThanOrEqual(changes);
    });

    test.each(["stone-runout", "steel-runout", "spawner-runout", "biochamber-runout"])("%s reports no fuel from the tick the buffer is spent until it is refuelled, give or take a tick", name => {
        const spec = caseOf("stops", name);
        const sim = simulateMachine(scenarioOf(stops, name), spec, run("stops").ticks);
        const [game] = statusSpans(stops, rowsOf(stops, name), "no_fuel");
        const first = sim.find(row => row.status === CraftingStatus.NO_FUEL)!.t;
        const last = [...sim].reverse().find(row => row.t < Number(Object.keys(spec.refuel!)[0]) + 1 && row.status === CraftingStatus.NO_FUEL)!.t;
        expect(Math.abs(first - game[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(last - game[1])).toBeLessThanOrEqual(1);
    });

    test("the spawner goes on when its output is full: it keeps working through 100 eggs, and loses the extra", () => {
        const sim = simulateMachine(scenarioOf(stops, "spawner-full-output"), caseOf("stops", "spawner-full-output"), run("stops").ticks);
        expect(new Set(sim.slice(1).map(row => row.status))).toEqual(new Set([CraftingStatus.WORKING]));
        expect(sim[sim.length - 1].finished).toBe(rowsOf(stops, "spawner-full-output")[3000].finished);
    });

    test("a furnace that takes an ore every 240 ticks starts and stops each time and burns 100 J a plate more than the work", () => {
        const spec = caseOf("stops", "furnace-fed-by-drill");
        const machine = machineOf(scenarioOf(stops, "furnace-fed-by-drill"), spec);
        const state = MachineState.forMachine(machine);
        state.fuelInventory.setQuantity("coal", 3);
        const remaining: number[] = [];
        for (let t = 0; t < 1500; t++) {
            if (t % 240 === 10) state.inventoryState.addQuantity("iron-ore", 1);
            remaining.push((state.energy as unknown as { energy_remaining_mj: number }).energy_remaining_mj * 1e6);
            const to = state.crafting.statusRule();
            state.crafting.status = to;
            if (to === CraftingStatus.WORKING) state.crafting.tick();
        }
        // a plate every 240 ticks from the first; 192 ticks of work each, 191 topped up and the first on the 1/15 of a tick
        const burned = remaining[10 + 240 * 4 + 200] - remaining[10 + 240 * 3 + 200];
        expect(burned).toBeCloseTo(-(192 * 1500 + 100), 1);
    });
});

describe("a burner mining drill", () => {
    test.each(["drill-coal", "drill-wood"])("steady %s: the first tick fills the buffer, then it mines and burns a tick of energy in each tick", name => {
        const sim = simulateDrill(scenarioOf(steady, name), caseOf("steady", name), run("steady").ticks);
        expect(differences(steady, name, sim, ["heat", "progress", "output"])).toEqual([]);
    });

    test("held back by a full chest it waits with a full buffer and burns nothing, and works a whole tick when there is room", () => {
        const sim = simulateDrill(scenarioOf(stops, "drill-full-chest"), caseOf("stops", "drill-full-chest"), run("stops").ticks);
        expect(differences(stops, "drill-full-chest", sim, ["heat", "progress", "output"])).toEqual([]);
    });

    test("switched off it keeps a full buffer and its bar, and loses no 1/15 of a tick when it is switched on", () => {
        const sim = simulateDrill(scenarioOf(stops, "drill-disabled"), caseOf("stops", "drill-disabled"), run("stops").ticks);
        expect(differences(stops, "drill-disabled", sim, ["heat", "progress", "output"])).toEqual([]);
    });
});

describe("an inserter filling the fuel slot", () => {
    const machines = hand1.info.scenarios.filter(it => it.entity !== "burner-mining-drill").map(it => it.name);

    test.each(machines)("%s: the limit is 5, an inserter drops its whole hand below it and nothing at it", name => {
        const spec = run("feed-hand-1").scenarios.find(it => it.name === name)!;
        const machine = machineOf(scenarioOf(hand1, name), spec);
        const fuel = machine.fuel_slot!.fuel.item_name;
        expect(machine.fuel_slot!.automated_insertion_limit).toBe(5);
        const state = MachineState.forMachine(machine);
        for (let count = 0; count < 8; count++) {
            state.fuelInventory.setQuantity(fuel, count);
            expect(state.ingress.blocked(fuel), `${name} with ${count}`).toBe(count >= 5);
        }
        // every drop the game made, in both runs, began below the limit and added at most the hand
        for (const recording of [hand1, hand4]) {
            const rows = rowsOf(recording, name);
            const hand = Math.max(...rows.map(row => row.hand));
            for (let k = 1; k < rows.length; k++) {
                const gained = rows[k].fuel_count - rows[k - 1].fuel_count;
                if (gained > 0) {
                    expect(rows[k - 1].fuel_count, `${name} at t=${k}`).toBeLessThan(5);
                    expect(gained).toBeLessThanOrEqual(hand);
                }
            }
        }
    });

    test("the simulator's machine takes the hand whole: an idle stone furnace ends at 8 with a hand of 4, at 5 with a hand of 1", () => {
        const fill = (hand: number, ticks: number) => {
            const spec = run("feed-hand-1").scenarios.find(it => it.name === "stone-coal-idle")!;
            const state = MachineState.forMachine(machineOf(scenarioOf(hand1, "stone-coal-idle"), spec));
            const counts: number[] = [];
            for (let t = 0; t < ticks; t++) {
                if (!state.ingress.blocked("coal")) state.ingress.insert("coal", hand);
                counts.push(state.fuelInventory.getQuantity("coal"));
            }
            return counts;
        };
        expect(fill(4, 5).filter((count, k, all) => k === 0 || count !== all[k - 1])).toEqual([4, 8]);
        expect(Math.max(...fill(1, 20))).toBe(5);
        // the recording, with the inserter's swing between drops
        expect(rowsOf(hand4, "stone-coal-idle").map(row => row.fuel_count).filter((count, k, all) => k === 0 || count !== all[k - 1])).toEqual([0, 4, 8]);
    });
});
