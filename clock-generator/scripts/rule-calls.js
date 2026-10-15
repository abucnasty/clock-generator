// node scripts/rule-calls.js <KEY or config path>   the inserter cost series' rule applied to a sample's selected clock
//
// Generates the clock alternatives as the generator does, takes the selected clock, and runs the build twice more (on
// the clock, and with every inserter and drill always enabled) over the ticks the clock's long run counts. Prints, for
// each group of inserters, the wake-ups a minute for an inserter unwired and clocked, w removed and the call, then the
// pooled figure and its call. Advice about update time only (see src/crafting/rule-call.ts for its caveats).
// Needs `npx tsc` first. CLOCK_GENERATOR_ROOT names another build, as for the other scripts.
const { dist, quiet, loadSample } = require("./lib");

(async () => {
    const key = process.argv[2];
    if (!key) {
        console.error("usage: node scripts/rule-calls.js <KEY or config path>");
        process.exit(2);
    }
    const { ruleCallsOfSample } = dist("crafting/rule-calls-of-sample.js");
    const { RULE_CALL_SOURCE } = dist("crafting/rule-call.js");
    const calls = ruleCallsOfSample(await loadSample(key), { logger: quiet });
    const f = x => x === null ? "-" : x.toFixed(1);
    console.log(`${calls.clock.label} (${calls.clock.id}, ${calls.clock.verdict}), period ${calls.clock.period_ticks}, ticks ${calls.from_tick} to ${calls.to_tick}`);
    for (const g of calls.removal.groups) {
        const call = g.call ? `${g.call.call} (${g.call.firm ? "firm" : "marginal"}, ${g.call.region})` : "not wired";
        console.log(`${g.role} | ${g.items} | ${g.recipes} | n ${g.inserters_clocked} wired ${g.wired_clocked} | unwired ${f(g.w_unwired)} clocked ${f(g.w_clocked)} removed ${f(g.w_removed)} | ${call}`);
    }
    const pooled = calls.removal.call;
    console.log(`pooled over ${calls.removal.newly_wired_inserters} newly wired: ${f(calls.removal.w_removed_pooled)}`
        + (pooled ? ` -> ${pooled.call} (${pooled.firm ? "firm" : "marginal"}, ${pooled.region})` : ""));
    for (const [name, run] of [["unwired", calls.unwired_run], ["clocked", calls.clocked_run]]) {
        for (const m of run.start_rule_fallback) console.log(`start rule fallback (${name}): ${m.machine_id} ${m.recipe}, starts ${m.starts} against finishes ${m.finishes}`);
    }
    for (const [name, rows] of Object.entries(calls.true_start_agreement)) {
        for (const r of rows) console.log(`true starts (${name}): ${r.key}: inferred ${r.inferred}, true ${r.true_starts}`);
    }
    console.log(`source: ${RULE_CALL_SOURCE.page} (sha256 ${RULE_CALL_SOURCE.sha256})`);
    for (const c of calls.removal.caveats) console.log(`caveat: ${c}`);
})().catch(e => { console.error(e); process.exit(1); });
