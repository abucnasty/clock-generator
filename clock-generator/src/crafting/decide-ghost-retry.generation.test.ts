import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";
import type { MakerLogEvent } from "./maker-log";
import type { GenerateClockOptions, GenerationProgress } from "./plan/unclocked-run";
import { observeFills, type FillReport } from "./runner/steps/backpressure-fill-step";
import { withTickLedger, type TickLedgerCount } from "./tick-ledger";

const shiftedWorkOf = (ledger: TickLedgerCount) => ledger.rows
    .filter(row => row.maker === "fractional" && row.purpose === "start_phase")
    .map(({ loop, runs, ticks }) => ({ loop, runs, ticks }));

it("keeps the better ghost wakeup retry without repeating the losing trial's shifted start", async () => {
    const config = await loadConfigFromFile(ConfigPaths.ELECTRIC_FURNACE_20);
    const generate = () => {
        const events: MakerLogEvent[] = [];
        let ledger: TickLedgerCount | undefined;
        const result = withTickLedger(count => { ledger = count; }, () => generateClockAlternatives(config, {
            logger: quiet,
            maker_log: event => { if (event.event !== "seconds") events.push(event); },
        }));
        return { result, events, ledger: ledger! };
    };

    // The fill observer is the ordinary way to request every fill, including a losing attempt's.
    const fills: FillReport[] = [];
    const stopObserving = observeFills(report => { fills.push(report); });
    let observed: ReturnType<typeof generate>;
    try {
        observed = generate();
    } finally {
        stopObserving();
    }
    const unobserved = generate();

    expect(fills.length).toBeGreaterThan(0);
    expect(unobserved.result).toEqual(observed.result);
    expect(unobserved.events).toEqual(observed.events);
    expect(unobserved.ledger.memo_hits).toEqual(observed.ledger.memo_hits);
    expect(shiftedWorkOf(observed.ledger)).toEqual([
        { loop: "prepare_step", runs: 48, ticks: 9072 },
        { loop: "warmup_step", runs: 24, ticks: 207360 },
        { loop: "simulate_step", runs: 24, ticks: 20736 },
    ]);
    expect(shiftedWorkOf(unobserved.ledger)).toEqual([
        { loop: "prepare_step", runs: 46, ticks: 8694 },
        { loop: "warmup_step", runs: 23, ticks: 198720 },
        { loop: "simulate_step", runs: 23, ticks: 19872 },
    ]);
});

it("reports shifted starts to a progress callback registered during generation", async () => {
    const config = await loadConfigFromFile(ConfigPaths.ELECTRIC_FURNACE_20);
    const reports: GenerationProgress[] = [];
    const options: GenerateClockOptions = { logger: quiet };
    let fills = 0;
    // The fiftieth fill is in Euclidean Swings. Register for progress there and stop observing fills.
    const stopObserving = observeFills(() => {
        if (++fills !== 50) return;
        options.on_progress = progress => { reports.push(progress); };
        stopObserving();
    });
    try {
        generateClockAlternatives(config, options);
    } finally {
        stopObserving();
    }
    expect(reports).toHaveLength(24);
    expect(reports.filter(report => report.step === "Euclidean Swings" && report.detail === "Checking clock-only output, clock start 2/12"))
        .toHaveLength(3);
});
