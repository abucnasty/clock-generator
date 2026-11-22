// node scripts/pair-check.js --today-save=<zip> --new-save=<zip> --today-copy-check=<json> --new-copy-check=<json>
//          (--setpoint=<config or claim file> | --item=<item> --claim=<n>) [--rate=<n> --amount=<n> --builds-per-copy=<n>]
//          [--lane-rate=<n>] [--window-ticks=<n>] [--today-sim-game=<json> --new-sim-game=<json>]
//          --game-version=<x.y.z> --out=<checks/name.json>
//          [--names=<today key>,<new key>] [--setpoint-tolerance=<share>] [--pair-tolerance=<share>] [--copy-tolerance=<share>] [--allow-above]
//
// The production gate of a timed pair of two clocks (two saves of one build that differ only in the clock). It reads what the
// copy check wrote for each save (`tools/verify-save.js --copy-grid`, run by the experiment's `copy-check.sh --product=<item>`,
// never `--by=inserters`) and writes one result file for the check gate of `run.sh`. No game, no generator.
//
// Rules, in the unit the copy check holds (products finished per copy over the sampled ticks, crafts plus productivity completions):
//   copies     in each save every copy finishes what the median copy finishes, within 2% (--copy-tolerance) or one craft a machine
//   copy pairs the same copy of both saves finishes the same, within one craft a machine
//   setpoint   the median copy of both saves finishes the setpoint: the claim (products one copy finishes over the sample), or
//              rate x builds per copy x ticks / 60 / amount, within 0.5% (--setpoint-tolerance); a build that loads a lane
//              (--lane-rate, items a second one saturated lane carries) must make that rate at least and is held to 0.1%.
//              More than the setpoint also fails, unless --allow-above.
//   pair       the saves' total production is within 0.5% (--pair-tolerance), over the larger of the two, as pair-score.js reads it
// The lane itself is never read: a copy check holds no lane. Its saturation is judged as a strict claim on production
// over the sampled ticks, and the result says so under `not_checked`.
//
// Refused (the file is written with pass false and refused true, and the reason): a copy check that holds no copy grid; counts that are not
// by product (no product, or a count of machines equal to the inserters of the box: `--by=inserters`); other products, ticks, copies or machines
// of a copy in the two files; a copy with no machine or a machine with no sampled track; a sample shorter than --window-ticks; the same save twice.
//
// The result is the contract of the check gate (lib/experiment-kit/check-gate.js of the benchmark tools):
//   { pass, reason, made (ISO time), game_version, inputs: { <today key>, <new key>: sha256 of the saves, ...sha256 of every other file read },
//     refused, failures, production, not_checked }
// Name the two keys of `inputs` in the scenario's `check.inputs` ({ "today": "maps/<today>.zip", "new": "maps/<new>.zip" }): a changed save makes the result stale.
// Exit: 0 pass, 1 the pair fails or is refused (the file is written), 2 a bad option or a file that cannot be read (nothing is written).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULTS = { setpoint_tolerance: 0.005, lane_tolerance: 0.001, pair_tolerance: 0.005, copy_tolerance: 0.02 };

/** sha256 of a file, read in chunks (a save is large) */
function sha256File(file) {
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(1 << 20);
    try {
        for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
            hash.update(buffer.subarray(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest("hex");
}

function readJson(file, what) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (error) {
        throw new UsageError(`cannot read ${what} ${file}: ${error.message}`);
    }
}

class UsageError extends Error { }

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const sum = values => values.reduce((a, b) => a + b, 0);
const share = x => `${(x * 100).toFixed(2)}%`;

/**
 * The setpoint from a config (`setpoint.item`, `setpoint.items_per_second`) or a claim file ({ item, claim } or { item, rate, amount,
 * builds_per_copy, lane_rate }), with the options laid over it. A rate needs its amount and builds per copy stated: the config holds
 * neither the items a finished product makes nor how many builds a copy of the grid holds.
 * @returns {{ item: string, claim: number|null, rate: number|null, amount: number|null, builds_per_copy: number|null, lane_rate: number|null }}
 */
function validRatePair(rate) {
    const { numerator, denominator } = rate;
    if (Object.keys(rate).length !== 2 || !Object.hasOwn(rate, "numerator") || !Object.hasOwn(rate, "denominator")
        || !Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) return false;
    let a = numerator, b = denominator;
    while (b !== 0) [a, b] = [b, a % b];
    return a === 1;
}

function setpointOf(file, options = {}) {
    const base = file && file.setpoint && typeof file.setpoint === "object"
        ? { item: file.setpoint.item, rate: file.setpoint.items_per_second }
        : file ?? {};
    const pick = name => options[name] ?? base[name] ?? null;
    const number = (name, value) => {
        if (value !== null && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
            throw new UsageError(`${name} must be a number above 0, got ${JSON.stringify(value)}`);
        }
        return value;
    };
    const input = pick("rate");
    const pair = options.rate == null && file?.setpoint && input !== null && typeof input === "object";
    if (pair && !validRatePair(input)) throw new UsageError("rate must be a reduced positive fraction");
    const setpoint = {
        item: pick("item"),
        claim: number("claim", pick("claim")),
        rate: pair ? { numerator: input.numerator, denominator: input.denominator } : number("rate", input),
        amount: number("amount", pick("amount")),
        builds_per_copy: number("builds-per-copy", options.builds_per_copy ?? base.builds_per_copy ?? null),
        lane_rate: number("lane-rate", options.lane_rate ?? base.lane_rate ?? null),
    };
    if (typeof setpoint.item !== "string" || setpoint.item === "") {
        throw new UsageError("the setpoint names no item: give --item or a config or claim file with one");
    }
    if (setpoint.claim === null && setpoint.rate === null) {
        throw new UsageError("the setpoint holds no figure: give a claim (products one copy finishes over the sample) or a rate");
    }
    if (setpoint.claim === null && (setpoint.amount === null || setpoint.builds_per_copy === null)) {
        throw new UsageError("a rate needs --amount (items a finished product makes) and --builds-per-copy (builds one copy of the grid holds): they are not guessed");
    }
    return setpoint;
}

/** The copy grid of one copy-check file as pair-check reads it, or the reasons it cannot be used */
function gridOf(result, label) {
    const grid = result?.copy_grid;
    if (!grid) {
        return { refusals: [`${label}: the copy check holds no copy grid`] };
    }
    const refusals = [];
    if (typeof grid.product !== "string" || grid.product === "") {
        refusals.push(`${label}: the counts are not by product (product is ${JSON.stringify(grid.product ?? null)}): they are by inserter, or by every machine; count with --product=<item>`);
    }
    if (!Array.isArray(result.groups)) {
        refusals.push(`${label}: the file holds no inserter groups, so the basis of the counts cannot be shown`);
    } else if (grid.machines === sum(result.groups.map(group => group.count))) {
        refusals.push(`${label}: the count of machines (${grid.machines}) is the count of inserters in the box: the counts are by inserter, not by product`);
    }
    if (!Array.isArray(grid.per_copy) || grid.per_copy.length === 0) {
        refusals.push(`${label}: the copy grid holds no per_copy figures`);
    }
    if ((grid.empty ?? []).length > 0) {
        refusals.push(`${label}: ${grid.empty.length} copies hold no machine (first ${grid.empty.slice(0, 5).join(", ")})`);
    }
    if (grid.machines_without_a_track > 0) {
        refusals.push(`${label}: ${grid.machines_without_a_track} machines have no sampled track`);
    }
    return { grid, refusals };
}

/**
 * The verdict on a pair. `today` and `new` are the parsed copy-check files; `sim_game` the parsed sim-game results (or null).
 * Pure: reads nothing, writes nothing.
 * @returns {{ pass: boolean, refused: boolean, reason: string, failures: string[], production: object|null, not_checked: string[] }}
 */
function judge({ today, new: other, setpoint, window_ticks = null, sim_game = {}, game_version = null, tolerances = {}, allow_above = false, same_save = false }) {
    const tol = { ...DEFAULTS, ...tolerances };
    const not_checked = ["the lane itself: a copy check holds no lane; saturation is judged as a strict claim on production over the sampled ticks"];
    const refuse = refusals => ({ pass: false, refused: true, reason: `refused: ${refusals.join("; ")}`, failures: refusals, production: null, not_checked });

    const a = gridOf(today, "today"), b = gridOf(other, "new");
    const refusals = [...a.refusals, ...b.refusals];
    if (same_save) {
        refusals.push("both saves are the same file");
    }
    if (a.grid && b.grid) {
        const [x, y] = [a.grid, b.grid];
        if (typeof x.product === "string" && typeof y.product === "string" && x.product !== y.product) {
            refusals.push(`the two copy checks count other products (${x.product}, ${y.product})`);
        }
        if (typeof x.product === "string" && x.product !== setpoint.item) {
            refusals.push(`the setpoint is ${setpoint.item}, the counts are of ${x.product}`);
        }
        if (x.sampled_ticks !== y.sampled_ticks) {
            refusals.push(`the copy checks sampled other ticks (${x.sampled_ticks}, ${y.sampled_ticks})`);
        }
        if (window_ticks !== null && Math.min(x.sampled_ticks, y.sampled_ticks) < window_ticks) {
            refusals.push(`the copy checks sampled ${Math.min(x.sampled_ticks, y.sampled_ticks)} ticks, less than the timed window of ${window_ticks}`);
        }
        if (Array.isArray(x.per_copy) && Array.isArray(y.per_copy)) {
            if (x.per_copy.length !== y.per_copy.length) {
                refusals.push(`the saves hold other numbers of copies (${x.per_copy.length}, ${y.per_copy.length})`);
            } else {
                const unlike = x.per_copy.filter((copy, at) => copy[1] !== y.per_copy[at][1]).map(copy => copy[0]);
                if (unlike.length > 0) {
                    refusals.push(`${unlike.length} copies hold other numbers of machines in the two saves (first ${unlike.slice(0, 5).join(", ")})`);
                }
            }
        }
    }
    if (refusals.length > 0) {
        return refuse(refusals);
    }

    const [x, y] = [a.grid, b.grid];
    const ticks = x.sampled_ticks;
    const failures = [];
    const named = [["today", x], ["new", y]];

    // the copies of each save against that save's median
    const medians = {}, totals = {};
    for (const [label, grid] of named) {
        const figures = grid.per_copy.map(copy => copy[2]);
        const mid = medians[label] = median(figures);
        totals[label] = sum(figures);
        const off = grid.per_copy.filter(([, machines, finished]) => Math.abs(finished - mid) > tol.copy_tolerance * mid && Math.abs(finished - mid) > machines).map(copy => copy[0]);
        if (off.length > 0) {
            failures.push(`${label}: ${off.length} of ${grid.per_copy.length} copies are further from the median ${mid} than ${share(tol.copy_tolerance)} and one craft a machine (first ${off.slice(0, 5).map(n => `copy ${n}: ${grid.per_copy[n][2]}`).join(", ")})`);
        }
    }

    // the same copy of both saves
    const apart = x.per_copy.filter(([, machines, finished], at) => Math.abs(finished - y.per_copy[at][2]) > machines).map(copy => copy[0]);
    if (apart.length > 0) {
        failures.push(`${apart.length} copies finish more than one craft a machine apart in the two saves (first ${apart.slice(0, 5).map(n => `copy ${n}: ${x.per_copy[n][2]} and ${y.per_copy[n][2]}`).join(", ")})`);
    }

    // the setpoint
    const rate = typeof setpoint.rate === "object" && setpoint.rate !== null ? setpoint.rate.numerator / setpoint.rate.denominator : setpoint.rate;
    const expected = setpoint.claim ?? rate * setpoint.builds_per_copy * ticks / 60 / setpoint.amount;
    let lane_tolerance = null;
    if (setpoint.lane_rate !== null) {
        lane_tolerance = tol.lane_tolerance;
        if (setpoint.claim === null && rate < setpoint.lane_rate) {
            failures.push(`the setpoint rate ${rate} a second is under the ${setpoint.lane_rate} of a saturated lane: the build does not fill its lane`);
        }
    }
    const limit = lane_tolerance ?? tol.setpoint_tolerance;
    for (const label of ["today", "new"]) {
        const gap = (medians[label] - expected) / expected;
        if (gap < -limit) {
            failures.push(`${label}: the median copy finishes ${medians[label]}, ${share(-gap)} under the setpoint ${expected.toFixed(1)}${setpoint.lane_rate !== null ? " (a lane that is not saturated)" : ""}`);
        } else if (gap > limit && !allow_above) {
            failures.push(`${label}: the median copy finishes ${medians[label]}, ${share(gap)} over the setpoint ${expected.toFixed(1)}`);
        }
    }

    // the two saves against each other, "apart" over the larger as pair-score.js reads it
    const gap = Math.abs(totals.today - totals.new) / Math.max(totals.today, totals.new);
    if (gap > tol.pair_tolerance) {
        failures.push(`the saves' production is ${share(gap)} apart (${totals.today} and ${totals.new}), more than ${share(tol.pair_tolerance)}`);
    }

    // the clock checks against the game, when given
    for (const label of ["today", "new"]) {
        const result = sim_game[label];
        if (!result) {
            not_checked.push(`the clock check against the game of ${label} was not given`);
        } else if (result.pass !== true) {
            failures.push(`${label}: the clock check against the game did not pass`);
        } else if (game_version !== null && result.game_version !== game_version) {
            failures.push(`${label}: the clock check against the game was made for game ${result.game_version ?? "(none stamped)"}, not ${game_version}`);
        }
    }
    if (window_ticks === null) {
        not_checked.push("the length of the timed window was not given, so the sample was not held against it");
    }

    const production = {
        product: x.product, sampled_ticks: ticks, copies: x.per_copy.length, setpoint_per_copy: expected,
        today: { median: medians.today, total: totals.today, least: x.min, most: x.max },
        new: { median: medians.new, total: totals.new, least: y.min, most: y.max },
        apart: gap,
        new_over_today: totals.new / totals.today - 1,
        tolerances: { setpoint: limit, pair: tol.pair_tolerance, copy: tol.copy_tolerance },
    };
    const pass = failures.length === 0;
    const reason = pass
        ? `${production.copies} copies of ${x.product} over ${ticks} ticks: medians ${medians.today} and ${medians.new} at the setpoint ${expected.toFixed(1)}, every copy within one craft a machine, saves ${share(gap)} apart`
        : failures.join("; ");
    return { pass, refused: false, reason, failures, production, not_checked };
}

const OPTIONS = {
    values: ["today-save", "new-save", "today-copy-check", "new-copy-check", "setpoint", "item", "claim", "rate", "amount", "builds-per-copy",
        "lane-rate", "window-ticks", "today-sim-game", "new-sim-game", "game-version", "out", "names", "setpoint-tolerance", "pair-tolerance", "copy-tolerance"],
    flags: ["allow-above"],
};
const USAGE = "usage: pair-check.js --today-save=<zip> --new-save=<zip> --today-copy-check=<json> --new-copy-check=<json> (--setpoint=<file> | --item=<item> --claim=<n>) [--rate=<n> --amount=<n> --builds-per-copy=<n>] [--lane-rate=<n>] [--window-ticks=<n>] [--today-sim-game=<json> --new-sim-game=<json>] --game-version=<x.y.z> --out=<file> [--names=<today>,<new>] [--setpoint-tolerance=<share>] [--pair-tolerance=<share>] [--copy-tolerance=<share>] [--allow-above]";

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
        if (!match || !(OPTIONS.values.includes(match[1]) ? match[2] !== undefined : OPTIONS.flags.includes(match[1]) && match[2] === undefined)) {
            throw new UsageError(`bad option ${arg}`);
        }
        args[match[1]] = match[2] ?? true;
    }
    for (const name of ["today-save", "new-save", "today-copy-check", "new-copy-check", "game-version", "out"]) {
        if (args[name] === undefined) {
            throw new UsageError(`--${name} is required`);
        }
    }
    return args;
}

const numberOption = (args, name) => {
    if (args[name] === undefined) {
        return undefined;
    }
    const value = Number(args[name]);
    if (!Number.isFinite(value)) {
        throw new UsageError(`--${name} is not a number: ${args[name]}`);
    }
    return value;
};

function run(argv) {
    const args = parseArgs(argv);
    const [today_key, new_key] = (args.names ?? "today,new").split(",");
    if (!today_key || !new_key || today_key === new_key) {
        throw new UsageError("--names is <today key>,<new key>, two different names");
    }
    const file = name => path.resolve(args[name]);
    const inputs = {};
    const stamp = (key, name) => {
        try {
            inputs[key] = sha256File(file(name));
        } catch (error) {
            throw new UsageError(`cannot read ${file(name)}: ${error.message}`);
        }
    };
    stamp(today_key, "today-save");
    stamp(new_key, "new-save");
    stamp(`${today_key}_copy_check`, "today-copy-check");
    stamp(`${new_key}_copy_check`, "new-copy-check");
    const today = readJson(file("today-copy-check"), "the copy check");
    const other = readJson(file("new-copy-check"), "the copy check");

    let setpoint_file = null;
    if (args.setpoint !== undefined) {
        stamp("setpoint", "setpoint");
        setpoint_file = readJson(file("setpoint"), "the setpoint");
    }
    const setpoint = setpointOf(setpoint_file, {
        item: args.item, claim: numberOption(args, "claim"), rate: numberOption(args, "rate"), amount: numberOption(args, "amount"),
        builds_per_copy: numberOption(args, "builds-per-copy"), lane_rate: numberOption(args, "lane-rate"),
    });

    const sim_game = {};
    for (const [label, key, name] of [["today", today_key, "today-sim-game"], ["new", new_key, "new-sim-game"]]) {
        if (args[name] !== undefined) {
            stamp(`${key}_sim_game`, name);
            sim_game[label] = readJson(file(name), "the clock check against the game");
        }
    }

    const tolerances = {};
    for (const [name, key] of [["setpoint-tolerance", "setpoint_tolerance"], ["pair-tolerance", "pair_tolerance"], ["copy-tolerance", "copy_tolerance"]]) {
        const value = numberOption(args, name);
        if (value !== undefined) {
            if (value < 0) {
                throw new UsageError(`--${name} is a share from 0`);
            }
            tolerances[key] = value;
        }
    }

    const verdict = judge({
        today, new: other, setpoint, sim_game, tolerances, allow_above: args["allow-above"] === true,
        window_ticks: numberOption(args, "window-ticks") ?? null, game_version: args["game-version"], same_save: inputs[today_key] === inputs[new_key],
    });
    const result = {
        pass: verdict.pass,
        reason: verdict.reason,
        made: new Date().toISOString(),
        game_version: args["game-version"],
        inputs,
        refused: verdict.refused,
        failures: verdict.failures,
        production: verdict.production,
        setpoint,
        not_checked: verdict.not_checked,
    };
    fs.mkdirSync(path.dirname(file("out")), { recursive: true });
    fs.writeFileSync(file("out"), JSON.stringify(result, null, 1) + "\n");
    console.log(`pair-check: ${verdict.pass ? "pass: " : verdict.refused ? "" : "FAIL: "}${verdict.reason}`);
    for (const line of verdict.not_checked) {
        console.log(`pair-check: not checked: ${line}`);
    }
    return verdict.pass ? 0 : 1;
}

if (require.main === module) {
    try {
        process.exitCode = run(process.argv.slice(2));
    } catch (error) {
        if (!(error instanceof UsageError)) {
            throw error;
        }
        console.error(`pair-check: ${error.message}\n${USAGE}`);
        process.exitCode = 2;
    }
}

module.exports = { judge, setpointOf, gridOf, run, sha256File };
