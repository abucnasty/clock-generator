// node scripts/backpressure-sample.js <out dir> <KEY>
// Whether each potential clock of one sample that holds its expected output survives backpressure loss (GOALS.md, "Backpressure Loss"), as
// <out dir>/<KEY>.json: for every loss of the build (each supplied item stops arriving, each output is not taken
// away) the fixed trials of src/crafting/backpressure-loss.ts, and whether the build is back at its expected output
// after each. A clock is tried no further than the first loss it does not get back from: the losses after it are
// listed as `not_tried`, and the trials of a loss that fails end at its first failing trial. Simulator only: the harness cannot cut a supply. BACKED_UP=1 turns "Backed-up belts" on;
// PLACES=0,0.5 cuts at fewer places in the period than the four of LOSS_PLACES, to make the run shorter.
// For all samples: scripts/backpressure-sweep.sh. The table: scripts/backpressure-table.py.
const path = require("path"), fs = require("fs");
const out = path.resolve(process.argv[2]);
const key = process.argv[3];
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, backpressureLossOf } = dist("crafting/generate-blueprint.js");
const { lossId } = dist("crafting/backpressure-loss.js");
const places = process.env.PLACES ? process.env.PLACES.split(",").map(Number) : undefined;

(async () => {
    const started = Date.now();
    const row = { key, clocks: [] };
    try {
        const config = await loadSample(key, process.env.BACKED_UP === "1");
        const generated = Date.now();
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        row.generate_seconds = (Date.now() - generated) / 1000;
        row.selected = alternatives[selected_index]?.id;
        row.selected_is_stable = alternatives[selected_index]?.verdict === "stable";
        // every clock that holds its expected output: "stable" already says whether it gets back from the losses
        for (const alternative of alternatives.filter(a => a.verdict !== "unstable")) {
            const result = alternative.result;
            const clock = { id: alternative.id, selected: alternative.id === row.selected, period: result.simulation_duration.ticks };
            const began = Date.now();
            try {
                // the config the clock was planned on: its output swings per cycle
                const planned_on = { ...config, overrides: { ...config.overrides, terminal_swing_count: result.used_terminal_swing_count } };
                const report = backpressureLossOf(planned_on, result.clock_windows, clock.period, result.stability_check.expected_output_items, quiet, { places });
                clock.holds_undisturbed = report.undisturbed.recovers;
                clock.survives = report.survives;
                clock.broken_by = report.broken_by;
                clock.not_tried = report.not_tried.map(lossId);
                clock.recovered_after_periods = report.recovered_after_periods;
                clock.ticks = report.ticks;
                clock.losses = report.losses.map(outcome => ({
                    loss: lossId(outcome.loss), recovers: outcome.recovers, stopped_after_ticks: outcome.stopped_after_ticks,
                    recovered_after_bins: outcome.recovered_after_bins, periods_per_bin: outcome.periods_per_bin,
                    trials: outcome.trials.map(t => ({
                        cut_at: t.cut_at, loss_ticks: t.loss_ticks, until_stopped: t.until_stopped, recovers: t.recovers,
                        recovered_after_bins: t.recovered_after_bins, proven: t.proven, ends_in: t.recovers ? undefined : t.ends_in.slice(0, 6),
                    })),
                }));
            } catch (e) {
                clock.error = String(e && e.message || e).slice(0, 300);
            }
            clock.seconds = (Date.now() - began) / 1000;
            row.clocks.push(clock);
        }
    } catch (e) {
        row.error = String(e && e.message || e).slice(0, 300);
    }
    row.seconds = Math.round((Date.now() - started) / 1000);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify(row, null, 1));
})();
