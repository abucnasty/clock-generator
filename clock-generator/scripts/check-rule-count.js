// node scripts/check-rule-count.js <pairs.json> <series-removed.json> [out.json]
//
// The check of the rule count against the inserter cost series' own recount, before a release is tagged. For each pair
// of dumps (unwired and clocked) in pairs.json, the generator reads both dumps (src/verification/extractor-dump.ts),
// counts them (ruleCount) and lays each group's source, sink and pickup wake-ups against the series' fuller.py output
// for the same dump: they must be equal. It then lays w removed per group and pooled (removedBetween) against the
// series' removed(), computed by the series' own code from its fuller.py outputs (series-removed.json): they must agree
// within 0.5 a minute, in the same region of the rule. The start-rule fallback machines must be the same.
//
// pairs.json: { pairs: [{ name, unwired: { base, samples_base?, fuller_json }, clocked: { ... } }] }
// series-removed.json: [{ name, pooled, groups: [{ key, w_removed }] }]
// Needs `npx tsc` first. Reads one dump at a time.
const fs = require("fs");
const { dist } = require("./lib");

const TOLERANCE = 0.5;

(async () => {
    const [pairs_path, series_path, out_path] = process.argv.slice(2);
    if (!pairs_path || !series_path) {
        console.error("usage: node scripts/check-rule-count.js <pairs.json> <series-removed.json> [out.json]");
        process.exit(2);
    }
    const { readExtractorDump } = dist("verification/extractor-dump.js");
    const { ruleCount } = dist("crafting/rule-count.js");
    const { removedBetween, ruleCallOf } = dist("crafting/rule-call.js");
    const pairs = JSON.parse(fs.readFileSync(pairs_path, "utf8")).pairs;
    const series = new Map(JSON.parse(fs.readFileSync(series_path, "utf8")).map(p => [p.name, p]));
    const report = [];
    let failures = 0;
    const fail = (what) => { failures++; console.log(`  FAIL ${what}`); };

    for (const pair of pairs) {
        console.log(`## ${pair.name}`);
        const runs = {};
        for (const side of ["unwired", "clocked"]) {
            const spec = pair[side];
            const dump = await readExtractorDump(spec.base, spec.samples_base ?? spec.base);
            const run = ruleCount(dump.inserters, dump.machines, 0, dump.ticks);
            runs[side] = run;
            // the counts against fuller.py's for the same dump, wired and unwired inserters of a key summed
            const fuller = JSON.parse(fs.readFileSync(spec.fuller_json, "utf8"));
            const expected = new Map();
            for (const g of fuller.groups) {
                const key = `${g.role} | ${g.items} | ${g.recipes}`;
                const e = expected.get(key) ?? { n: 0, src: 0, dst: 0, pick: 0 };
                e.n += g.inserters; e.src += g.e_src_g ?? 0; e.dst += g.e_dst_g ?? 0; e.pick += g.e_pick_g ?? 0;
                expected.set(key, e);
            }
            const ours = new Map(run.groups.map(g => [g.key, g]));
            for (const key of new Set([...expected.keys(), ...ours.keys()])) {
                const e = expected.get(key), o = ours.get(key);
                if (!e || !o) { fail(`${side}: group ${key} only in ${e ? "fuller.py" : "the generator"}`); continue; }
                if (e.n !== o.inserters || e.src !== o.source_wake_ups || e.dst !== o.sink_wake_ups || e.pick !== o.pickups) {
                    fail(`${side}: ${key}: generator n ${o.inserters} ${o.source_wake_ups}/${o.sink_wake_ups}/${o.pickups}, fuller.py n ${e.n} ${e.src}/${e.dst}/${e.pick}`);
                }
            }
            if (Math.abs(run.minutes - fuller.minutes) > 1e-9) fail(`${side}: minutes ${run.minutes} against ${fuller.minutes}`);
            const fb_ours = {};
            for (const m of run.start_rule_fallback) {
                fb_ours[m.recipe] = (fb_ours[m.recipe] ?? 0) + 1;
            }
            const fb_theirs = {};
            for (const [k, c] of Object.entries(fuller.start_rule_fallback ?? {})) {
                const recipe = k.split(" ").slice(1).join(" ");
                fb_theirs[recipe] = (fb_theirs[recipe] ?? 0) + c;
            }
            if (JSON.stringify(Object.entries(fb_ours).sort()) !== JSON.stringify(Object.entries(fb_theirs).sort())) {
                fail(`${side}: start-rule fallback ${JSON.stringify(fb_ours)} against ${JSON.stringify(fb_theirs)}`);
            }
        }
        const removal = removedBetween(runs.unwired, runs.clocked);
        const theirs = series.get(pair.name);
        const rows = [];
        const theirs_by = new Map(theirs.groups.map(g => [g.key, g.w_removed]));
        for (const g of removal.groups.filter(g => g.newly_wired)) {
            const t = theirs_by.get(g.key);
            const region_ours = g.call.region, region_theirs = t === undefined ? "-" : ruleCallOf(t).region;
            const diff = t === undefined ? null : g.w_removed - t;
            rows.push({ group: g.key, inserters: g.inserters_clocked, generator: g.w_removed, series: t ?? null, difference: diff, region: region_ours, region_series: region_theirs });
            if (t === undefined || Math.abs(diff) > TOLERANCE || region_ours !== region_theirs) fail(`removed ${g.key}: ${g.w_removed} against ${t}`);
        }
        if (removal.groups.filter(g => g.newly_wired).length !== theirs.groups.length) fail(`newly wired groups ${removal.groups.filter(g => g.newly_wired).length} against ${theirs.groups.length}`);
        const pooled_diff = removal.w_removed_pooled - theirs.pooled;
        rows.push({ group: "design, a wired inserter (pooled)", inserters: removal.newly_wired_inserters, generator: removal.w_removed_pooled, series: theirs.pooled, difference: pooled_diff, region: removal.call.region, region_series: ruleCallOf(theirs.pooled).region });
        if (Math.abs(pooled_diff) > TOLERANCE || removal.call.region !== ruleCallOf(theirs.pooled).region) fail(`pooled ${removal.w_removed_pooled} against ${theirs.pooled}`);
        for (const r of rows) console.log(`  ${r.group} | n ${r.inserters} | ${r.generator.toFixed(2)} | ${r.series === null ? "-" : r.series.toFixed(2)} | ${r.difference === null ? "-" : r.difference.toExponential(1)} | ${r.region}`);
        report.push({ name: pair.name, rows, fallback: { unwired: runs.unwired.start_rule_fallback.length, clocked: runs.clocked.start_rule_fallback.length } });
    }
    if (out_path) fs.writeFileSync(out_path, JSON.stringify(report, null, 1));
    console.log(failures === 0 ? "ALL AGREE" : `${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
