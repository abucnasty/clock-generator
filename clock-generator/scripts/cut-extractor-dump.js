// node scripts/cut-extractor-dump.js <dump base> <output base> [--samples 800] [--machines 3] [--gzip]
//         [--recipe automation-science-pack] [--belt-recipe copper-ore-melting]
// Cuts a small test fixture out of one of the inserter cost series' extractor dumps (a `<base>.static.ndjson` of the
// whole map, 60 MB, and a `<base>.samples.ndjson` with the states of the sampled area on every tick), in the same
// format, so that src/verification/extractor-dump.ts reads it and the series' fuller.py counts it unchanged.
//
// What it keeps, chosen from the structure of the dump (so two dumps of one layout keep the same entities):
//  - --machines assemblers of --recipe, evenly spread by unit number (the first, the middle, the last), with every
//    inserter that takes from them or puts into them: for automation science that is a copper plate input, a gear
//    input and a science output each (the inputs from foundries casting, the output onto a belt);
//  - the first inserter that takes from a belt into a machine of --belt-recipe (the ore-melting foundry's calcite);
//  - the static entities at the ends of those inserters, and the prototype lines (k "p") of their names, in the
//    order of the file (a later entity takes over a tile, so the order is kept);
//  - the sample header with `ticks` set to the cut length, and the inserters' (`si`) and machines' (`sm`) samples of
//    the kept entities over the first --samples samples. A change list is cut at the length and its first entry
//    stays, so the initial values are those of the dump.
// It writes `<output base>.static.ndjson` and `<output base>.samples.ndjson` (with --gzip, as .gz files).
const fs = require("fs");
const readline = require("readline");
const zlib = require("zlib");

const BELT = new Set(["transport-belt", "underground-belt", "splitter", "lane-splitter", "loader", "loader-1x1", "linked-belt"]);

function argument(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);
    return at < 0 ? fallback : process.argv[at + 1];
}

async function lines(path, each) {
    const input = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
    for await (const line of input) {
        each(line);
    }
}

/** A change list ([index, value, ...]) cut to the entries before `length` */
function cut(changes, length) {
    const out = [];
    for (let i = 0; i + 1 < changes.length && changes[i] < length; i += 2) {
        out.push(changes[i], changes[i + 1]);
    }
    return out;
}

async function main() {
    // the words that are not an option or its value
    const [base, output] = process.argv.slice(2).filter((a, i, all) =>
        !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && all[i - 1] !== "--gzip"));
    const samples = Number(argument("samples", 800));
    const machine_count = Number(argument("machines", 3));
    const recipe = argument("recipe", "automation-science-pack");
    const belt_recipe = argument("belt-recipe", "copper-ore-melting");
    const gzip = process.argv.includes("--gzip");
    if (!base || !output) {
        throw new Error("usage: node scripts/cut-extractor-dump.js <dump base> <output base> [--samples N] [--gzip]");
    }

    let header = null;
    const inserter_samples = new Map();
    const machine_samples = new Map();
    await lines(`${base}.samples.ndjson`, line => {
        const record = JSON.parse(line);
        if (record.k === "sh") header = record;
        else if (record.k === "si") inserter_samples.set(record.u, record);
        else if (record.k === "sm") machine_samples.set(record.u, record);
    });
    const length = Math.min(samples, header.ticks);

    const raw = new Map();
    const entities = new Map();
    const prototypes = [];
    await lines(`${base}.static.ndjson`, line => {
        if (line.startsWith('{"k":"e"')) {
            const e = JSON.parse(line);
            entities.set(e.u, e);
            raw.set(e.u, line);
        } else if (line.startsWith('{"k":"p"')) {
            prototypes.push({ name: JSON.parse(line).n, line });
        }
    });

    // the same tile map as the reader's, to find the entity an inserter's pickup or drop position is on
    const size = new Map();
    for (const { name, line } of prototypes) {
        const p = JSON.parse(line);
        if (p.tw !== undefined) size.set(name, Math.trunc(Number(p.tw)));
    }
    const tiles = new Map();
    for (const [u, e] of entities) {
        let s;
        if (["assembling-machine", "furnace", "rocket-silo"].includes(e.t)) s = size.get(e.n) ?? 3;
        else if (BELT.has(e.t) || e.t.includes("container") || e.t === "cargo-wagon") s = 1;
        else continue;
        const x0 = Math.floor(e.x - s / 2 + 1e-9);
        const y0 = Math.floor(e.y - s / 2 + 1e-9);
        for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) tiles.set(`${x0 + dx},${y0 + dy}`, u);
    }
    const end = (e, key, position) => {
        const v = e[key];
        if (Number.isInteger(v) && entities.has(v)) return v;
        const p = e[position];
        return p ? tiles.get(`${Math.floor(p[0])},${Math.floor(p[1])}`) ?? null : null;
    };

    const inserters = [...inserter_samples.keys()].filter(u => entities.has(u)).sort((a, b) => a - b).map(u => ({
        u, source: end(entities.get(u), "pt", "pp"), sink: end(entities.get(u), "dt", "dp"),
    }));
    const assemblers = [...machine_samples.keys()]
        .filter(u => entities.get(u)?.r === recipe && machine_samples.get(u).pf)
        .sort((a, b) => a - b);
    const picked = new Set();
    for (let i = 0; i < machine_count; i++) {
        const machine = assemblers[Math.round(i * (assemblers.length - 1) / Math.max(1, machine_count - 1))];
        for (const inserter of inserters) {
            if (inserter.source === machine || inserter.sink === machine) picked.add(inserter.u);
        }
    }
    const belt_fed = inserters.find(i =>
        i.source !== null && BELT.has(entities.get(i.source).t) && entities.get(i.sink)?.r === belt_recipe);
    if (belt_fed) picked.add(belt_fed.u);

    const kept = new Set();
    const chosen = inserters.filter(i => picked.has(i.u));
    for (const i of chosen) {
        kept.add(i.u);
        for (const e of [i.source, i.sink]) if (e !== null) kept.add(e);
    }
    const names = new Set([...kept].map(u => entities.get(u).n));

    const kept_samples = [];
    for (const i of chosen) {
        const record = { ...inserter_samples.get(i.u) };
        for (const key of ["s", "h", "it"]) if (record[key]) record[key] = cut(record[key], length);
        kept_samples.push(record);
    }
    const kept_machines = [...kept].filter(u => machine_samples.has(u)).sort((a, b) => a - b);
    for (const u of kept_machines) {
        const record = { ...machine_samples.get(u) };
        for (const key of ["s", "pf"]) if (record[key]) record[key] = cut(record[key], length);
        kept_samples.push(record);
    }
    const out_header = { ...header, ticks: length, inserters: chosen.length, machines: kept_machines.length };

    const static_lines = [JSON.stringify({
        k: "cut", from: base.split("/").pop(), samples: length, recipe, belt_recipe,
        note: "a cut of an extractor dump by scripts/cut-extractor-dump.js",
    })];
    for (const { name, line } of prototypes) if (names.has(name)) static_lines.push(line);
    for (const u of entities.keys()) if (kept.has(u)) static_lines.push(raw.get(u));
    const sample_lines = [JSON.stringify(out_header), ...kept_samples.map(r => JSON.stringify(r))];

    for (const [suffix, text] of [["static", static_lines], ["samples", sample_lines]]) {
        const content = text.join("\n") + "\n";
        if (gzip) fs.writeFileSync(`${output}.${suffix}.ndjson.gz`, zlib.gzipSync(content, { level: 9 }));
        else fs.writeFileSync(`${output}.${suffix}.ndjson`, content);
    }
    console.log(`${chosen.length} inserters (${belt_fed ? "with" : "without"} a belt-fed one), ${kept_machines.length} machines, ` +
        `${kept.size} entities, ${length} samples`);
}

main().catch(e => { console.error(e); process.exit(1); });
