import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadConfigFromFile } from "./config/loader";
import { ConfigPaths } from "./config/config-paths";
import "./data/factorio-data-file";
import { EntityId } from "./entities";
import { RULE_CALL_CAVEATS, RULE_THRESHOLDS, removedBetween, RuleCall, RuleRemoval } from "./crafting/rule-call";
import { ruleCallsOfSample } from "./crafting/rule-calls-of-sample";
import { ruleCount, RuleCountRun } from "./crafting/rule-count";
import { FactorioInserterState } from "./state/factorio-entity-state";
import { readExtractorDump } from "./verification/extractor-dump";
import { parseRecording } from "./verification/recording";
import { ruleCountInputOfRecording } from "./verification/recording-rule-count";

/**
 * The inserter cost series' clock-or-unwired call for each group of inserters of a build, as advice (see
 * crafting/rule-call.ts). Two ways in:
 *
 * - two runs of the same build, one with the groups unwired and one clocked, each an extractor dump of the series (the
 *   path without `.static.ndjson`) or a recording of the clock generator's recorder (a `.json` file);
 * - a sample or config of the generator, whose selected clock is run in the simulator against the same build with
 *   every inserter always enabled.
 *
 * It prints the groups, the w removed of each and its call in true starts, beside them the series' original count and
 * its call, the pooled figures, the machines whose starts could not be read, and what the call rests on; `--json`
 * writes all of it with the version and the commit of the generator that counted it.
 */

const SIMULATOR_NOTE = "Simulated. The simulator's count was laid against the game on one build only, the advanced circuit "
    + "scaffold (2026-10-14): every call agreed; on the clock w agreed within 10 a minute a group, unclocked by -8% to +24% "
    + "(GOALS.md, \"The rule's count and the clock-or-unwired advice\").";

function argValue(name: string): string | undefined {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

function usage(): never {
    console.error([
        "Usage: npm run calls -- --unwired=<dump or recording> --clocked=<dump or recording> [--json=<out.json>]",
        "       npm run calls -- --sample=<sample key or config.json> [--json=<out.json>]",
        "  --unwired, --clocked   an extractor dump of the inserter cost series (the path without .static.ndjson; the",
        "                         samples file beside it, or --unwired-samples / --clocked-samples), or a recording of",
        "                         the recorder (.json). In a recording an inserter is wired when it shows disabled by",
        "                         the circuit network at some sample.",
        "  --sample               a sample of the generator (e.g. ADVANCED_CIRCUIT) or a config file: its selected clock",
        "                         against the same build with every inserter always enabled, in the simulator",
        "",
        ...(["true starts", "original"] as const).map(count => {
            const t = RULE_THRESHOLDS[count];
            return `${count === "true starts" ? "The call, in true starts" : "Beside it, the series' original count"}: w removed below ${t.unwired_firm}: leave unwired; `
                + `${t.unwired_firm} to ${t.clock_lower}: leave unwired, marginal; ${t.clock_lower} to ${t.clock_firm}: clock, marginal; above ${t.clock_firm}: clock. From ${t.page}.`;
        }),
        ...RULE_CALL_CAVEATS.map(caveat => `  - ${caveat}`),
    ].join("\n"));
    process.exit(2);
}

/** The version and the commit of the generator that counts, so a call can be locked with what made it */
function generatorVersion(): { version: string; commit: string } {
    const root = path.join(__dirname, "..");
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version as string;
    let commit = "unknown";
    try {
        commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
        const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "package.json"], { cwd: root, encoding: "utf8" }).trim();
        if (dirty !== "") {
            commit += " (with uncommitted changes)";
        }
    } catch {
        // not a checkout: the version alone
    }
    return { version, commit };
}

/** A run of the build from a dump or a recording */
async function runOf(at: string, samples_at: string | undefined): Promise<{ run: RuleCountRun; source: string }> {
    if (at.endsWith(".json")) {
        const recording = parseRecording(JSON.parse(fs.readFileSync(at, "utf8")));
        const ever_disabled = new Set(recording.inserters
            .filter(inserter => inserter.samples.status.some(([, status]) => status === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR))
            .map(inserter => EntityId.forInserter(inserter.id).id));
        const input = ruleCountInputOfRecording(recording, id => ever_disabled.has(id));
        return { run: ruleCount(input.inserters, input.machines, 0, recording.sample_count), source: `recording ${at}` };
    }
    const dump = await readExtractorDump(at, samples_at ?? at);
    return { run: ruleCount(dump.inserters, dump.machines, 0, dump.ticks), source: `extractor dump ${at}` };
}

const callText = (call: RuleCall | null): string =>
    call === null ? "not wired" : `${call.call} (${call.firm ? "firm" : "marginal"}, ${call.region})`;

/** The machines whose true starts could not be read, by recipe: their inferred starts stand in for them */
function printUnknownStarts(runs: { unwired: RuleCountRun; clocked: RuleCountRun }): void {
    for (const [name, run] of Object.entries(runs)) {
        const by_recipe = new Map<string, number>();
        for (const m of run.true_start_unknown) {
            by_recipe.set(m.recipe, (by_recipe.get(m.recipe) ?? 0) + 1);
        }
        for (const [recipe, machines] of by_recipe) {
            console.log(`True starts not known (${name}): ${machines} ${recipe || "(no recipe)"} machines; the original count's starts stand in for them`);
        }
    }
}

function print(removal: RuleRemoval, original: RuleRemoval, runs: { unwired: RuleCountRun; clocked: RuleCountRun }, notes: string[]): void {
    const f = (x: number | null | undefined) => x === null || x === undefined ? "-" : x.toFixed(1);
    const original_by_key = new Map(original.groups.map(g => [g.key, g]));
    console.log("| Group | Inserters | Wired | w unwired | w clocked | w removed | Call | Original count: w removed | Its call |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    const groups = [...removal.groups].sort((a, b) => Number(b.newly_wired) - Number(a.newly_wired) || a.key.localeCompare(b.key));
    for (const g of groups) {
        const o = original_by_key.get(g.key);
        console.log(`| ${g.key.split(" | ").join("; ")} | ${g.inserters_clocked} | ${g.wired_clocked} | ${f(g.w_unwired)} | ${f(g.w_clocked)} | ${f(g.w_removed)} | ${callText(g.call)} | ${f(o?.w_removed)} | ${o ? callText(o.call) : "-"} |`);
    }
    console.log(`| design, a wired inserter (pooled) | ${removal.newly_wired_inserters} | | | | ${f(removal.w_removed_pooled)} | ${callText(removal.call)} | ${f(original.w_removed_pooled)} | ${callText(original.call)} |`);
    for (const [name, run] of Object.entries(runs)) {
        const by_recipe = new Map<string, number>();
        for (const m of run.start_rule_fallback) {
            by_recipe.set(m.recipe, (by_recipe.get(m.recipe) ?? 0) + 1);
        }
        for (const [recipe, machines] of by_recipe) {
            console.log(`Original count's start rule fallback (${name}): ${machines} ${recipe} machines counted by their finishes (starts more than 3% off)`);
        }
    }
    printUnknownStarts(runs);
    const differ = groups.filter(g => g.call && original_by_key.get(g.key)?.call && g.call.call !== original_by_key.get(g.key)!.call!.call);
    if (differ.length > 0) {
        console.log(`Calls that differ between the two counts: ${differ.map(g => g.key.split(" | ").join("; ")).join(" / ")}`);
    }
    console.log("");
    for (const note of [...notes, ...removal.caveats]) {
        console.log(`- ${note}`);
    }
}

async function main() {
    const sample = argValue("sample");
    const unwired_at = argValue("unwired");
    const clocked_at = argValue("clocked");
    const json_at = argValue("json");
    if (sample === undefined && (unwired_at === undefined || clocked_at === undefined)) {
        usage();
    }
    const generator = generatorVersion();
    const call_page = RULE_THRESHOLDS["true starts"];
    const header = `clock-generator ${generator.version}, commit ${generator.commit}; call in true starts from ${call_page.page} (sha256 ${call_page.sha256})`;

    if (sample !== undefined) {
        const config_path = (ConfigPaths as Record<string, string>)[sample] ?? sample;
        const config = await loadConfigFromFile(config_path);
        const calls = ruleCallsOfSample(config);
        console.log(header);
        console.log(`${config_path}: ${calls.clock.label} (${calls.clock.id}, ${calls.clock.verdict}), period ${calls.clock.period_ticks}, ticks ${calls.from_tick} to ${calls.to_tick}`);
        console.log("");
        print(calls.removal, calls.removal_original, { unwired: calls.unwired_run, clocked: calls.clocked_run }, [SIMULATOR_NOTE]);
        if (json_at) {
            fs.writeFileSync(json_at, JSON.stringify({ generator, thresholds: RULE_THRESHOLDS, sample: config_path, simulator_note: SIMULATOR_NOTE, ...calls }, null, 1));
        }
        return;
    }
    const unwired = await runOf(unwired_at!, argValue("unwired-samples"));
    const clocked = await runOf(clocked_at!, argValue("clocked-samples"));
    const removal = removedBetween(unwired.run, clocked.run);
    const removal_original = removedBetween(unwired.run, clocked.run, "original");
    console.log(header);
    console.log(`unwired: ${unwired.source} (${unwired.run.ticks} ticks); clocked: ${clocked.source} (${clocked.run.ticks} ticks)`);
    console.log("");
    print(removal, removal_original, { unwired: unwired.run, clocked: clocked.run }, []);
    if (json_at) {
        fs.writeFileSync(json_at, JSON.stringify({
            generator, thresholds: RULE_THRESHOLDS,
            unwired: unwired.source, clocked: clocked.source, unwired_run: unwired.run, clocked_run: clocked.run, removal, removal_original,
        }, null, 1));
    }
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
