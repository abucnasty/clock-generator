// node scripts/check-true-starts.js <dumps.txt> <counts dir> <log file> [<recordings dir> <recording_check.txt>] [--only label,label]
//
// The check of the true starts (src/crafting/true-starts.ts, read by src/verification/extractor-dump.ts) against the
// inserter cost series' productivity-recount-1 (closing/evidence/productivity-recount-1: common.py, truecount.py,
// recording_check.py). For every line of dumps.txt ("label static_base [samples_base]") the generator reads the dump and
// counts each inserter group in true starts, version A, as truecount.py does:
//   e_src_g  waiting for source (or more) at t-1 and the source machine's products_finished rose at t;
//   e_dst_T  waiting for space at t-1 and the sink machine truly started a craft at t, not on the inserter's own drop (a
//            machine without params counts its locked starts: a finish, or the status turning to working; the 3%
//            fallback to finishes);
//   e_pick_A a pickup with no e_src_g, e_dst_T or disabled index at t to t-3.
// They must be INTEGER-EQUAL to counts/t-<label>.json on every group (key: role, items, recipes; wired and unwired
// inserters summed). The per machine figures (true starts, crafts out, rises, locked starts, working ticks, resyncs,
// misses, the phase fit) are laid against the `machines` summary of the same JSON, which is by name, recipe, delta and
// productivity. The machines without params are listed by recipe for every dump.
//
// With a recordings directory and the series' recording_check.txt, true starts inferred from status and
// products_finished (the two advanced circuit recordings cut as recording_check.py cuts them) are laid tick by tick
// against the starts read from crafting_progress, and the figures against recording_check.txt.
//
// Needs `npx tsc` first. Reads one dump at a time. Exits 1 when anything differs.
const fs = require("fs");
const path = require("path");
const { dist } = require("./lib");

const OFF = "disabled_by_control_behavior";
const WAITING_FOR_SOURCE = new Set(["waiting_for_source_items", "waiting_for_more_items"]);
const WAITING_FOR_SPACE = "waiting_for_space_in_destination";
const PICKUP_WINDOW = 3;
const LOCKED_TOLERANCE = 0.03;

/** The series' locked starts of a machine (fuller.py): finishes plus the change of working, or the finishes alone (>3% apart) */
function lockedStarts(products_finished, working, n) {
    const finished = new Uint8Array(n);
    const starts = new Uint8Array(n);
    let nf = 0, ns = 0;
    for (let t = 1; t < n; t++) {
        finished[t] = products_finished[t] > products_finished[t - 1] ? 1 : 0;
        starts[t] = finished[t] + (working[t] ? 1 : 0) - (working[t - 1] ? 1 : 0) > 0 ? 1 : 0;
        nf += finished[t];
        ns += starts[t];
    }
    return { finished, locked: nf > 0 && Math.abs(ns - nf) / nf > LOCKED_TOLERANCE ? finished : starts };
}

/** truecount.py's picks(): pickups with no event, and no disabled index, at t to t-3 */
function pickups(pick, event, off, n) {
    const near = new Uint8Array(n);
    for (let t = 0; t < n; t++) near[t] = event[t] || off[t] ? 1 : 0;
    const nr = near.slice();
    for (let k = 1; k <= PICKUP_WINDOW; k++) for (let t = k; t < n; t++) nr[t] |= near[t - k];
    let count = 0;
    for (let t = 0; t < n; t++) count += pick[t] && !nr[t] ? 1 : 0;
    return count;
}

/** The series' groups of a dump (truecount.py's inserter loop), version A, from the generator's reading of it */
function groupsOf(dump) {
    const n = dump.ticks;
    const events = new Map();
    for (const m of dump.machines) {
        const { finished, locked } = lockedStarts(m.products_finished, m.working, n);
        events.set(m.machine_id, { finished, start: m.true_starts ? Uint8Array.from(m.true_starts, v => v ? 1 : 0) : locked });
    }
    const groups = new Map();
    for (const ins of dump.inserters) {
        const key = `${ins.source_kind} to ${ins.sink_kind} | ${ins.items.join("+") || "-"} | ${ins.source_recipe} > ${ins.sink_recipe}`;
        const g = groups.get(key) ?? { inserters: 0, e_src_g: 0, e_dst_T: 0, e_pick_A: 0 };
        groups.set(key, g);
        g.inserters++;
        const source = ins.source_machine_id === null ? undefined : events.get(ins.source_machine_id);
        const sink = ins.sink_machine_id === null ? undefined : events.get(ins.sink_machine_id);
        const src = new Uint8Array(n), dst = new Uint8Array(n), pick = new Uint8Array(n), off = new Uint8Array(n);
        for (let t = 0; t < n; t++) off[t] = ins.states[t] === OFF ? 1 : 0;
        for (let t = 1; t < n; t++) {
            const own_drop = ins.held[t] < ins.held[t - 1];
            pick[t] = ins.held[t] > ins.held[t - 1] ? 1 : 0;
            if (source && source.finished[t] && WAITING_FOR_SOURCE.has(ins.states[t - 1])) src[t] = 1;
            if (sink && sink.start[t] && ins.states[t - 1] === WAITING_FOR_SPACE && !own_drop) dst[t] = 1;
            g.e_src_g += src[t];
            g.e_dst_T += dst[t];
        }
        if (source) {
            const event = src.map((v, t) => v | dst[t]);
            g.e_pick_A += pickups(pick, event, off, n);
        }
    }
    return groups;
}

/** The machines of a dump with params, summed by series' key (name, recipe, delta to 4 places, productivity) */
function machineSummary(dump) {
    const summary = new Map();
    for (const m of dump.machines) {
        if (!m.crafting) continue;
        const c = m.crafting;
        const key = `${m.name} | ${m.recipe} | delta ${c.delta.toFixed(4)} | pb ${Number(c.productivity_bonus)}`;
        const s = summary.get(key) ?? { machines: 0, rise: 0, locked: 0, true: 0, out: 0, implied: 0, work: 0, resync: 0, miss: 0, phase_viol: 0, phase_ambiguous: 0 };
        summary.set(key, s);
        const n = dump.ticks;
        const { finished, locked } = lockedStarts(m.products_finished, m.working, n);
        s.machines++;
        for (let t = 1; t < n; t++) {
            s.rise += finished[t];
            s.locked += locked[t];
            s.true += m.true_starts[t] ? 1 : 0;
            s.work += m.working[t] ? 1 : 0;
        }
        s.out += c.craft_out_count;
        s.implied += (m.products_finished[n - 1] - m.products_finished[0]) / (1 + c.productivity_bonus);
        s.resync += c.diag.resync;
        s.miss += c.diag.miss;
        s.phase_viol += c.diag.phase_viol;
        s.phase_ambiguous += c.diag.phase_ties > 1 ? 1 : 0;
    }
    return summary;
}

/** The series' machine summary keyed as machineSummary keys it (the pb read as a number) */
function seriesMachines(machines) {
    const out = new Map();
    for (const [key, value] of Object.entries(machines)) {
        const [name, recipe, delta, pb] = key.split(" | ");
        out.set(`${name} | ${recipe} | ${delta} | pb ${Number(pb.slice(3))}`, value);
    }
    return out;
}

async function checkDump(line, counts_dir, out) {
    const [label, static_base, samples_base] = line.split(/\s+/);
    const { readExtractorDump } = dist("verification/extractor-dump.js");
    const started = Date.now();
    const dump = await readExtractorDump(static_base, samples_base ?? static_base);
    const read_ms = Date.now() - started;
    const problems = [];
    const groups = groupsOf(dump);
    const series = JSON.parse(fs.readFileSync(path.join(counts_dir, `t-${label}.json`), "utf8"));
    if (series.ticks !== dump.ticks) problems.push(`ticks ${dump.ticks} against ${series.ticks}`);
    const expected = new Map();
    for (const g of series.groups) {
        const key = `${g.role} | ${g.items} | ${g.recipes}`;
        const e = expected.get(key) ?? { inserters: 0, e_src_g: 0, e_dst_T: 0, e_pick_A: 0 };
        expected.set(key, e);
        for (const f of Object.keys(e)) e[f] += g[f] ?? 0;
    }
    let matched = 0;
    for (const key of new Set([...expected.keys(), ...groups.keys()])) {
        const e = expected.get(key), o = groups.get(key);
        if (!e || !o) { problems.push(`group ${key} only in ${e ? "the series" : "the generator"}`); continue; }
        const different = Object.keys(e).filter(f => e[f] !== o[f]);
        if (different.length === 0) matched++;
        else problems.push(`group ${key}: ${different.map(f => `${f} ${o[f]} against ${e[f]}`).join(", ")}`);
    }
    // the machines, laid against the series' summary
    const mine = machineSummary(dump);
    const theirs = seriesMachines(series.machines);
    let machine_keys_matched = 0;
    for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
        const a = mine.get(key), b = theirs.get(key);
        if (!a || !b) { problems.push(`machines ${key} only in ${b ? "the series" : "the generator"}`); continue; }
        const different = Object.keys(a).filter(f => f === "implied" ? Math.abs(a[f] - b[f]) > 1e-6 * Math.max(1, Math.abs(b[f])) : a[f] !== b[f]);
        if (different.length === 0) machine_keys_matched++;
        else problems.push(`machines ${key}: ${different.map(f => `${f} ${a[f]} against ${b[f]}`).join(", ")}`);
    }
    // the machines without params, by recipe
    const without = new Map();
    let coarse = 0, ties_max = 0, with_params = 0;
    for (const m of dump.machines) {
        if (m.crafting) {
            with_params++;
            coarse += m.crafting.diag.phase_coarse ? 1 : 0;
            ties_max = Math.max(ties_max, m.crafting.diag.phase_ties);
            continue;
        }
        const k = `${m.recipe || "(no recipe)"} [${m.name}; ${m.no_params_reason}]`;
        without.set(k, (without.get(k) ?? 0) + 1);
    }
    const total_ms = Date.now() - started;
    out(`## ${label}: ${dump.source}, ${dump.ticks} samples, ${dump.inserters.length} inserters in ${groups.size} groups, ${dump.machines.length} machines`);
    out(`  groups matched ${matched} of ${new Set([...expected.keys(), ...groups.keys()]).size} (e_src_g, e_dst_T, e_pick_A, inserters, integer-equal)`);
    out(`  machine summary keys matched ${machine_keys_matched} of ${new Set([...mine.keys(), ...theirs.keys()]).size}; machines with params ${with_params}, phase coarse ${coarse}, most phase ties ${ties_max}`);
    out(`  machines without params: ${without.size === 0 ? "none" : [...without].map(([k, c]) => `${c} x ${k}`).join("; ")}`);
    out(`  read ${read_ms} ms, with the counts ${total_ms} ms`);
    for (const p of problems) out(`  FAIL ${p}`);
    return problems.length;
}

// ---- the recordings -----------------------------------------------------------------------------------------------
const CODES = {
    working: 1, full_output: 29, item_ingredient_shortage: 28, fluid_ingredient_shortage: 27,
    waiting_for_source_items: 34, waiting_for_more_items: 35, waiting_for_space_in_destination: 36, disabled_by_control_behavior: 59,
};
/** Recipe energies in seconds (game data), as recording_check.py has them */
const RECIPE_ENERGY = { "advanced-circuit": 6.0, "casting-copper-cable": 1.0, "plastic-bar": 1.0 };

function expandStatus(changes, n) {
    const out = new Array(n);
    let current = 0, j = 0;
    for (let t = 0; t < n; t++) {
        while (j < changes.length && changes[j][0] <= t) { current = CODES[changes[j][1]] ?? 999; j++; }
        out[t] = current;
    }
    return out;
}

function checkRecording(file, expected_text, out) {
    const { trueStartsOfDump, trueStartsOfProgress } = dist("crafting/true-starts.js");
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const n = d.sample_count;
    const name = path.basename(file);
    const config = new Map(d.config.machines.map(m => [m.id, m]));
    // recording_check.txt's tick-by-tick figures of this recording, per machine id
    const wanted = new Map();
    let section = false;
    for (const line of expected_text.split("\n")) {
        if (line.startsWith("## ")) section = line.startsWith(`## ${name}`);
        const m = section && line.match(/^ {2}machine (\d+) .*tick-by-tick: both (\d+), method only (\d+), truth only (\d+)/);
        if (m) wanted.set(Number(m[1]), { both: Number(m[2]), only_method: Number(m[3]), only_truth: Number(m[4]) });
    }
    let problems = 0;
    out(`## ${name}: ${n} samples`);
    for (const machine of d.machines) {
        const c = config.get(machine.id);
        const delta = c.crafting_speed / (60 * RECIPE_ENERGY[machine.recipe]);
        const pb = c.productivity / 100;
        const s = machine.samples;
        const result = trueStartsOfDump(expandStatus(s.status, n), s.products_finished, delta, pb, n);
        const truth = trueStartsOfProgress(s.crafting_progress, delta, n);
        let both = 0, only_method = 0, only_truth = 0;
        for (let t = 1; t < n; t++) {
            both += result.start[t] && truth[t] ? 1 : 0;
            only_method += result.start[t] && !truth[t] ? 1 : 0;
            only_truth += truth[t] && !result.start[t] ? 1 : 0;
        }
        // crafts out against the progress falling on a rise (delta < 1), as recording_check.py reads them
        let out_both = 0, out_method = 0, out_truth = 0;
        if (delta < 1) {
            for (let t = 1; t < n; t++) {
                const rise = s.products_finished[t] > s.products_finished[t - 1];
                const from_progress = rise && s.crafting_progress[t] < s.crafting_progress[t - 1];
                out_both += result.craft_out[t] && from_progress ? 1 : 0;
                out_method += result.craft_out[t] && !from_progress ? 1 : 0;
                out_truth += from_progress && !result.craft_out[t] ? 1 : 0;
            }
        }
        const want = wanted.get(machine.id);
        const agrees = only_method === 0 && only_truth === 0 && out_method === 0 && out_truth === 0
            && want && want.both === both && want.only_method === only_method && want.only_truth === only_truth;
        if (!agrees) problems++;
        out(`  machine ${machine.id} ${machine.recipe} delta ${delta.toFixed(4)} pb ${pb.toFixed(2)}: starts both ${both}, method only ${only_method}, truth only ${only_truth}`
            + (want ? ` (recording_check.txt: ${want.both}/${want.only_method}/${want.only_truth})` : " (not in recording_check.txt)")
            + (delta < 1 ? `; crafts out both ${out_both}, method only ${out_method}, truth only ${out_truth}` : "")
            + `; diag ${JSON.stringify(result.diag)}${agrees ? "" : "  FAIL"}`);
    }
    return problems;
}

(async () => {
    const args = process.argv.slice(2);
    const only_at = args.indexOf("--only");
    const only = only_at < 0 ? null : new Set(args.splice(only_at, 2)[1].split(","));
    const [dumps_path, counts_dir, log_path, recordings_dir, recording_check] = args;
    if (!dumps_path || !counts_dir || !log_path) {
        console.error("usage: node scripts/check-true-starts.js <dumps.txt> <counts dir> <log file> [<recordings dir> <recording_check.txt>] [--only label,label]");
        process.exit(2);
    }
    const lines = [];
    const out = text => { console.log(text); lines.push(text); };
    const started = Date.now();
    let failures = 0, checked = 0;
    for (const line of fs.readFileSync(dumps_path, "utf8").split("\n").filter(l => l.trim() !== "")) {
        if (only && !only.has(line.split(/\s+/)[0])) continue;
        failures += await checkDump(line, counts_dir, out);
        checked++;
    }
    if (recordings_dir && recording_check) {
        const expected_text = fs.readFileSync(recording_check, "utf8");
        for (const name of ["ADVANCED_CIRCUIT-unclocked.json", "ADVANCED_CIRCUIT-clocked.json"]) {
            failures += checkRecording(path.join(recordings_dir, name), expected_text, out);
        }
    }
    out(`${checked} dumps checked in ${((Date.now() - started) / 1000).toFixed(1)} s: ${failures === 0 ? "ALL AGREE" : `${failures} FAILURES`}`);
    fs.mkdirSync(path.dirname(log_path), { recursive: true });
    fs.writeFileSync(log_path, lines.join("\n") + "\n");
    process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
