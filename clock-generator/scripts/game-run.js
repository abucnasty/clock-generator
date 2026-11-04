// The protocol of every script that starts Factorio for a check (owner 2026-11-03): a game run is timed in game ticks, never in
// clock periods. Steady state is the first tick at which the machines that make the target item have finished the target
// amount over the trailing minute (3,600 ticks); the baseline is the minute after it; no run is over 36,000 ticks (ten minutes)
// unless it is asked for with `--long <reason>`, and then the reason is printed. The judgement is the game tests' own
// (tests/game/helpers/lua/steady.lua, run summary and runHolds in tests/game/builds/clock-controls.ts): this module only starts it
// with the same numbers (RUN_PROTOCOL in tests/game/builds/pickup-clock-capture.ts, which TypeScript keeps out of reach of these
// plain scripts) and reads its report.
const fs = require("fs");
const path = require("path");

const GAME_RUN = { window: 3600, baseline: 3600, max_ticks: 36000, cap: 54000 };

/**
 * The reason given for a long run, taken out of `args` (`--long <reason>`), else LONG_RUN=<reason> in the environment; undefined
 * where none is given. An option without a reason is refused: the reason is what makes a long run deliberate.
 */
function takeLongReason(args) {
    const at = args.indexOf("--long");
    let reason = process.env.LONG_RUN;
    if (at >= 0) {
        reason = args[at + 1];
        if (reason === undefined || reason.startsWith("--") || reason.trim() === "") {
            throw new Error("--long needs a reason: --long \"<why this build needs a run over ten minutes>\"");
        }
        args.splice(at, 2);
    }
    return reason === undefined || reason.trim() === "" ? undefined : reason.trim();
}

/** Throws when `ticks` is over what a game run may take and no reason for a long run is given; prints the reason when one is */
function assertWithinRun(ticks, long, what) {
    if (!(ticks > GAME_RUN.max_ticks)) return;
    if (long === undefined) {
        throw new Error(`${what} is ${ticks} ticks, over the ${GAME_RUN.max_ticks} (ten minutes of game time) a game run may take. `
            + "A run that long is a deliberate choice for one build: --long \"<reason>\" (or LONG_RUN=<reason>) allows it.");
    }
    console.log(`long run (${what}: ${ticks} ticks, over ${GAME_RUN.max_ticks}): ${long}`);
}

/**
 * The Lua chunk for the harness's `lua` option that waits for steady state (the build makes `items_per_second` of `item`, all
 * of it in the machines with one of `recipes`) and judges one baseline minute, with no
 * disturbances, and ends the harness's settle then (settle_ticks has to be GAME_RUN.cap + 1). It writes its report to
 * script-output/<output> of the game's work folder.
 */
function steadyProbeSource(items_per_second, item, recipes, output) {
    const { ROOT } = require("./lib");
    const helpers = path.join(ROOT, "tests", "game", "helpers");
    if (!fs.existsSync(path.join(helpers, "lua", "steady.lua"))) {
        throw new Error(`${ROOT} has no tests/game/helpers/lua/steady.lua: a game run needs a checkout with the minute protocol`);
    }
    const { composeProbeSource } = require(path.join(helpers, "probe-source"));
    return composeProbeSource(path.join(__dirname, "lua", "steady-run.lua"), {
        window: GAME_RUN.window, baseline: GAME_RUN.baseline, cap: GAME_RUN.cap,
        expected: Math.round(items_per_second * GAME_RUN.window / 60 * 1e6) / 1e6,
        recipes: [...recipes], item, output,
    });
}

/** The report of a steady-state run (script-output/<output>), as the probe wrote it */
function readSteadyReport(workDir, output) {
    const report = JSON.parse(fs.readFileSync(path.join(workDir, "script-output", output), "utf-8"));
    return report.protocol;
}

/** Whether a run holds, as runHolds says it for the game tests, and the lines that say why */
function describeRun(run) {
    const lines = [];
    if (run.error !== undefined) {
        return { holds: false, lines: [`the probe failed in the game: ${run.error}`] };
    }
    const disturbances = Array.isArray(run.disturbances) ? run.disturbances : [];
    const baseline = run.baseline;
    lines.push(run.steady === undefined
        ? `no steady state: ${run.result}`
        : `steady state at tick ${run.steady}: the final machines made ${run.expected} over the trailing ${run.window} ticks`);
    if (baseline) {
        lines.push(`baseline ${baseline.ticks} ticks: ${baseline.total} against ${baseline.expected}, trailing window ${baseline.min} to ${baseline.max}, `
            + (baseline.held ? "never below the target" : baseline.measured
                ? `below it at times, so judged by the rate to its last return to the target: ${baseline.measured.items} against ${baseline.measured.expected} over ${baseline.measured.ticks} ticks`
                : "below the target and never back to it")
            + (baseline.meets ? ": meets" : ": does not meet"));
    }
    const holds = run.result === "holds" && baseline?.meets === true && disturbances.every(disturbance => disturbance.recovered !== undefined);
    if (run.result !== "holds") lines.push(`the run ended: ${run.result ?? "it did not end before the recording started"}`);
    return { holds, lines };
}

module.exports = { GAME_RUN, takeLongReason, assertWithinRun, steadyProbeSource, readSteadyReport, describeRun };
