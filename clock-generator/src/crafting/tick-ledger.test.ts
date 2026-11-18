import { describe, expect, it } from "vitest";
import { Duration } from "../data-types";
import { steelHub } from "./container-output.fixture";
import { SimulationContext } from "./sequence/simulation-context";
import { PrepareStep } from "./runner/steps/prepare-step";
import { SimulateStep } from "./runner/steps/simulate-step";
import { WarmupStep } from "./runner/steps/warmup-step";
import { beginShadow, beginTickLoop, countRunMemoHit, shadowOf, tickLedgerOn, withTickLedger, withTickMaker, withTickPurpose, type TickLedgerCount, type TickPurpose } from "./tick-ledger";

const counted = (work: () => void): TickLedgerCount => {
    let count: TickLedgerCount | undefined;
    withTickLedger(made => { count = made; }, work);
    return count!;
};

const rowOf = (count: TickLedgerCount, purpose: TickPurpose, loop: string) => count.rows.find(row => row.purpose === purpose && row.loop === loop);

describe("the tick ledger of a build run by hand", () => {
    // a warm-up asked for 10 window cycles that stops at the second boundary, and a recorded run asked for 500 ticks that its
    // stop ends after 123: the ticks asked and the ticks run differ, and the ledger holds the ticks run
    const WINDOW_CYCLE = 60;
    const ASKED_WARMUP = 10 * WINDOW_CYCLE;
    const ASKED_RECORDED = 500;
    const STOPPED_AFTER = 123;

    it("counts the ticks each loop ran, in the stage of the loop", () => {
        const context = SimulationContext.fromConfig(steelHub());
        let prepared = 0;
        let warmed = 0;
        let recorded = 0;
        const count = counted(() => withTickPurpose("planning", () => {
            const before = context.tick_provider.getCurrentTick();
            new PrepareStep(context).execute();
            prepared = context.tick_provider.getCurrentTick() - before;
            const warmup = new WarmupStep(context, Duration.ofTicks(ASKED_WARMUP), { bin_ticks: WINDOW_CYCLE, key: () => "the same state" });
            warmup.execute();
            warmed = warmup.ticks_run;
            let steps = 0;
            const simulate = new SimulateStep(context, Duration.ofTicks(ASKED_RECORDED), [], () => ++steps === STOPPED_AFTER);
            simulate.execute();
            recorded = simulate.ticks_run;
        }));
        // the warm-up stopped at its repeat, not at the ticks asked for; the recorded run at its stop
        expect(warmed).toBe(WINDOW_CYCLE);
        expect(recorded).toBe(STOPPED_AFTER);
        expect(prepared).toBeGreaterThan(0);
        expect(count.rows).toEqual([
            { maker: null, purpose: "planning", stage: "prepare", loop: "prepare_step", runs: 1, ticks: prepared },
            { maker: null, purpose: "planning", stage: "warm_up", loop: "warmup_step", runs: 1, ticks: WINDOW_CYCLE },
            { maker: null, purpose: "planning", stage: "judged", loop: "simulate_step", runs: 1, ticks: STOPPED_AFTER },
        ]);
    });

    it("counts the ticks of a loop that ended with an error, when the ledger closes", () => {
        const context = SimulationContext.fromConfig(steelHub());
        const warmup = new WarmupStep(context, Duration.ofTicks(100), { bin_ticks: 10, key: () => { if (context.tick_provider.getCurrentTick() >= 30) throw new Error("stopped"); return String(context.tick_provider.getCurrentTick()); } });
        let count: TickLedgerCount | undefined;
        expect(() => withTickLedger(made => { count = made; }, () => withTickPurpose("long_run", () => warmup.execute()))).toThrow("stopped");
        expect(count!.rows).toEqual([{ maker: null, purpose: "long_run", stage: "warm_up", loop: "warmup_step", runs: 1, ticks: 30 }]);
    });
});

describe("the purpose of a run", () => {
    const purposeOfALoop = (work: () => void): TickPurpose => {
        const count = counted(() => { work(); });
        return count.rows[0].purpose;
    };
    const loop = () => beginTickLoop("simulate_step", () => 1)?.close();

    it("is none where no scope gives one", () => {
        expect(purposeOfALoop(loop)).toBe("no_purpose");
    });

    it("is the innermost scope's", () => {
        expect(purposeOfALoop(() => withTickPurpose("planning", () => withTickPurpose("first_span", loop)))).toBe("first_span");
    });

    it("is the claiming scope's, whatever is inside it", () => {
        expect(purposeOfALoop(() => withTickPurpose("quick_trial", () => withTickPurpose("first_span", loop), { claim: true }))).toBe("quick_trial");
        expect(purposeOfALoop(() => withTickPurpose("planning", () => withTickPurpose("trial_copies", () => withTickPurpose("long_run", loop), { claim: true })))).toBe("trial_copies");
    });

    it("goes back to what it was after a scope, also one that threw", () => {
        const count = counted(() => {
            withTickPurpose("planning", () => {
                try { withTickPurpose("taker_order", () => { throw new Error("no"); }, { claim: true }); } catch { /* the scope is left */ }
                loop();
            });
            withTickPurpose("first_span", loop);
        });
        expect(count.rows.map(row => [row.purpose, row.runs])).toEqual([["planning", 1], ["first_span", 1]]);
    });

    it("counts a run the memo handed out again to the purpose that asked, with no tick", () => {
        const count = counted(() => withTickPurpose("long_run", countRunMemoHit));
        expect(count).toEqual({ rows: [], memo_hits: [{ maker: null, purpose: "long_run", hits: 1 }], shadows: [] });
    });
});

describe("the maker of a run", () => {
    const loop = (ticks: number) => () => beginTickLoop("simulate_step", () => ticks)?.close();
    const makersOf = (count: TickLedgerCount) => count.rows.map(row => [row.maker, row.ticks]);

    it("is none outside every maker", () => {
        expect(makersOf(counted(() => withTickPurpose("planning", loop(5))))).toEqual([[null, 5]]);
    });

    it("is the innermost maker's, and the rows of one maker add up", () => {
        const count = counted(() => withTickPurpose("long_run", () => {
            withTickMaker("derived", loop(3));
            withTickMaker("derived", loop(4));
            withTickMaker("full-hand", () => withTickMaker("per-branch", loop(9)));
            loop(1)();
        }));
        expect(count.rows).toEqual([
            { maker: null, purpose: "long_run", stage: "judged", loop: "simulate_step", runs: 1, ticks: 1 },
            { maker: "derived", purpose: "long_run", stage: "judged", loop: "simulate_step", runs: 2, ticks: 7 },
            { maker: "per-branch", purpose: "long_run", stage: "judged", loop: "simulate_step", runs: 1, ticks: 9 },
        ]);
    });

    it("goes back to what it was after a maker, also one that threw", () => {
        const count = counted(() => {
            try { withTickMaker("derived", () => { throw new Error("no"); }); } catch { /* the maker is left */ }
            loop(2)();
        });
        expect(makersOf(count)).toEqual([[null, 2]]);
    });

    it("counts a memo hit to the maker that asked", () => {
        const count = counted(() => withTickPurpose("long_run", () => { withTickMaker("derived", countRunMemoHit); countRunMemoHit(); }));
        expect(count.memo_hits).toEqual([{ maker: null, purpose: "long_run", hits: 1 }, { maker: "derived", purpose: "long_run", hits: 1 }]);
    });

    it("is not set where no ledger is open", () => {
        expect(withTickMaker("derived", () => tickLedgerOn())).toBe(false);
    });
});

describe("a generation with no ledger asked for", () => {
    it("builds no row, gives no count and counts no run", () => {
        let asked = 0;
        const result = withTickLedger(() => { asked++; }, () => 1);
        expect(result).toBe(1);
        expect(asked).toBe(1);
        asked = 0;
        const none = withTickLedger(undefined, () => {
            expect(tickLedgerOn()).toBe(false);
            expect(beginTickLoop("warmup_step", () => 5)).toBeUndefined();
            withTickPurpose("planning", () => expect(beginTickLoop("warmup_step", () => 5)).toBeUndefined());
            countRunMemoHit();
            return "worked";
        });
        expect(none).toBe("worked");
        expect(asked).toBe(0);
    });

    it("runs the steps as before: the ticks run are the same with and without a ledger", () => {
        const run = (ledger: boolean) => {
            const context = SimulationContext.fromConfig(steelHub());
            const work = () => {
                new PrepareStep(context).execute();
                const simulate = new SimulateStep(context, Duration.ofTicks(200));
                simulate.execute();
                return [context.tick_provider.getCurrentTick(), simulate.ticks_run];
            };
            return ledger ? withTickLedger(() => { }, work) : work();
        };
        expect(run(true)).toEqual(run(false));
    });

    it("is not nested: a ledger inside another counts to the first", () => {
        let inner = 0;
        const count = counted(() => withTickLedger(() => { inner++; }, () => withTickPurpose("planning", () => beginTickLoop("prepare_step", () => 7)?.close())));
        expect(inner).toBe(0);
        expect(rowOf(count, "planning", "prepare_step")).toEqual({ maker: null, purpose: "planning", stage: "prepare", loop: "prepare_step", runs: 1, ticks: 7 });
    });
});

describe("the shadow: the first warm-up window cycle whose output equals the judged cycle's", () => {
    const WINDOW_CYCLE = 10;
    const WARM_UP_CYCLES = 8;

    /**
     * A warm-up of 8 window cycles and a recorded run of 1 on a build whose output is scripted: `per_cycle(c)` is the items the
     * one output gives in window cycle c (from 1; the judged cycle is the 9th). The reader gives the running total at the tick.
     */
    const shadowsOf = (per_cycle: (cycle: number) => number, options: { stops_at_repeat?: boolean; recorded_ticks?: number; asked_cycles?: number } = {}) => {
        const context = SimulationContext.fromConfig(steelHub());
        const total = () => {
            let items = 0;
            for (let cycle = 1; cycle <= Math.floor(context.tick_provider.getCurrentTick() / WINDOW_CYCLE); cycle++) items += per_cycle(cycle);
            return [items];
        };
        const asked = options.asked_cycles ?? WARM_UP_CYCLES;
        const count = counted(() => withTickPurpose("long_run", () => {
            const shadow = beginShadow(WINDOW_CYCLE, asked, 1, total)!;
            new WarmupStep(context, Duration.ofTicks(asked * WINDOW_CYCLE), options.stops_at_repeat ? { bin_ticks: WINDOW_CYCLE, key: () => "the same state" } : undefined, shadow.warm_up).execute();
            const start = context.tick_provider.getCurrentTick();
            const recorder = shadow.judged(() => context.tick_provider.getCurrentTick() - start)!;
            new SimulateStep(context, Duration.ofTicks(options.recorded_ticks ?? WINDOW_CYCLE), [recorder]).execute();
            shadow.finish();
        }));
        return count.shadows;
    };
    const row = (fields: object) => ({ maker: null, purpose: "long_run", outcome: "found", cycle: null, stays: false, ran: WARM_UP_CYCLES, asked: WARM_UP_CYCLES, runs: 1, ...fields });

    it("gives the cycle k where the output settles, counted from 1", () => {
        // 2 and 4 items in the first two window cycles, then 5 in each, the judged one too: it settles at 3
        expect(shadowsOf(cycle => cycle === 1 ? 2 : cycle === 2 ? 4 : 5)).toEqual([row({ cycle: 3, stays: true })]);
        expect(shadowsOf(cycle => cycle === 1 ? 5 : 6)).toEqual([row({ cycle: 2, stays: true })]);
        expect(shadowsOf(() => 5)).toEqual([row({ cycle: 1, stays: true })]);
    });

    it("gives none for a build that never settles in its warm-up", () => {
        // the output grows by one every window cycle: the judged cycle's is more than any the warm-up gave
        expect(shadowsOf(cycle => cycle)).toEqual([row({ outcome: "none" })]);
    });

    it("tells whether the later window cycles gave that output too", () => {
        // 5 and 4 in turn: the judged cycle (the 9th) gives 5, and the first cycle to give 5 is not followed by cycles that all do
        expect(shadowsOf(cycle => cycle % 2 === 1 ? 5 : 4)).toEqual([row({ cycle: 1, stays: false })]);
    });

    it("compares every output exactly, and reads the warm-up where it stopped at its repeat", () => {
        const context = SimulationContext.fromConfig(steelHub());
        const outputs = () => [Math.floor(context.tick_provider.getCurrentTick() / WINDOW_CYCLE) * 3, Math.floor(context.tick_provider.getCurrentTick() / WINDOW_CYCLE) < 2 ? 1 : 4];
        expect(shadowOf([[3, 1], [3, 4], [3, 4]], [3, 4])).toEqual({ cycle: 2, stays: true });
        expect(shadowOf([[3, 1], [3, 4]], [3, 5])).toEqual({ cycle: null, stays: false });
        expect(shadowOf([[3]], [3, 4])).toEqual({ cycle: null, stays: false });
        const count = counted(() => {
            const shadow = beginShadow(WINDOW_CYCLE, 8, 2, outputs)!;
            const warmup = new WarmupStep(context, Duration.ofTicks(8 * WINDOW_CYCLE), { bin_ticks: WINDOW_CYCLE, key: () => "the same state" }, shadow.warm_up);
            warmup.execute();
            // the repeat stops it at the boundary of the first window cycle after the first: 1 whole window cycle was run
            expect(warmup.ticks_run).toBe(WINDOW_CYCLE);
            shadow.finish();
        });
        expect(count.shadows).toEqual([{ maker: null, purpose: "no_purpose", outcome: "not_judged", cycle: null, stays: false, ran: 1, asked: 8, runs: 1 }]);
    });

    it("reads nothing and changes nothing: a warm-up watched stops where it stopped, with the same ticks", () => {
        const run = (watched: boolean) => {
            const context = SimulationContext.fromConfig(steelHub());
            const work = () => {
                const shadow = watched ? beginShadow(WINDOW_CYCLE, 8, 1, () => [0]) : undefined;
                const warmup = new WarmupStep(context, Duration.ofTicks(8 * WINDOW_CYCLE), { bin_ticks: WINDOW_CYCLE, key: () => "the same state" }, shadow?.warm_up);
                warmup.execute();
                return [warmup.ticks_run, warmup.repeat_ticks, context.tick_provider.getCurrentTick()];
            };
            return watched ? withTickLedger(() => { }, work) : work();
        };
        expect(run(true)).toEqual(run(false));
    });

    it("counts a warm-up asked for no window cycle, a run with no judged cycle, a window cycle of fractional ticks and a build with no output", () => {
        expect(shadowsOf(() => 5, { asked_cycles: 0 })).toEqual([row({ outcome: "no_warm_up", ran: 0, asked: 0 })]);
        // a recorded run shorter than one window cycle has no judged cycle
        expect(shadowsOf(() => 5, { recorded_ticks: WINDOW_CYCLE - 1 })).toEqual([row({ outcome: "not_judged" })]);
        const fixed = counted(() => withTickPurpose("planning", () => {
            beginShadow(10.5, 10, 1, () => [0])!.finish();
            beginShadow(10, 10, 0, () => [])!.finish();
        }));
        expect(fixed.shadows.map(it => [it.outcome, it.purpose, it.asked, it.ran])).toEqual([["not_whole", "planning", 10, 0], ["no_output", "planning", 10, 0]]);
    });

    it("counts by maker, purpose and cycle, not a line a run, and a run an error ended before its judged cycle as none", () => {
        const count = counted(() => {
            for (const maker of ["derived", "derived", "per-branch"]) {
                withTickMaker(maker, () => withTickPurpose("first_span", () => {
                    const shadow = beginShadow(WINDOW_CYCLE, 8, 1, () => [0])!;
                    shadow.warm_up!.cycle_ended();
                    if (maker === "per-branch") return;
                    shadow.finish();
                }));
            }
        });
        expect(count.shadows.map(it => [it.maker, it.purpose, it.outcome, it.ran, it.runs])).toEqual([
            ["derived", "first_span", "not_judged", 1, 2],
            ["per-branch", "first_span", "not_judged", 1, 1],
        ]);
    });

    it("builds nothing where no ledger is open", () => {
        expect(beginShadow(WINDOW_CYCLE, 8, 1, () => { throw new Error("read"); })).toBeUndefined();
    });
});
