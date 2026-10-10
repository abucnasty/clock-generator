// node scripts/clock-only.js <KEY> <swings|-> <never|always|auto> <periods> <output inserter id> [options]
// Makes batched swings for a sample and runs the clock on its own, as the blueprint does in game.
//   <swings>     output swings per cycle to force, - for the planned count
//   <never|...>  belt pickup slack
//   --windows '<json>'           windows to run instead, by entity id: {"inserter:11":[{"start":0,"end":42}]}
//   --hands <inserter> <machine> every hand that inserter drops, a line a period: where in which of its windows
//                                it started to fill, grew, was full and dropped, and what the machine held then.
//                                Long lines: pipe through `cut -c1-900`.
// Prints the windows and what the output inserter dropped in each period.
const args = process.argv.slice(2);
const [key, swings, slack, periods, out] = args;
const option = name => { const at = args.indexOf(name); return at < 0 ? null : args.slice(at + 1); };
const { dist, quiet, loadSample } = require("./lib");
const { generateClockForConfig, simulateClockOnly } = dist("crafting/generate-blueprint.js");

(async () => {
    const config = await loadSample(key);
    if (swings !== "-") {
        config.overrides = { ...config.overrides, terminal_swing_count: Number(swings) };
    }
    const result = generateClockForConfig(config, { logger: quiet, belt_pickup_slack: slack });
    const period = result.simulation_duration.ticks;
    const override = option("--windows");
    const windows = { ...result.clock_windows, ...(override ? JSON.parse(override[0]) : {}) };
    console.log(`period ${period}, expected ${result.stability_check.expected_output_items} a period`);
    for (const [entity_id, ranges] of Object.entries(windows)) {
        console.log("  ", entity_id, ranges.map(r => `${r.start}-${r.end}`).join(","));
    }
    const stock = simulateClockOnly(config, windows, period, Number(periods), quiet);

    const hands = option("--hands");
    if (hands) {
        const series = stock.inserters.find(s => s.inserter_id === `inserter:${hands[0]}`);
        const machine = stock.machines.find(m => m.machine_id === `machine:${hands[1]}`);
        const own = windows[`inserter:${hands[0]}`] ?? [];
        // sample i of the run is two ticks after the clock position its windows are counted in
        const where = i => {
            const position = ((i - 2) % period + period) % period;
            const index = own.findIndex(r => position >= r.start && position <= r.end);
            return index < 0 ? `out(${position})` : `w${index}+${position - own[index].start}`;
        };
        let line = [];
        for (let i = 1; i < stock.ticks; i++) {
            const held = series.held[i], before = series.held[i - 1];
            if (held > before && before === 0) {
                line.push(`[p${Math.floor(i / period)} ${where(i)} ${series.held_item[i].slice(0, 4)}`);
            } else if (held > before) {
                line.push(`+${held - before}@${where(i)}`);
            }
            if (held < before) {
                const stock_then = Object.entries(machine.inputs).map(([item, values]) => `${item.slice(0, 4)}=${values[i]}`).join(" ");
                line.push(`drop ${before - held} at ${where(i)} fuel=${machine.fuel ? machine.fuel[i] : "-"} ${stock_then}]`);
            }
            if (i % period === period - 1 || i === stock.ticks - 1) {
                console.log(line.join(" "));
                line = [];
            }
        }
    }

    const output = stock.inserters.find(s => s.inserter_id === `inserter:${out}`);
    const per_period = [];
    let moved = 0;
    for (let i = 1; i < stock.ticks; i++) {
        if (output.held[i] < output.held[i - 1]) {
            moved += output.held[i - 1] - output.held[i];
        }
        if (i % period === period - 1) {
            per_period.push(moved);
            moved = 0;
        }
    }
    const tally = {};
    per_period.forEach(items => tally[items] = (tally[items] ?? 0) + 1);
    console.log(`inserter ${out} dropped per period:`, JSON.stringify(tally), "first period under the first one's:", per_period.findIndex(items => items < per_period[0]));
})().catch(e => { console.error(e); process.exit(1); });
