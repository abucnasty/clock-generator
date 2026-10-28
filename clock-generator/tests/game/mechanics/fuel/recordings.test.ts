import {describe, expect, test} from "vitest";
import {firstTick, ledger, statusSpans, swaps, TOLERANCE} from "./checks";
import {FuelRecording, loadRecording, rowsOf, scenarioOf, statusName} from "./recording";

/**
 * The retained recordings of the burner runs (fuel.game.test.ts, probe.lua), read offline: what the game does with the
 * energy and the fuel of a stone furnace, a steel furnace, a burner mining drill, a captive biter spawner and, as the
 * control the simulator models, a biochamber. Figures are the prototypes' (energy_usage, fuel_value) and the game's.
 * See README.md.
 */
const BUFFER_TICKS = 16 / 15;
/** An inserter fills a fuel slot while it holds fewer items than this (the 5 of the automated insertion limit) */
const FUEL_LIMIT = 5;
const FUEL_BUFFERS = 180;

const steady = loadRecording("steady");
const stops = loadRecording("stops");
const productive = loadRecording("drill-productivity");
const hand1 = loadRecording("feed-hand-1");
const hand4 = loadRecording("feed-hand-4");

const near = (a: number, b: number, tolerance = TOLERANCE) => Math.abs(a - b) <= tolerance;

describe("what the prototypes say", () => {
    // energy_usage in J a tick: 90 kW, 90 kW, 150 kW, 100 kW, 500 kW
    const USAGE: Record<string, number> = {"stone-coal": 1500, "stone-wood": 1500, "steel-coal": 1500, "steel-solid-fuel": 1500,
        "drill-coal": 2500, "drill-wood": 2500, "spawner-bioflux": 5000 / 3, "biochamber-nutrients": 25000 / 3};
    // fuel_value in J: coal 4 MJ, wood 2 MJ, solid fuel 12 MJ, bioflux 6 MJ, nutrients 2 MJ
    const VALUE: Record<string, number> = {"stone-coal": 4e6, "stone-wood": 2e6, "steel-coal": 4e6, "steel-solid-fuel": 12e6,
        "drill-coal": 4e6, "drill-wood": 2e6, "spawner-bioflux": 6e6, "biochamber-nutrients": 2e6};

    test.each(Object.keys(USAGE))("%s: usage, buffer, effectivity and one fuel slot", name => {
        const scenario = scenarioOf(steady, name);
        expect(scenario.energy_usage).toBeCloseTo(USAGE[name], 6);
        // the burner's buffer is 16/15 of a tick of its usage; no energy is lost to effectivity
        expect(scenario.heat_capacity).toBeCloseTo(USAGE[name] * BUFFER_TICKS, 6);
        expect(scenario.effectivity).toBe(1);
        expect(scenario.fuel_slots).toBe(1);
        expect(scenario.fuel_value).toBe(VALUE[name]);
    });

    test("the entity's energy is its burner's heat in every tick", () => {
        for (const recording of [steady, stops, productive, hand1, hand4]) expect(recording.info.energy_gap).toBe(0);
    });
});

describe("every tick follows the buffer and top-up rule", () => {
    const runs: [string, FuelRecording][] = [["steady", steady], ["stops", stops], ["drill-productivity", productive], ["feed-hand-1", hand1], ["feed-hand-4", hand4]];
    for (const [run, recording] of runs) {
        test.each(recording.info.scenarios.map(scenario => scenario.name))(`${run}: %s`, name => {
            const scenario = scenarioOf(recording, name);
            expect(ledger(rowsOf(recording, name), scenario.energy_usage, scenario.heat_capacity, scenario.fuel_value)).toEqual([]);
        });
    }
});

describe("a machine at work", () => {
    test.each(steady.info.scenarios.map(scenario => scenario.name))("%s burns its usage in each tick of work and takes the next item when the top-up outruns the burning one", name => {
        const scenario = scenarioOf(steady, name), rows = rowsOf(steady, name);
        // tick 1: the empty buffer is filled from the fuel and the machine has done no work; from tick 2 it works
        expect(rows[0].heat).toBe(0);
        expect(rows[1].heat).toBeCloseTo(scenario.heat_capacity, 3);
        expect(rows[1].progress).toBe(0);
        expect(rows[2].progress).toBeGreaterThan(0);
        // a tick of work burns a tick of usage from the burning item, the buffer staying full, except in the tick the item changes
        let steadyTicks = 0, working = 0;
        for (let k = 3; k < rows.length; k++) {
            if (rows[k].fuel_count !== rows[k - 1].fuel_count) continue;
            working++;
            if (near(rows[k - 1].remaining - rows[k].remaining, scenario.energy_usage) && near(rows[k].heat, scenario.heat_capacity)) steadyTicks++;
        }
        expect(steadyTicks / working).toBeGreaterThan(0.999);
        // the new item is taken when the burning one has less than the top-up needs, and the top-up's rest comes from it
        for (const swap of swaps(rows).filter(it => it.t > 3)) {
            expect(swap.leftover, `the item left at t=${swap.t}`).toBeLessThan(scenario.energy_usage);
            expect(swap.remaining).toBeCloseTo(scenario.fuel_value - (scenario.energy_usage - swap.leftover), 2);
        }
    });

    test("the items last as long as the fuel's value over the usage", () => {
        for (const [name, ticks] of [["stone-coal", 4e6 / 1500], ["stone-wood", 2e6 / 1500], ["drill-coal", 4e6 / 2500], ["drill-wood", 2e6 / 2500], ["spawner-bioflux", 6e6 / (5000 / 3)], ["biochamber-nutrients", 2e6 / (25000 / 3)]] as const) {
            const at = swaps(rowsOf(steady, name)).map(swap => swap.t);
            for (let k = 2; k < at.length; k++) expect(at[k] - at[k - 1], `${name} swap ${k}`).toBeGreaterThanOrEqual(Math.floor(ticks));
            for (let k = 2; k < at.length; k++) expect(at[k] - at[k - 1], `${name} swap ${k}`).toBeLessThanOrEqual(Math.ceil(ticks));
        }
        // solid fuel is 12 MJ an item: the steel furnace burns the one item all run
        expect(swaps(rowsOf(steady, "steel-solid-fuel")).length).toBe(1);
    });

    test("a craft takes the crafting speed's share of a tick, so a steel furnace burns half the energy for a plate", () => {
        const stone = rowsOf(steady, "stone-coal"), steel = rowsOf(steady, "steel-coal");
        // iron plate: 3.2 s; the bar moves 1/192 a tick at speed 1 and 1/96 at speed 2
        expect(stone[3].progress - stone[2].progress).toBeCloseTo(1 / 192, 8);
        expect(steel[3].progress - steel[2].progress).toBeCloseTo(1 / 96, 8);
        // 6000 ticks of 1500 J: 31 plates from the stone furnace, 62 from the steel
        expect(stone[stone.length - 1].finished).toBe(31);
        expect(steel[steel.length - 1].finished).toBe(62);
        expect(stone[stone.length - 1].finished * 192 * 1500 / 6000).toBeCloseTo(1500 * 0.992, 0);
    });

    test("the spawner makes 5 eggs in 10 s at 100 kW: 1 MJ a craft, 6 crafts to a bioflux", () => {
        const rows = rowsOf(steady, "spawner-bioflux");
        expect(rows[3].progress - rows[2].progress).toBeCloseTo(1 / 600, 8);
        expect(rows[rows.length - 1].finished).toBe(9);
        expect(rows[rows.length - 1].output).toBe(45);
        expect(scenarioOf(steady, "spawner-bioflux").energy_usage * 600).toBeCloseTo(1e6, 3);
    });
});

describe("a burner mining drill", () => {
    const drill = scenarioOf(steady, "drill-coal");

    test("mines at 0.25 a second: 240 ticks and 600 kJ an ore, 6.67 ore to a coal", () => {
        expect(drill.mining_speed).toBe(0.25);
        const rows = rowsOf(steady, "drill-coal");
        expect(rows[3].progress - rows[2].progress).toBeCloseTo(1 / 240, 8);
        // the mining bar wraps at 1: 24 ores in the chest after 6000 ticks, the 25th two ticks short
        expect(rows[rows.length - 1].output).toBe(24);
        expect(drill.energy_usage * 240).toBe(600000);
        expect(drill.fuel_value / (drill.energy_usage * 240)).toBeCloseTo(6.667, 3);
    });

    test("its fuel use does not depend on the items it makes", () => {
        const plain = rowsOf(steady, "drill-coal"), rich = rowsOf(productive, "drill-coal");
        // with the save's mining productivity research the same 2500 J a tick make over a hundred times the ore
        expect(rich[rich.length - 1].output).toBeGreaterThan(100 * 5);
        for (const rows of [plain, rich]) {
            let ticks = 0;
            for (let k = 3; k < 1100; k++) if (rows[k].fuel_count === rows[k - 1].fuel_count) { ticks++; expect(rows[k - 1].remaining - rows[k].remaining).toBeCloseTo(2500, 2); }
            expect(ticks).toBeGreaterThan(1000);
        }
    });

    test("into a furnace it makes a plate's ore every 240 ticks, so the furnace starts and stops each time and burns 100 J a craft more", () => {
        const rows = rowsOf(stops, "furnace-fed-by-drill");
        const starts = rows.filter((row, k) => k > 0 && row.progress > 0 && rows[k - 1].progress === 0);
        expect(starts.length).toBeGreaterThan(10);
        for (let k = 2; k < starts.length; k++) expect(starts[k].t - starts[k - 1].t).toBe(240);
        // between two starts the furnace works 192 ticks: 191 topped up, the first tick one fifteenth of a tick
        const [a, b] = [starts[3], starts[4]];
        const burned = rows[a.t].remaining - rows[b.t].remaining;
        expect(burned).toBeCloseTo(192 * 1500 + 100, 2);
    });
});

describe("a machine that has no work", () => {
    test("burns nothing and takes no fuel item, with or without a burning item", () => {
        for (const name of ["stone-idle", "drill-disabled-from-start"]) {
            const rows = rowsOf(stops, name);
            for (const row of rows) {
                expect(row.heat).toBe(0);
                expect(row.remaining).toBe(1e6);
                expect(row.fuel_count).toBe(3);
            }
        }
        expect(statusSpans(stops, rowsOf(stops, "stone-idle"), "no_ingredients")).toEqual([[0, 3000]]);
    });

    test.each([["stone-no-ingredients", "no_ingredients"], ["steel-no-ingredients", "no_ingredients"], ["stone-full-output", "full_output"],
        ["steel-full-output", "full_output"], ["biochamber-no-ingredients", "full_output"]])("%s: a furnace or biochamber that stops keeps the buffer less its last tick, and restarts on a fifteenth of a tick", (name, status) => {
        const scenario = scenarioOf(stops, name), rows = rowsOf(stops, name);
        const [span] = statusSpans(stops, rows, status).filter(([from]) => from > 300);
        const held = scenario.heat_capacity - scenario.energy_usage;
        // from the tick it stops to the tick it works again, the buffer holds a fifteenth of a tick and nothing burns
        const resume = firstTick(rows, (row, k) => k > span[0] && rows[k - 1].remaining - row.remaining > 0);
        for (let t = span[0]; t < resume; t++) {
            expect(rows[t].heat, `${name} t=${t}`).toBeCloseTo(held, 2);
            expect(rows[t].remaining).toBe(rows[span[0]].remaining);
        }
        // the restart tick: a fifteenth of a tick's progress and the whole buffer burned
        const first = rows[resume], before = rows[resume - 1];
        expect(before.remaining - first.remaining).toBeCloseTo(scenario.heat_capacity, 2);
        expect(first.heat).toBeCloseTo(scenario.heat_capacity, 2);
    });

    test("a restart tick of a furnace makes 1/15 of a tick's progress, the next a whole tick's", () => {
        for (const [name, step, status] of [["stone-no-ingredients", 1 / 192, "no_ingredients"], ["steel-no-ingredients", 1 / 96, "no_ingredients"],
            ["stone-full-output", 1 / 192, "full_output"], ["steel-full-output", 1 / 96, "full_output"]] as const) {
            const rows = rowsOf(stops, name);
            const [span] = statusSpans(stops, rows, status).filter(([from]) => from > 300);
            const resume = firstTick(rows, (row, k) => k > span[0] && rows[k - 1].remaining - row.remaining > 0);
            expect(rows[resume].progress, name).toBeCloseTo(step / 15, 8);
            expect(rows[resume + 1].progress - rows[resume].progress, name).toBeCloseTo(step, 8);
        }
    });

    test("a drill held back by a full chest keeps its buffer full and burns nothing", () => {
        const scenario = scenarioOf(stops, "drill-full-chest"), rows = rowsOf(stops, "drill-full-chest");
        const [span] = statusSpans(stops, rows, "waiting_for_space_in_destination").filter(([from]) => from > 300);
        expect(span[1] - span[0]).toBeGreaterThan(150);
        for (let t = span[0]; t <= span[1]; t++) {
            expect(rows[t].heat).toBeCloseTo(scenario.heat_capacity, 2);
            expect(rows[t].remaining).toBe(rows[span[0]].remaining);
            expect(rows[t].progress).toBe(rows[span[0]].progress);
        }
        // the tick after the chest is emptied works a whole tick
        const resume = span[1] + 1;
        expect(rows[resume + 1].progress - rows[resume].progress).toBeCloseTo(1 / 240, 8);
        expect(rows[resume].remaining - rows[resume + 1].remaining).toBeCloseTo(2500, 2);
    });

    test.each(["stone-disabled", "drill-disabled", "spawner-disabled", "biochamber-disabled"])("%s: switched off by a script it holds a full buffer and burns nothing; it resumes at full speed", name => {
        const scenario = scenarioOf(stops, name), rows = rowsOf(stops, name);
        const [span] = statusSpans(stops, rows, "disabled_by_script");
        expect(span[1] - span[0]).toBeGreaterThan(200);
        for (let t = span[0]; t <= span[1]; t++) {
            expect(rows[t].heat).toBeCloseTo(scenario.heat_capacity, 2);
            expect(rows[t].remaining).toBe(rows[span[0]].remaining);
            expect(rows[t].progress).toBe(rows[span[0]].progress);
        }
        const resume = span[1] + 1;
        expect(rows[resume + 1].remaining).toBeLessThan(rows[resume].remaining);
        expect(rows[resume + 2].progress).toBeGreaterThan(rows[resume + 1].progress);
    });

    test("the spawner goes on when its output slot is full", () => {
        const rows = rowsOf(stops, "spawner-full-output");
        expect(rows.some(row => row.output === 100)).toBe(true);
        expect(statusSpans(stops, rows, "working")).toEqual([[0, 3000]]);
        expect(rows[rows.length - 1].finished).toBeGreaterThan(rows[700].finished);
        // the eggs that do not fit are not kept: none lie about the spawner either
        expect(scenarioOf(stops, "spawner-full-output").ground_items?.["biter-egg"]).toBeUndefined();
    });
});

describe("a machine that runs out of fuel", () => {
    // [scenario, tick the probe puts one fuel item in]
    test.each([["stone-runout", 300], ["steel-runout", 300], ["drill-runout", 300], ["spawner-runout", 500], ["biochamber-runout", 300]] as const)("%s", (name, refuel) => {
        const scenario = scenarioOf(stops, name), rows = rowsOf(stops, name);
        const [span] = statusSpans(stops, rows, "no_fuel");
        // it reports no fuel once the buffer is spent, holding nothing and its progress where it was
        expect(span[0]).toBeGreaterThan(30);
        expect(span[1]).toBe(refuel - 1);
        for (let t = span[0]; t <= span[1]; t++) {
            expect(rows[t].heat).toBe(0);
            expect(rows[t].remaining).toBe(0);
            expect(rows[t].progress).toBeCloseTo(rows[span[0]].progress, 8);
            expect(rows[t].progress).toBeGreaterThan(0);
        }
        // the last tick before it worked on what the buffer held: a share of a tick that is less than a whole one, or a whole
        const last = rows[span[0] - 1], step = rows[span[0] - 1].progress - rows[span[0] - 2].progress;
        expect(last.heat).toBeLessThanOrEqual(scenario.energy_usage + TOLERANCE);
        expect(rows[span[0]].progress).toBeGreaterThanOrEqual(last.progress);
        // the tick the item is put in nothing else changes; the next burns the whole buffer and makes no progress;
        // the one after progresses a whole tick
        expect(rows[refuel].fuel_count).toBe(1);
        expect(rows[refuel].progress).toBeCloseTo(rows[span[0]].progress, 8);
        expect(rows[refuel + 1].heat).toBeCloseTo(scenario.heat_capacity, 2);
        expect(rows[refuel + 1].fuel_count).toBe(0);
        expect(rows[refuel + 1].progress).toBeCloseTo(rows[span[0]].progress, 8);
        expect(rows[refuel + 2].progress - rows[refuel + 1].progress).toBeGreaterThan(step * 0.4);
        expect(step).toBeGreaterThan(0);
    });
});

describe("an inserter filling the fuel slot", () => {
    const names = (recording: FuelRecording) => recording.info.scenarios.map(scenario => scenario.name);

    test("the limit is 5 for every burner and fuel here: the 3 second rule needs more than 5 items nowhere", () => {
        for (const recording of [hand1, hand4]) {
            for (const name of names(recording)) {
                const scenario = scenarioOf(recording, name);
                const items = Math.ceil(scenario.heat_capacity * FUEL_BUFFERS / scenario.fuel_value - 1e-9);
                expect(Math.max(FUEL_LIMIT, items), name).toBe(FUEL_LIMIT);
            }
        }
    });

    test("with a hand of 1 it stops at 5 items", () => {
        for (const name of names(hand1).filter(it => !it.includes("stack") && !it.includes("tree-seed"))) {
            expect(Math.max(...rowsOf(hand1, name).map(row => row.fuel_count)), name).toBe(FUEL_LIMIT);
        }
    });

    test("it drops its whole hand when the slot holds fewer than 5, so the slot goes to 4 plus the hand", () => {
        // with nothing burning (a machine with no work) the first hand lands in the slot
        const idle = rowsOf(hand4, "stone-coal-idle");
        expect(idle.map(row => row.fuel_count).filter((count, k, all) => k === 0 || count !== all[k - 1])).toEqual([0, 4, 8]);
        // a stack inserter's hand of 16 drops into an empty slot; the machine takes one into the burner
        expect(Math.max(...rowsOf(hand4, "stone-coal-stack").map(row => row.hand))).toBe(16);
        expect(Math.max(...rowsOf(hand4, "stone-coal-stack").map(row => row.fuel_count))).toBe(15);
        // a hand of 5 (the stack inserter without research): 4 in the slot, then 5 more
        expect(rowsOf(hand1, "stone-coal-stack").map(row => row.fuel_count).filter((count, k, all) => k === 0 || count !== all[k - 1])).toEqual([0, 4, 9]);
        // a hand of 4 at a working machine: one burning, 3 in the slot, 4 more
        expect(Math.max(...rowsOf(hand4, "stone-coal").map(row => row.fuel_count))).toBe(7);
    });

    test("a machine with no fuel reports no fuel before it reports a shortage of ingredients", () => {
        for (const [name, shortage] of [["stone-coal-idle", "no_ingredients"], ["biochamber-nutrients-idle", "item_ingredient_shortage"]]) {
            const rows = rowsOf(hand1, name);
            expect(statusName(hand1, rows[0]), name).toBe("no_fuel");
            // the first item in the slot changes it, though the machine is not burning yet
            expect(statusName(hand1, rows[rows.length - 1]), name).toBe(shortage);
        }
    });

    test("an idle machine is filled as well", () => {
        for (const name of names(hand1).filter(it => it.endsWith("-idle"))) {
            const rows = rowsOf(hand1, name);
            expect(rows[rows.length - 1].fuel_count, name).toBe(FUEL_LIMIT);
            expect(Math.max(...rows.map(row => row.heat)), name).toBe(0);
        }
    });

    test("it keeps up a burner that burns an item in 67 ticks only with a hand of more than one", () => {
        // a tree seed (0.1 MJ) lasts a stone furnace 66.7 ticks; an inserter with a hand of one brings a seed every 70
        expect(Math.max(...rowsOf(hand1, "stone-tree-seed").map(row => row.fuel_count))).toBe(0);
        expect(Math.max(...rowsOf(hand4, "stone-tree-seed").map(row => row.fuel_count))).toBeGreaterThanOrEqual(5);
    });
});
