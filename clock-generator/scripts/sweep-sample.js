// node scripts/sweep-sample.js <out dir> <KEY>
// Every potential clock of one sample, as <out dir>/<KEY>.json: verdict, rate, wake-ups, belt and windows of each, and
// which one is selected. NON_MOVING=1 turns "Belts do not move" on. See sweep.sh for all samples.
const path = require("path"), fs = require("fs");
const out = path.resolve(process.argv[2]);
const key = process.argv[3];
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, clockBeltLabel } = dist("crafting/generate-blueprint.js");
const { describeSharedItem } = dist("crafting/deadlock-risk.js");

(async () => {
    const started = Date.now();
    const row = { key };
    try {
        const config = await loadSample(key, process.env.NON_MOVING === "1");
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        row.selected = alternatives[selected_index]?.id;
        // of the build, the same for every clock: two inserters that bring the same item to a machine
        row.deadlock_risks = (alternatives[0]?.deadlock_risks ?? []).map(describeSharedItem);
        row.alternatives = alternatives.map(a => ({
            id: a.id, label: a.label, is_stable: a.is_stable, holds_expected_output: a.holds_expected_output,
            broken_by: a.backpressure_loss?.broken_by ?? null, meets_target_rate: a.meets_target_rate,
            matches_belt_choice: a.matches_belt_choice, items_per_second: a.items_per_second,
            wake_ups_per_minute: a.wake_ups_per_minute, belt: a.belt === null ? null : clockBeltLabel(a.belt),
            period: a.result.simulation_duration.ticks, window_count: a.inserter_window_count,
            windows: Object.fromEntries(Object.entries(a.result.clock_windows).map(([k, v]) => [k, v.map(r => `${r.start}-${r.end}`).join(",")])),
        }));
    } catch (e) {
        row.error = String(e && e.message || e).slice(0, 300);
    }
    row.seconds = Math.round((Date.now() - started) / 1000);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify(row, null, 1));
})();
