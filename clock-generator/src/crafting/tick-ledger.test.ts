import { describe, expect, it } from "vitest";
import { Duration } from "../data-types";
import { steelHub } from "./container-output.fixture";
import { SimulationContext } from "./sequence/simulation-context";
import { PrepareStep } from "./runner/steps/prepare-step";
import { SimulateStep } from "./runner/steps/simulate-step";
import { WarmupStep } from "./runner/steps/warmup-step";
import { beginTickLoop, countRunMemoHit, tickLedgerOn, withTickLedger, withTickMaker, withTickPurpose, type TickLedgerCount, type TickPurpose } from "./tick-ledger";

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
            const warmup = new WarmupStep(context, Duration.ofTicks(ASKED_WARMUP), { window_cycle_ticks: WINDOW_CYCLE, key: () => "the same state" });
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
        const warmup = new WarmupStep(context, Duration.ofTicks(100), { window_cycle_ticks: 10, key: () => { if (context.tick_provider.getCurrentTick() >= 30) throw new Error("stopped"); return String(context.tick_provider.getCurrentTick()); } });
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
        expect(count).toEqual({ rows: [], memo_hits: [{ maker: null, purpose: "long_run", hits: 1 }] });
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
