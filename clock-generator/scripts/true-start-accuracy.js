// node scripts/true-start-accuracy.js <recording.json> [...]   the true-start method against the input balance, per machine
//
// The yardstick of the true-start method (src/crafting/true-starts.ts, the series' true_events, which reads a dump's
// status and products_finished) on recordings of the game, which log a machine's item ingredients every tick. A craft
// consumes its ingredients, so a tick in which some item ingredient's balance falls is a consume:
//   consumed at t = count at t-1 + items dropped into the machine at t - count at t > 0
// with the drops read from the hands of the inserters that put into it (a hand that fell while holding that item).
// Counting the drops catches a consume on the tick an input drops, which the count alone hides. A machine with only
// fluid ingredients has no yardstick. The method runs on the recording cut to what a dump holds (status and
// products_finished), as the series' recording_check.py cuts it.
// Prints a JSON line a machine and a table: starts a minute by the method and by the balance, ticks only in one or the
// other, and the difference in % (base: the balance). The miss line is 5 a minute or 5%, whichever is larger.
// Needs `npx tsc` first.
const fs = require("fs");
const path = require("path");
const { dist } = require("./lib");

const CODES = { working: 1, full_output: 29 };
const MISS_PER_MINUTE = 5, MISS_SHARE = 0.05;

function expand(changes, n, map = x => x, initial = "") {
    const out = new Array(n);
    let cur = initial, j = 0;
    for (let t = 0; t < n; t++) {
        while (j < changes.length && changes[j][0] <= t) { cur = changes[j][1]; j++; }
        out[t] = map(cur);
    }
    return out;
}

const { FactorioDataService } = dist("data/factorio-data-service.js");
const { trueStartsOfDump } = dist("crafting/true-starts.js");
const rows = [];
for (const file of process.argv.slice(2)) {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    const n = r.sample_count, minutes = (n - 1) / 3600;
    for (const m of r.machines) {
        const c = r.config.machines.find(x => x.id === m.id);
        const recipe = FactorioDataService.findRecipeOrThrow(m.recipe);
        const delta = c.crafting_speed / (60 * recipe.energy_required), pb = (c.productivity ?? 0) / 100;
        const fluids = recipe.ingredients.filter(it => it.type === "fluid").map(it => it.name);
        const status = expand(m.samples.status, n, s => CODES[s] ?? 999, 0);
        const method = trueStartsOfDump(status, m.samples.products_finished, delta, pb, n).start;
        const items = Object.keys(m.samples.inputs);
        let yardstick = null;
        if (items.length > 0) {
            const dropped = Object.fromEntries(items.map(item => [item, new Float64Array(n)]));
            for (const ins of r.inserters.filter(i => i.sink.type === "machine" && i.sink.id === m.id)) {
                const held_item = expand(ins.samples.held_item, n);
                const held = ins.samples.held_count;
                for (let t = 1; t < n; t++) {
                    const item = held_item[t - 1];
                    if (held[t] < held[t - 1] && dropped[item]) dropped[item][t] += held[t - 1] - held[t];
                }
            }
            yardstick = new Array(n).fill(false);
            for (const item of items) {
                const count = m.samples.inputs[item];
                for (let t = 1; t < n; t++) {
                    if (count[t - 1] + dropped[item][t] - count[t] > 1e-9) yardstick[t] = true;
                }
            }
        }
        let starts = 0, consumes = 0, both = 0, method_only = 0, balance_only = 0;
        for (let t = 1; t < n; t++) {
            starts += method[t] ? 1 : 0;
            if (yardstick) {
                consumes += yardstick[t] ? 1 : 0;
                if (method[t] && yardstick[t]) both++;
                else if (method[t]) method_only++;
                else if (yardstick[t]) balance_only++;
            }
        }
        const diff = yardstick ? (starts - consumes) / minutes : null;
        const share = yardstick && consumes > 0 ? (starts - consumes) / consumes : null;
        const miss = yardstick ? Math.abs(diff) > Math.max(MISS_PER_MINUTE, MISS_SHARE * consumes / minutes) : null;
        rows.push({
            recording: path.basename(file), machine: m.id, name: m.name, recipe: m.recipe, delta, pb, item_ingredients: items,
            fluid_ingredients: fluids, minutes, method_per_minute: starts / minutes,
            balance_per_minute: yardstick ? consumes / minutes : null, both, method_only, balance_only,
            difference_per_minute: diff, difference_share: share, beyond_miss_line: miss,
        });
    }
}
const f = (x, d = 1) => x === null ? "-" : x.toFixed(d);
console.log("| Recording | Machine | Recipe | delta | pb | Ingredients (fluids) | Method a minute | Balance a minute | Ticks in both / method only / balance only | Difference a minute (%) | Beyond the miss line |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
    console.log(`| ${r.recording.replace(".json", "")} | ${r.machine} ${r.name} | ${r.recipe} | ${f(r.delta, 3)} | ${f(r.pb, 2)} | ${r.item_ingredients.join("+") || "-"} (${r.fluid_ingredients.join("+") || "-"}) | ${f(r.method_per_minute)} | ${f(r.balance_per_minute)} | ${r.balance_per_minute === null ? "-" : `${r.both} / ${r.method_only} / ${r.balance_only}`} | ${f(r.difference_per_minute)} (${r.difference_share === null ? "-" : (100 * r.difference_share).toFixed(1) + "%"}) | ${r.beyond_miss_line === null ? "no yardstick" : r.beyond_miss_line ? "YES" : "no"} |`);
}
if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(rows, null, 1));
