import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { disturbanceTrialOf, generateClockAlternatives } from "./generate-blueprint";
import { LOSS_WORKERS_VARIABLE, lossRunPool } from "./loss-run-pool";
import { syncWorkerPool } from "./sync-worker-pool";

// The loss runs of a disturbance trial in worker threads (CLOCK_LOSS_WORKERS). These tests are generation tests so that they run the
// build in dist/, which holds the worker's script beside the module; the TypeScript sources have none.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const fixture = path.join(__dirname, "sync-worker-pool.fixture.cjs");

afterEach(() => {
    delete process.env[LOSS_WORKERS_VARIABLE];
    lossRunPool();
});

describe("a pool of worker threads that answer a thread that waits", () => {
    test("gives the answers in the order of the requests, and a request that throws as an error of its own", () => {
        const pool = syncWorkerPool<number | string, number>(fixture, 3)!;
        try {
            const results = pool.run([1, 2, "throw", 4, 5, 6, 7]);
            expect(results.map(it => ("answer" in it ? it.answer : "error"))).toEqual([2, 4, "error", 8, 10, 12, 14]);
            expect((results[2] as { error: string }).error).toContain("this request fails");
            // the same workers serve a second batch
            expect(pool.run([10]).map(it => ("answer" in it ? it.answer : "error"))).toEqual([20]);
            expect(pool.runs_made).toBe(8);
            expect(pool.open).toBe(true);
        } finally {
            pool.close();
        }
    });

    test("a worker that exits ends the wait with an error naming it, and closes the pool", () => {
        const pool = syncWorkerPool<number | string, number>(fixture, 2)!;
        expect(() => pool.run([1, "exit", 3])).toThrow(/worker thread of .* stopped: it exited with code 3/);
        expect(pool.open).toBe(false);
        expect(() => pool.run([1])).toThrow(/closed by an earlier failure/);
    });

    test("no answer from any worker for the time asked ends the wait with an error, not a hang", () => {
        const pool = syncWorkerPool<number | string, number>(fixture, 1, { stall_ms: 300 })!;
        const started = Date.now();
        expect(() => pool.run(["hang"])).toThrow(/No worker thread of .* answered in 0\.3 s: 1 of 1 runs are not made/);
        expect(Date.now() - started).toBeLessThan(4000);
        expect(pool.open).toBe(false);
    });

    test("a script that is not there is an error, not a serial run", () => {
        expect(() => syncWorkerPool(path.join(__dirname, "no-such-worker.js"), 2)).toThrow(/is not a file/);
        expect(syncWorkerPool(fixture, 0)).toBeNull();
    });
});

describe("the loss runs of a disturbance trial in worker threads", () => {
    // the grenade build as a hand-made clock (grenade-clock.generation.test.ts): one loss, the product's output
    async function grenade() {
        const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
        const range = (start: number, end: number) => [{ start, end }];
        const windows = {
            "inserter:1": range(0, 0), "inserter:2": range(0, 0), "inserter:7": range(56, 56), "inserter:8": range(56, 56),
            "inserter:3": range(2, 43), "inserter:4": range(2, 43), "inserter:5": range(58, 99), "inserter:6": range(58, 99),
            "drill:1": range(5, 7), "drill:2": range(5, 7), "drill:3": range(61, 63), "drill:4": range(61, 63),
        };
        const forced = { ...config, overrides: { ...config.overrides, terminal_swing_count: 1 } };
        return { forced, windows, broken: { ...windows, "inserter:3": range(2, 20), "inserter:4": range(2, 20) } };
    }
    const trialWith = (workers: string | undefined, run: () => ReturnType<typeof disturbanceTrialOf>) => {
        if (workers === undefined) delete process.env[LOSS_WORKERS_VARIABLE]; else process.env[LOSS_WORKERS_VARIABLE] = workers;
        return run();
    };

    test("a clock that recovers has the same report with the runs in worker threads, and the workers made the runs", async () => {
        const { forced, windows } = await grenade();
        const serial = trialWith(undefined, () => disturbanceTrialOf(forced, windows, 112, 64, quiet));
        expect(lossRunPool()).toBeNull();
        const threaded = trialWith("2", () => disturbanceTrialOf(forced, windows, 112, 64, quiet));
        expect(threaded).toEqual(serial);
        expect(serial.survives).toBe(true);
        // the undisturbed run and the one loss
        expect(lossRunPool()!.workers).toBe(2);
        expect(lossRunPool()!.runs_made).toBe(2);
    });

    test("a clock that does not recover has the same report, its trials counted as before", async () => {
        const { forced, broken } = await grenade();
        const serial = trialWith("0", () => disturbanceTrialOf(forced, broken, 112, 64, quiet));
        const threaded = trialWith("3", () => disturbanceTrialOf(forced, broken, 112, 64, quiet));
        expect(serial.survives).toBe(false);
        expect(serial.losses[0].every_trial).toEqual({ run: 16, recovered: 0 });
        expect(threaded).toEqual(serial);
        expect(lossRunPool()!.runs_made).toBe(2);
    });

    test("a run that fails in a worker fails the trial with its error, as the same run does on one thread", async () => {
        const { forced, windows } = await grenade();
        const options = { places: "x" as unknown as number[] };
        expect(() => trialWith("0", () => disturbanceTrialOf(forced, windows, 112, 64, quiet, options))).toThrow(/places\.map is not a function/);
        expect(() => trialWith("2", () => disturbanceTrialOf(forced, windows, 112, 64, quiet, options)))
            .toThrow(/The run of a loss in a worker thread failed: TypeError: places\.map is not a function/);
    });

    test("a whole generation gives the same clocks, verdicts and trial results, with loss runs left unread after a loss it does not recover from", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        delete process.env[LOSS_WORKERS_VARIABLE];
        const serial = generateClockAlternatives(config, { logger: quiet });
        process.env[LOSS_WORKERS_VARIABLE] = "2";
        const threaded = generateClockAlternatives(config, { logger: quiet });
        expect(threaded.selected_index).toBe(serial.selected_index);
        expect(threaded.alternatives.map(it => [it.id, it.verdict])).toEqual(serial.alternatives.map(it => [it.id, it.verdict]));
        expect(threaded.alternatives.some(it => it.verdict !== "stable")).toBe(true);
        expect(lossRunPool()!.runs_made).toBeGreaterThan(10);
        const withoutSeconds = (made: typeof serial) => JSON.stringify(made.alternatives.map(it => [it.result.clock_windows, it.result.stability_check, it.assessment]));
        expect(withoutSeconds(threaded)).toBe(withoutSeconds(serial));
    }, 300_000);

    test("a switch that is not a whole number is refused, and 0 or none is serial", () => {
        process.env[LOSS_WORKERS_VARIABLE] = "two";
        expect(() => lossRunPool()).toThrow(/CLOCK_LOSS_WORKERS is a whole number of 0 or more, not "two"/);
        process.env[LOSS_WORKERS_VARIABLE] = "-1";
        expect(() => lossRunPool()).toThrow(/not "-1"/);
        process.env[LOSS_WORKERS_VARIABLE] = "0";
        expect(lossRunPool()).toBeNull();
        process.env[LOSS_WORKERS_VARIABLE] = "";
        expect(lossRunPool()).toBeNull();
    });
});
