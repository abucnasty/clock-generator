// node scripts/clock-start-sample.js <out dir> <KEY>
// Whether each stable potential clock of one sample holds when it is started on a build that runs without a clock
// (clockStartOf in src/crafting/generate-blueprint.ts), as <out dir>/<KEY>.json: every inserter is always enabled for
// 3,600 ticks, the clock is started at each of the four places in its period the loss trials use, and the build has to
// be at exactly its expected output within 40 periods and stay there. Simulator only. NON_MOVING=1 turns "Belts do
// not move" on; ALL=1 tries the clocks that are not stable as well, against the output their period expects.
// For all samples: scripts/clock-start-sweep.sh. The table: scripts/clock-start-table.py.
const path = require("path"), fs = require("fs");
const out = path.resolve(process.argv[2]);
const key = process.argv[3];
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, clockStartOf } = dist("crafting/generate-blueprint.js");

(async () => {
    const started = Date.now();
    const row = { key, clocks: [] };
    try {
        const config = await loadSample(key, process.env.NON_MOVING === "1");
        const generated = Date.now();
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        row.generate_seconds = (Date.now() - generated) / 1000;
        row.selected = alternatives[selected_index]?.id;
        const tried = new Set();
        for (const alternative of alternatives.filter(a => a.is_stable || process.env.ALL === "1")) {
            const result = alternative.result;
            // a subtick clock and the same clock with its period rounded have the same windows
            if (tried.has(result.clock_windows)) {
                continue;
            }
            tried.add(result.clock_windows);
            const clock = { id: alternative.id, selected: alternative.id === row.selected, is_stable: alternative.is_stable,
                period: result.simulation_duration.ticks, expected: result.stability_check.expected_output_items };
            const began = Date.now();
            try {
                // the config the clock was planned on: its output swings per cycle, and fractional swings the other way round
                const planned_on = { ...config, overrides: { ...config.overrides, terminal_swing_count: result.used_terminal_swing_count,
                    ...(alternative.id.startsWith("fractional") ? { use_fractional_swings: config.overrides?.use_fractional_swings !== true } : {}) } };
                const outcome = clockStartOf(planned_on, result.clock_windows, clock.period, clock.expected, quiet);
                clock.holds = outcome.recovers;
                clock.back_after_periods = outcome.recovered_after_bins === null ? null : outcome.recovered_after_bins * outcome.periods_per_bin;
                clock.expected_per_bin = outcome.expected_per_bin;
                clock.ticks = outcome.ticks;
                clock.starts = outcome.trials.map(t => ({
                    place: t.cut_at, recovers: t.recovers, back_after_bins: t.recovered_after_bins, proven: t.proven,
                    ends_in: t.recovers ? undefined : t.ends_in.slice(0, 6),
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
