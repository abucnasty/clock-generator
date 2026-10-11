// node scripts/margin-sample.js <out dir> <KEY>
// Whether each stable potential clock of one sample holds its expected output with its windows a tick shorter
// (GOALS.md, "Working Rules": margin comes before precision), as <out dir>/<KEY>.json. Every window of the clock loses
// its first tick in one trial and its last tick in another; a window of one tick is left as it is. Each trial is the
// check the generator makes of its own clocks (clockFromWindows), and so is a third with the windows unchanged, which
// has to hold for the other two to say anything. Simulator only. NON_MOVING=1 turns "Belts do not move" on.
// For all samples: scripts/margin-sweep.sh. The table: scripts/margin-table.py.
const path = require("path"), fs = require("fs");
const out = path.resolve(process.argv[2]);
const key = process.argv[3];
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, clockFromWindows } = dist("crafting/generate-blueprint.js");

/** The windows of a clock with a tick taken off each: "start" its first tick, "end" its last */
const shortened = (clock_windows, side) => Object.fromEntries(Object.entries(clock_windows).map(([entity_id, ranges]) =>
    [entity_id, ranges.map(range => range.start === range.end ? range
        : side === "start" ? { start: range.start + 1, end: range.end } : { start: range.start, end: range.end - 1 })]));

const holds = (config, clock_windows, period) => {
    const began = Date.now();
    try {
        const check = clockFromWindows(config, clock_windows, period, quiet).stability_check;
        return { holds: check.as_built?.is_stable ?? check.is_stable, items: check.as_built?.actual_output_items ?? check.actual_output_items, seconds: (Date.now() - began) / 1000 };
    } catch (e) {
        return { error: String(e && e.message || e).slice(0, 300), seconds: (Date.now() - began) / 1000 };
    }
};

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
        for (const alternative of alternatives.filter(a => a.verdict === "stable")) {
            const result = alternative.result;
            // a subtick clock and the same clock with its period rounded have the same windows
            if (tried.has(result.clock_windows)) {
                continue;
            }
            tried.add(result.clock_windows);
            const period = result.simulation_duration.ticks;
            // the config the clock was planned on: its output swings per cycle, and fractional swings the other way round
            const planned_on = { ...config, overrides: { ...config.overrides, terminal_swing_count: result.used_terminal_swing_count,
                ...(alternative.id.startsWith("fractional") ? { use_fractional_swings: config.overrides?.use_fractional_swings !== true } : {}) } };
            row.clocks.push({
                id: alternative.id, selected: alternative.id === row.selected, period, expected: result.stability_check.expected_output_items,
                window_count: Object.values(result.clock_windows).reduce((sum, ranges) => sum + ranges.length, 0),
                one_tick_windows: Object.values(result.clock_windows).reduce((sum, ranges) => sum + ranges.filter(r => r.start === r.end).length, 0),
                unchanged: holds(planned_on, result.clock_windows, period),
                shorter_at_start: holds(planned_on, shortened(result.clock_windows, "start"), period),
                shorter_at_end: holds(planned_on, shortened(result.clock_windows, "end"), period),
            });
        }
    } catch (e) {
        row.error = String(e && e.message || e).slice(0, 300);
    }
    row.seconds = Math.round((Date.now() - started) / 1000);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify(row, null, 1));
})();
