// node scripts/sim-game-check.js check   --config <sample key | config file> (--hash <clock hash prefix> | --clock-file <exported clock>) --recording <recording file>
//                                        --out <folder> [--name <build>] [--scaffold <blueprint file>] [--staged] [--seed-items <n>] [--sim-offset <ticks>] [--seed-at first|settled]
// node scripts/sim-game-check.js builds  --recordings <folder> --out <folder> [--only a,b]    the check of every build of sim-game-check/builds.json
// node scripts/sim-game-check.js summary <out folder>                                         the table of the result files in a folder
//
// The simulator against the game for one build, to judge the inserter dispatch (simulation/dispatch.ts, the update list): a
// stored recording of the game running a clock is laid against the simulator's run of the same clock, per inserter and per
// clock period, one kind at a time:
//   wake-ups  the wake-up rule "kept-lists" (crafting/wake-ups.ts) on the game's recording and on each simulated one;
//             pass: within WAKE_UPS_TOLERANCE of the game in every period, for every inserter. Where the states of the game's
//             recording or of a simulated one repeat only after more than one period (the repeat cycle: the fewest whole periods
//             after which every inserter's status and hand repeat at every tick, else all of them), the periods of the two are cut
//             at other places of the cycle: then the mean a period over whole cycles is compared, pass within
//             WAKE_UPS_CYCLE_TOLERANCE of the game's mean
//   bins      the items the output inserters drop in each period; pass: within BINS_TOLERANCE of the game in every period
//   hands     pickup and drop positions of every transfer, and the hand and status at every clock position; pass (builds whose
//             cycle is one period only): the hand equals the game's at HANDS_AGREEMENT of the positions; else no pass/fail
//   windows   the positions an inserter is enabled at (an edge of its control behaviour); no pass/fail
// Inserters whose windows are identical cannot be told apart by the clock; where only a swap of their roles matches, the
// line says "matches with roles swapped". The first clock period of the recording is left out, as the scaffold tests leave
// it out; a staged start (--staged: the game began with the clock, the simulator runs cold from its first tick) is paired
// the same way. Totals over inserters are never compared. The tolerances are stamped in every result file ("tolerances").
//
// Besides the full result, a check writes ONE combined result, <name>.check.json, which anything that gates on the check reads: its top-level
// "pass" is the verdict of the dispatch; "dispatches" keeps its verdict by kind (under "on", as before the old dispatch was removed); "inputs" holds
// the sha256 of what the verdict was judged on (the recording, the config, the exported clock file given by --clock-file, the scaffold) so that a
// reader can tell a stale result from a fresh one; "made" is the time it was written and "game_version" the game that made the recording.
// --clock-file takes the file export-clock.js wrote for the clock: its identity hash is worked out from the decoded blueprint and its schedule (the
// tags and descriptions the export adds do not count), never from the file's "selected" field; it names the clock to find unless --hash does.
//
// Two starts of the simulator are run side by side. "seeded" starts it from a recorded sample of the game (what the machines
// hold, how far their crafting and productivity bars are) and is the one that is judged: the game is recorded after a warm-up
// that the simulator does not run, and what that warm-up leaves in the machines decides which inserters wake. The sample is the
// start of the first settled period: the first period from which the game's stock (what each machine holds, in and out, at a
// period's first sample) stays inside the range it keeps over the last third of the recording. Where the recording still drifts
// in that last third (its second half leaves the first half's range), or too few periods follow, the sample is the recording's
// first and the stamp says so ("seed.settling"); --seed-at first forces the first sample. The periods judged are the whole periods
// after the seed sample. "cold" starts the simulator as the scaffold tests do (machines filled as filling leaves them, a free run
// before the clock) and is reported as before, not judged. The result file's own fields are the seeded run's; the cold run's are
// under "cold". The stamp "seed" says what the recording gave and what it could not (inserter hands, fuel, belts, chests, drills).
// A staged recording, and a clock of a fractional period, have no seeded run: the game began cold with the clock, or the clock
// cannot be placed on the recording; then the cold run is the judged one. Bins: "unsettled" lists the periods judged in which the
// game's stock still drifts, so that a transient of the game's start is visible next to a verdict.
//
// A game side is labelled "true count" where the rule was checked against the game's own wake-ups on that build (TRUE_COUNT
// below), else "rule on recording". Needs `npx tsc` first. One full result file a build: <name>.on.json (the name it had beside the old
// dispatch's <name>.off.json).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const zlib = require("zlib");
const argv = process.argv.slice(3);
// lib.js moves to the generator's folder: what names a file is made absolute first (a config that is not a file is a sample's key)
const PATH_OPTIONS = ["--recording", "--out", "--recordings", "--clock", "--clock-file", "--scaffold"];
for (const name of PATH_OPTIONS) { const i = argv.indexOf(name); if (i >= 0 && argv[i + 1] !== undefined) argv[i + 1] = path.resolve(argv[i + 1]); }
{ const i = argv.indexOf("--config"); if (i >= 0 && argv[i + 1] !== undefined && fs.existsSync(path.resolve(argv[i + 1]))) argv[i + 1] = path.resolve(argv[i + 1]); }
if (process.argv[3] !== undefined && !process.argv[3].startsWith("--")) process.argv[3] = path.resolve(process.argv[3]);
const { ROOT, dist, quiet, loadSample } = require("./lib");
const { scaffoldOf } = require("./scaffold-of");
const {
    DEFAULT_SIM_OFFSET, seedOfRecording, seedInput, seededPeriods, coldPeriods, simulateRun, unsettledPeriods, pairSeeded, pairPeriods, rangeOf, binOf,
    wakesFromTicks, insertersByConfigId, cyclesOf, meanOverCycles,
} = require("./seeded-run");

const WAKE_UPS_TOLERANCE = 1; // wake-ups per inserter per period
const WAKE_UPS_CYCLE_TOLERANCE = 0.02; // mean wake-ups a period over whole cycles, share of the game's (at least 1 a period as the base)
const BINS_TOLERANCE = 0.005; // share of the game's items in a period
const HANDS_AGREEMENT = 1; // share of positions at which an inserter's hand equals the game's (builds whose cycle is one period): every position
const RULE = "kept-lists"; // the wake-up rule (crafting/wake-ups.ts), named in the result files
// measured on the staged agricultural recording: with 3 every one of its 745 enable edges of every inserter sits 1 tick before the game's
const STAGED_SIM_OFFSET = 4;
const TRUE_COUNT = { // clock hash prefix: what checked the rule against the game's own wake-ups
    "3bc059b3": "front-exit normal mirrored backed: wake-ups read in the running game",
    "ba2c26f4": "electromagnetic science: wake-ups read in the running game",
};
const KNOWN_MISS = { // clock hash prefix: a game side the rule's count is known to miss, kept in the output and left out of the verdict
};
const DISPATCH = "activation-order";
const KEY = "on"; // the result's key and file suffix

const opt = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flag = name => argv.includes(name);
const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
/** the identity hash of a clock file written by export-clock.js: its blueprint string decoded, tags and descriptions stripped, and its schedule (what find() names a clock by) */
function clockFileHash(file) {
    const { clockIdentity } = dist("crafting/clock-identity.js");
    const clock = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof clock.blueprint !== "string" || clock.schedule === undefined) throw new Error(`${file} is not a clock file of export-clock.js (it has no blueprint string and schedule)`);
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(clock.blueprint.slice(1), "base64")).toString("utf-8"));
    return crypto.createHash("sha256").update(JSON.stringify(clockIdentity({ blueprint: decoded.blueprint, schedule: clock.schedule }))).digest("hex");
}
/** the circular difference b - a on a clock of `period` positions, in (-period/2, period/2] */
const circular = (a, b, period) => { const d = (((b - a) % period) + period) % period; return d > period / 2 ? d - period : d; };
const permutations = items => items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
const sum = list => list.reduce((a, b) => a + b, 0);

// ---- the children: the clock to simulate, and a simulated recording ----

/** the build's config; with `seeded`, the egg-style seed of a loop given as the game accepted it (the clock is made on the config as it is) */
async function configOf(seeded = false) {
    const config = await loadSample(opt("--config"));
    if (seeded && opt("--seed-items") !== undefined) config.overrides = { ...config.overrides, kick_start_items: Number(opt("--seed-items")) };
    return config;
}

/** finds the clock with the hash among the alternatives the generator makes */
async function find() {
    const { generateClockAlternatives } = dist("crafting/generate-blueprint.js");
    const { clockIdentity } = dist("crafting/clock-identity.js");
    const config = await configOf();
    const generated = generateClockAlternatives(config, { logger: quiet });
    const wanted = opt("--hash");
    for (const [index, alternative] of generated.alternatives.entries()) {
        const exported = alternative.result.subtick ?? alternative.result;
        const hash = crypto.createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex");
        if (!hash.startsWith(wanted)) continue;
        const period = alternative.result.simulation_duration.ticks;
        fs.writeFileSync(opt("--out"), JSON.stringify({
            hash, period, clock_ticks: alternative.result.subtick?.clock.period_ticks ?? period, windows: alternative.result.clock_windows,
            alternative: alternative.id, selected: index === generated.selected_index,
        }));
        return;
    }
    fs.writeFileSync(opt("--out"), JSON.stringify({ not_found: true, alternatives: generated.alternatives.map(it => it.id) }));
}

/** a run of the clock in the simulator, as a recording (seeded-run.js); with --seed, from the seed file's sample */
async function simulate() {
    const config = await configOf(true);
    const clock = JSON.parse(fs.readFileSync(opt("--clock"), "utf8"));
    const staged = flag("--staged");
    const seed = opt("--seed") === undefined ? undefined : JSON.parse(fs.readFileSync(opt("--seed"), "utf8"));
    const offset = Number(opt("--sim-offset") ?? (staged ? STAGED_SIM_OFFSET : DEFAULT_SIM_OFFSET));
    const recording = simulateRun(config, clock, { periods: Number(opt("--periods")), seed, offset, staged });
    fs.writeFileSync(opt("--out"), JSON.stringify(recording));
}

function child(mode, extra) {
    return new Promise((resolve, reject) => {
        const args = [__filename, mode, "--config", opt("--config"), ...extra];
        if (opt("--seed-items") !== undefined) args.push("--seed-items", opt("--seed-items"));
        const run = cp.spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
        run.on("exit", code => code === 0 ? resolve() : reject(new Error(`${mode} exited with ${code}`)));
    });
}

// ---- reading a recording per period ----

/** the wake-ups of each inserter (config id) in each period given, by the rule */
function wakesPerPeriod(recording, match, config, periods) {
    const { wakeUpsOfRecording } = dist("verification/recording-wake-ups.js");
    const counts = new Map();
    const { from, to } = rangeOf(periods);
    wakeUpsOfRecording(recording, match, from, to, config, (inserter_id, tick) => {
        if (tick < from || tick >= to) return;
        const list = counts.get(inserter_id) ?? new Array(periods.length).fill(0);
        list[binOf(periods, tick)]++;
        counts.set(inserter_id, list);
    });
    return counts;
}


/** [pickup position, drop position] of the transfers picked up in each period */
function transfersPerPeriod(series, clock, periods) {
    const lists = periods.map(() => []);
    const { from, to } = rangeOf(periods);
    for (const transfer of series.transfers) {
        if (transfer.pickup_index < from || transfer.pickup_index >= to || transfer.truncated_start || transfer.truncated_end) continue;
        lists[binOf(periods, transfer.pickup_index)].push([clock[transfer.pickup_index], clock[Math.min(transfer.end_index, clock.length - 1)]]);
    }
    return lists;
}

/** the positions at which the inserter turns enabled, in each period */
function enableEdgesPerPeriod(series, clock, periods) {
    const off = "disabled_by_control_behavior";
    return periods.map(period => {
        const edges = [];
        for (let i = Math.max(period.start, 1); i < period.end; i++) if (series.status[i - 1] === off && series.status[i] !== off) edges.push(clock[i]);
        return edges;
    });
}

/** deltas (sim - game) of the k-th entries of each period's lists, and the periods whose lists differ in length */
function pairLists(gameLists, simLists, period, entry) {
    const deltas = [];
    let length_differs = 0;
    gameLists.forEach((list, p) => {
        const other = simLists[p];
        if (other === undefined || list.length !== other.length) length_differs++;
        for (let k = 0; k < Math.min(list.length, other?.length ?? 0); k++) deltas.push(circular(entry(list[k]), entry(other[k]), period));
    });
    return { deltas, length_differs, game_entries: sum(gameLists.map(it => it.length)) };
}
const distribution = deltas => {
    const out = {};
    for (const delta of deltas) { const key = Math.abs(delta) > 3 ? (delta > 0 ? ">3" : "<-3") : String(delta); out[key] = (out[key] ?? 0) + 1; }
    return out;
};

/** the shares of positions at which the hand, and the status, are the same, over the periods paired */
function agreement(game, sim, gamePeriods, simPeriods, field) {
    let equal = 0, total = 0;
    const differing = {};
    gamePeriods.forEach((g, p) => {
        const s = simPeriods[p];
        for (let k = 0; k < g.end - g.start; k++) {
            total++;
            if (game[field][g.start + k] === sim[field][s.start + k]) equal++;
            else differing[k] = (differing[k] ?? 0) + 1;
        }
    });
    return { equal, total, share: total === 0 ? null : equal / total, differing };
}
const heldMismatches = (game, sim, gamePeriods, simPeriods) => { const a = agreement(game, sim, gamePeriods, simPeriods, "held"); return a.total - a.equal; };


// ---- one dispatch against the game ----

function judge(ctx, simRecording) {
    const { config, game, gameMatch, clock, period, paired, staged } = ctx;
    const { matchOfSimulatedRecording } = dist("verification/simulated-recording.js");
    const simMatch = matchOfSimulatedRecording(simRecording);
    const first = 0; // the game's first period is already left out of the pairs
    const gp = paired.game, sp = paired.sim;
    const n = Math.min(gp.length, sp.length);
    const gamePeriods = gp.slice(0, n), simPeriods = sp.slice(0, n);
    const judgedIdx = [...gamePeriods.keys()].filter(p => p >= first);
    const gameWake = wakesPerPeriod(game, gameMatch, config, gamePeriods);
    const simWake = wakesFromTicks(simRecording.wake_ticks, simPeriods);
    const gameSeries = insertersByConfigId(game, gameMatch), simSeries = insertersByConfigId(simRecording, simMatch);
    const simClock = simRecording.clock.values, gameClock = game.clock.values;
    const ids = [...gameSeries.keys()].filter(id => simSeries.has(id)).sort((a, b) => a - b);

    // inserters with identical (non-empty) windows: which of them is which in the game cannot be read off the clock
    const groups = Object.entries(ctx.groups).map(([, members]) => members).filter(members => members.length > 1 && members.length <= 4 && members.every(id => ids.includes(id)));
    const mapping = new Map(ids.map(id => [id, id]));
    for (const members of groups) {
        const cost = perm => sum(members.map((id, i) => heldMismatches(gameSeries.get(id), simSeries.get(perm[i]), gamePeriods.slice(first), simPeriods.slice(first))));
        let best = members, bestCost = cost(members);
        for (const perm of permutations(members)) { const c = cost(perm); if (c < bestCost) { best = perm; bestCost = c; } }
        members.forEach((id, i) => mapping.set(id, best[i]));
    }
    const swapped = id => mapping.get(id) !== id;

    const sel = (list, rows) => rows.map(p => list[p]);
    const zero = new Array(gamePeriods.length).fill(0);
    const wake = {};
    for (const id of ids) {
        const g = sel(gameWake.get(`inserter:${id}`) ?? zero, judgedIdx);
        const labelled = sel(simWake.get(`inserter:${id}`) ?? zero, judgedIdx);
        const swappedList = sel(simWake.get(`inserter:${mapping.get(id)}`) ?? zero, judgedIdx);
        const diffs = (a, b) => a.map((x, i) => Math.abs(x - b[i]));
        const worst = list => Math.max(0, ...list);
        const gameMean = meanOverCycles(g, ctx.cycles.game);
        const means = list => { const mean = meanOverCycles(list, ctx.cycles.sim); return { mean, rel_error: Math.abs(mean - gameMean) / Math.max(gameMean, 1) }; };
        const entry = {
            game: g, sim: labelled,
            max_diff: worst(diffs(g, labelled)), periods_over_tolerance: diffs(g, labelled).filter(d => d > WAKE_UPS_TOLERANCE).length,
            game_mean: gameMean, sim_mean: means(labelled).mean, rel_error: means(labelled).rel_error,
        };
        entry.mean_diff = entry.sim_mean - gameMean;
        // builds that repeat over more than one period: the periods of the two are cut at other places of the cycle, so the means are judged
        const passes = (list, relError) => ctx.cycle_mean ? relError <= WAKE_UPS_CYCLE_TOLERANCE : diffs(g, list).every(d => d <= WAKE_UPS_TOLERANCE);
        entry.pass = passes(labelled, entry.rel_error);
        if (swapped(id)) {
            const swappedMeans = means(swappedList);
            const swappedPass = passes(swappedList, swappedMeans.rel_error);
            entry.swapped_with = mapping.get(id);
            entry.swapped = { sim: swappedList, max_diff: worst(diffs(g, swappedList)), sim_mean: swappedMeans.mean, rel_error: swappedMeans.rel_error, pass: swappedPass };
            entry.matches_with_roles_swapped = !entry.pass && swappedPass;
        }
        wake[id] = entry;
    }

    // production bins: items dropped by the inserters that take the product out, which the game's recording names
    const { outputInserters, recipesMaking } = dist("harness/recording-output.js");
    const outputIds = outputInserters(game, recipesMaking(config, config.setpoint.recipe)).map(it => gameMatch.inserters.get(it.id)).filter(id => id !== undefined);
    const dropped = (series, periods) => periods.map(period => {
        let items = 0;
        for (const id of outputIds) {
            const held = series.get(id)?.held ?? [];
            for (let i = Math.max(period.start, 1); i < period.end; i++) if (held[i] < held[i - 1]) items += held[i - 1] - held[i];
        }
        return items;
    });
    const gameBins = dropped(gameSeries, gamePeriods), simBins = dropped(simSeries, simPeriods);
    const relative = judgedIdx.map(p => gameBins[p] === 0 ? (simBins[p] === 0 ? 0 : Infinity) : Math.abs(simBins[p] - gameBins[p]) / gameBins[p]);
    const bins = {
        output_inserters: outputIds, game: sel(gameBins, judgedIdx), sim: sel(simBins, judgedIdx),
        max_relative_diff: Math.max(0, ...relative), periods_over_tolerance: relative.filter(r => r > BINS_TOLERANCE).length,
    };
    bins.pass = bins.periods_over_tolerance === 0;

    // hands, windows
    const hands = {}, windows = {};
    const gj = gamePeriods.filter((_, p) => p >= first), sj = simPeriods.filter((_, p) => p >= first);
    for (const id of ids) {
        const g = gameSeries.get(id);
        const labelled = simSeries.get(id), other = simSeries.get(mapping.get(id));
        const one = s => {
            const gt = transfersPerPeriod(g, gameClock, gj), st = transfersPerPeriod(s, simClock, sj);
            const pickups = pairLists(gt, st, period, e => e[0]), drops = pairLists(gt, st, period, e => e[1]);
            const held = agreement(g, s, gj, sj, "held"), status = agreement(g, s, gj, sj, "status");
            const ge = enableEdgesPerPeriod(g, gameClock, gj), se = enableEdgesPerPeriod(s, simClock, sj);
            const edges = pairLists(ge.map(l => l.map(x => [x])), se.map(l => l.map(x => [x])), period, e => e[0]);
            return {
                hands: {
                    transfers: pickups.game_entries, periods_with_other_transfer_count: pickups.length_differs,
                    pickup_delta: distribution(pickups.deltas), drop_delta: distribution(drops.deltas),
                    hand_agreement: held.share, status_agreement: status.share,
                    status_differing_positions: Object.keys(status.differing).length, hand_differing_positions: Object.keys(held.differing).length,
                },
                windows: { enables: edges.game_entries, periods_with_other_enable_count: edges.length_differs, enable_delta: distribution(edges.deltas) },
            };
        };
        const a = one(labelled);
        hands[id] = a.hands; windows[id] = a.windows;
        hands[id].pass = ctx.cycle_mean ? null : a.hands.hand_agreement >= HANDS_AGREEMENT;
        if (swapped(id)) {
            const b = one(other);
            hands[id].swapped_with = mapping.get(id); hands[id].swapped = b.hands;
            hands[id].matches_with_roles_swapped = b.hands.hand_agreement > a.hands.hand_agreement && b.hands.hand_agreement >= HANDS_AGREEMENT;
            windows[id].swapped = b.windows;
        }
    }
    const error = {
        // per period, or (builds that repeat over more than one period) the relative errors of the means
        wake_ups: ctx.cycle_mean ? sum(ids.map(id => wake[id].rel_error)) : sum(ids.map(id => sum(wake[id].game.map((x, i) => Math.abs(x - wake[id].sim[i]))))),
        bins: sum(judgedIdx.map((p, i) => Math.abs(gameBins[p] - simBins[p]))),
        hands: sum(ids.map(id => 1 - (hands[id].hand_agreement ?? 0))),
        windows: sum(ids.map(id => windows[id].periods_with_other_enable_count + sum(Object.entries(windows[id].enable_delta).filter(([k]) => k !== "0").map(([, v]) => v)))),
    };
    return {
        dispatch: DISPATCH, periods_compared: judgedIdx.length,
        cycle: { game: ctx.cycles.game, sim: ctx.cycles.sim, wake_ups_judged_by: ctx.cycle_mean ? "mean a period over whole cycles" : "each period" },
        wake_ups: ctx.cycle_mean
            ? { tolerance: WAKE_UPS_CYCLE_TOLERANCE, rule: RULE, max_rel_error: Math.max(0, ...ids.map(id => wake[id].rel_error)), pass: ids.every(id => wake[id].pass), inserters: wake }
            : { tolerance: WAKE_UPS_TOLERANCE, rule: RULE, pass: ids.every(id => wake[id].pass), inserters: wake },
        bins: { tolerance: BINS_TOLERANCE, ...bins },
        hands: ctx.cycle_mean
            ? { pass: null, note: "distribution only: the build repeats over more than one period", inserters: hands }
            : { pass: ids.every(id => hands[id].pass), tolerance: HANDS_AGREEMENT, inserters: hands },
        windows: { pass: null, note: "distribution only", inserters: windows },
        role_groups: groups.map(members => ({ inserters: members, simulated_as: members.map(id => mapping.get(id)) })),
        error,
        pass: ids.every(id => wake[id].pass) && bins.pass && (ctx.cycle_mean || ids.every(id => hands[id].pass)),
    };
}

async function check() {
    const name = opt("--name") ?? path.basename(opt("--recording")).replace(/\..*$/, "");
    const out = opt("--out");
    fs.mkdirSync(out, { recursive: true });
    const staged = flag("--staged");
    const clockFile = opt("--clock-file");
    const clockFileIdentity = clockFile === undefined ? undefined : clockFileHash(clockFile);
    const wantedHash = opt("--hash") ?? clockFileIdentity;
    if (wantedHash === undefined) throw new Error("give --hash <clock hash prefix> or --clock-file <exported clock>");
    if (clockFileIdentity !== undefined && !clockFileIdentity.startsWith(wantedHash)) throw new Error(`--clock-file ${clockFile} has the identity hash ${clockFileIdentity}, which does not start with --hash ${wantedHash}`);
    const work = fs.mkdtempSync(path.join(out, `.${name}-`));
    try {
        // the clock, among the alternatives the generator makes
        const foundFile = path.join(work, "clock.json");
        await child("find", ["--hash", wantedHash, "--out", foundFile]);
        const clock = JSON.parse(fs.readFileSync(foundFile, "utf8"));
        if (clock.not_found) throw new Error(`No clock with hash ${wantedHash}; alternatives: ${clock.alternatives.join(", ")}`);
        clock.found_under = DISPATCH;

        const { parseRecording } = dist("verification/recording.js");
        const { matchRecordingToConfig } = dist("verification/entity-matching.js");
        const game = parseRecording(JSON.parse(fs.readFileSync(opt("--recording"), "utf8")));
        if (staged) { // a staged recording counts its clock from its first sample
            game.clock = { values: Array.from({ length: game.sample_count }, (_, tick) => tick % clock.clock_ticks) };
        }
        const periods = coldPeriods(game, clock.clock_ticks, staged);
        const config = await configOf();
        const gameMatch = matchRecordingToConfig(game, config);
        const { settling, seed } = seedOfRecording(game, gameMatch, config, clock, { staged, how: opt("--seed-at") ?? "settled" });
        const seedFile = path.join(work, "seed.json");
        if (seed.applied) fs.writeFileSync(seedFile, JSON.stringify(seedInput(seed)));
        // the cold run, and the seeded one where the recording gives a seed
        const runs = {};
        await Promise.all([false, true].filter(seeded => !seeded || seed.applied).map(async seeded => {
            const file = path.join(work, `sim${seeded ? "-seeded" : ""}.json`);
            await child("simulate", ["--clock", foundFile, "--out", file, "--periods", String(seeded ? seededPeriods(game, clock.clock_ticks, seed) : periods), ...(staged ? ["--staged"] : []), ...(seeded ? ["--seed", seedFile] : []),
                ...(opt("--sim-offset") ? ["--sim-offset", opt("--sim-offset")] : [])]);
            runs[seeded ? "seeded" : "cold"] = JSON.parse(fs.readFileSync(file, "utf8"));
        }));
        const sim = runs.cold, seededSim = runs.seeded;

        const byWindows = {};
        for (const [entity, ranges] of Object.entries(clock.windows)) {
            if (!entity.startsWith("inserter:") || ranges.length === 0) continue;
            (byWindows[JSON.stringify(ranges)] ??= []).push(Number(entity.slice("inserter:".length)));
        }
        const state = cp.execFileSync("python3", [path.join(ROOT, "scripts", "blast", "key.py"), "--state", path.resolve(ROOT, "..")], { encoding: "utf8" }).trim();
        const hash8 = clock.hash.slice(0, 8);
        const label = KNOWN_MISS[hash8] !== undefined ? "known miss (biochamber)" : TRUE_COUNT[hash8] !== undefined ? "true count" : "rule on recording";
        const offsetUsed = Number(opt("--sim-offset") ?? (staged ? STAGED_SIM_OFFSET : DEFAULT_SIM_OFFSET));
        const stamp = {
            tool: "sim-game-check", format: 3, build: name, game_side: label, game_side_basis: KNOWN_MISS[hash8] ?? TRUE_COUNT[hash8] ?? "the rule applied to the recording",
            closer_excluded: KNOWN_MISS[hash8] ?? null,
            engine_state: state,
            recording: { file: path.basename(opt("--recording")), sha256: sha256File(opt("--recording")), samples: game.sample_count, factorio_version: game.factorio_version ?? null },
            clock_hash: clock.hash, clock_period: clock.clock_ticks, clock_found_under: clock.found_under, clock_alternative: clock.alternative, clock_selected: clock.selected,
            staged, seed_items: opt("--seed-items") === undefined ? null : Number(opt("--seed-items")),
            alignment: { simulated_tick_to_clock_position: offsetUsed, default: DEFAULT_SIM_OFFSET, differs_from_default: offsetUsed !== DEFAULT_SIM_OFFSET },
            first_period_left_out: true,
            tolerances: { wake_ups_per_period: WAKE_UPS_TOLERANCE, wake_ups_cycle_mean_relative: WAKE_UPS_CYCLE_TOLERANCE, bins_relative: BINS_TOLERANCE, hands_agreement: HANDS_AGREEMENT },
        };
        if (offsetUsed !== DEFAULT_SIM_OFFSET) console.log(`${name}: alignment offset ${offsetUsed} differs from the default ${DEFAULT_SIM_OFFSET}`);
        // the periods of the two are judged one by one only where neither the game's recording nor the simulated one repeats over more than one
        const paired = pairPeriods(game, sim, staged);
        const cycles = cyclesOf(game, gameMatch, sim, paired);
        const cycleMean = cycles.game > 1 || cycles.sim > 1;
        const seededPaired = seed.applied ? pairSeeded(game, seededSim, seed.sample) : undefined;
        const seededCycles = seed.applied ? cyclesOf(game, gameMatch, seededSim, seededPaired) : undefined;
        // the seeded run is judged where there is one; the cycle decides how its periods are judged as it does for the cold one
        const seededCycleMean = seed.applied && (seededCycles.game > 1 || seededCycles.sim > 1);
        const seedStamp = seed.applied
            ? { applied: true, complete: seed.complete, source: seed.source, seed_sample: seed.sample, settling, position_of_seed_sample: seed.position, sim_tick_0_is_game_sample: seed.sample + 1, not_seeded: seed.not_seeded, machines_seeded: Object.keys(seed.start_stock).length, hands_not_empty: seed.hands_not_empty, bars_worked_back: seed.bars_worked_back }
            : { applied: false, source: seed.source, reason: seed.reason };
        const ctx = { config, game, gameMatch, clock, period: clock.clock_ticks, staged, groups: byWindows };
        const cold = judge({ ...ctx, paired, cycles, cycle_mean: cycleMean }, sim);
        let judged = cold, result = { ...cold, judged_run: "cold" };
        if (seed.applied) {
            const seededRun = judge({ ...ctx, paired: seededPaired, cycles: seededCycles, cycle_mean: seededCycleMean }, seededSim);
            // an incomplete seed is reported (under "seeded") and the cold run stays the judged one
            if (seed.complete) { judged = seededRun; result = { ...judged, judged_run: "seeded", cold }; }
            else result = { ...cold, judged_run: "cold", seeded: seededRun };
        }
        // the periods of the game's recording that are still unsettled, and which of the bins' failures are in them
        const used = seed.applied && seed.complete ? seededPaired : paired;
        const gameJudged = used.game.slice(0, Math.min(used.game.length, used.sim.length));
        const unsettled = unsettledPeriods(game, gameMatch, gameJudged);
        const failing = judged.bins.game.flatMap((g, p) => (g === 0 ? judged.bins.sim[p] !== 0 : Math.abs(judged.bins.sim[p] - g) / g > BINS_TOLERANCE) ? [p] : []);
        result.bins.unsettled = { ...unsettled, failing_periods: failing, failing_in_unsettled: failing.filter(p => unsettled.drifting_periods.includes(p)), failing_after_settled: failing.filter(p => !unsettled.drifting_periods.includes(p)) };
        const file = path.join(out, `${name}.${KEY}.json`);
        fs.writeFileSync(file, JSON.stringify({ ...stamp, judged_run: result.judged_run, seed: seedStamp, flag: KEY, ...result }, null, 1) + "\n");
        const written = { [KEY]: { file: path.basename(file), dispatch: DISPATCH, judged_run: result.judged_run, pass: result.pass, wake_ups: result.wake_ups.pass, bins: result.bins.pass, hands: result.hands.pass, periods_compared: result.periods_compared } };
        const line = r => `wake-ups ${r.wake_ups.pass ? "pass" : "FAIL"} (${r.cycle.wake_ups_judged_by}; cycle ${r.cycle.game}/${r.cycle.sim}), bins ${r.bins.pass ? "pass" : "FAIL"}, hands ${r.hands.pass === null ? "-" : r.hands.pass ? "pass" : "FAIL"}`;
        console.log(`${name} (${DISPATCH}): ${seed.applied ? `${seed.complete ? "seeded (judged)" : "seeded (incomplete: not judged)"}: ${line(result.seeded ?? judged)} | cold${seed.complete ? "" : " (judged)"}: ${line(cold)}` : `cold (no seed: ${seed.reason}): ${line(cold)}`} -> ${file}`);
        writeCombined(out, name, { stamp, clock, written, clockFile, clockFileIdentity, game });
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

/** the file a config key or path names, for the sha256 stamp (a sample key gives the sample's file) */
function configFileOf(config) {
    const { ConfigPaths } = dist("config/config-paths.js");
    const file = ConfigPaths[config] ?? config;
    return fs.existsSync(file) ? file : undefined;
}

/**
 * The one result file that anything gating on the check reads: <name>.check.json. "pass" is the dispatch's verdict (activation order); its verdict
 * by kind stays under "dispatches" (key "on"), and the full result file stays beside it. "inputs" are the sha256 of the files
 * the verdict was judged on; the scaffold is the blueprint the recording was made on (--scaffold, else the config's <name>.scaffold beside it).
 */
function writeCombined(out, name, { stamp, clock, written, clockFile, clockFileIdentity, game }) {
    const inputs = { recording: sha256File(opt("--recording")) };
    const configFile = configFileOf(opt("--config"));
    if (configFile !== undefined) inputs.config = sha256File(configFile);
    if (clockFile !== undefined) inputs.clock = sha256File(clockFile);
    const scaffold = opt("--scaffold") ?? (configFile === undefined ? undefined : scaffoldOf(configFile));
    if (scaffold !== undefined && fs.existsSync(scaffold)) inputs.scaffold = sha256File(scaffold);
    const combined = {
        tool: "sim-game-check", format: 1, kind: "check-result", build: name,
        pass: written[KEY].pass === true,
        pass_basis: `the dispatch (${DISPATCH}): wake-ups, bins and hands; windows have no verdict`,
        made: new Date().toISOString(),
        game_version: game.factorio_version ?? null,
        inputs,
        clock: { hash: clock.hash, period: clock.clock_ticks, alternative: clock.alternative, file_identity_hash: clockFileIdentity ?? null },
        recording: stamp.recording, engine_state: stamp.engine_state, game_side: stamp.game_side, tolerances: stamp.tolerances,
        dispatches: written,
    };
    fs.writeFileSync(path.join(out, `${name}.check.json`), JSON.stringify(combined, null, 1) + "\n");
    console.log(`${name}: combined result ${name}.check.json: pass ${combined.pass}`);
}

// ---- the table of a folder of results ----

const short = x => x === null || x === undefined ? "-" : typeof x === "number" ? (Math.round(x * 1000) / 1000).toString() : String(x);
/** a series a period: one value a number of times when it does not change, else its mean and range (the files hold the series) */
const compact = list => {
    if (list.length === 0) return "-";
    if (list.every(v => v === list[0])) return `${list[0]}x${list.length}`;
    return `mean ${short(sum(list) / list.length)} [${Math.min(...list)}-${Math.max(...list)}]`;
};

function summarise(folder) {
    const names = [...new Set(fs.readdirSync(folder).filter(f => f.endsWith(`.${KEY}.json`)).map(f => f.slice(0, -`.${KEY}.json`.length)))].sort();
    const lines = [];
    const table = ["| build | game side | start judged | judged by | wake-ups | bins | hands | other start (reported): wake-ups | bins | hands | alignment offset |", "|---|---|---|---|---|---|---|---|---|---|---|"];
    const excluded = [];
    for (const name of names) {
        const r = JSON.parse(fs.readFileSync(path.join(folder, `${name}.${KEY}.json`), "utf8"));
        // a build left out of the verdict is shown as excluded, never as failing (its file keeps the values the check computed)
        const word = v => r.closer_excluded ? "excluded" : v === null ? "-" : v ? "pass" : "FAIL";
        if (r.closer_excluded) excluded.push(`${name}: ${r.closer_excluded}`);
        const offset = r.alignment.simulated_tick_to_clock_position;
        // the start that is not judged: the cold run where the seeded one is judged, the incomplete seeded run where the cold one is (none for a staged start)
        const other = r.judged_run === "seeded" ? r.cold : r.seeded;
        const otherWord = kind => other === undefined ? "-" : word(other[kind].pass);
        table.push(`| ${name} | ${r.game_side} | ${r.judged_run}${r.seed.applied && !r.seed.complete ? " (seed incomplete)" : ""} | ${r.cycle.wake_ups_judged_by} (cycles game ${r.cycle.game}, sim ${r.cycle.sim}) | ${word(r.wake_ups.pass)} | ${word(r.bins.pass)} | ${word(r.hands.pass)} | ${otherWord("wake_ups")} | ${otherWord("bins")} | ${otherWord("hands")} | ${offset}${r.alignment.differs_from_default ? ` (differs from ${r.alignment.default})` : ""} |`);
        lines.push("", `## ${name} (clock ${r.clock_hash.slice(0, 8)}, period ${r.clock_period}, game side: ${r.game_side}, ${r.periods_compared} periods compared, alignment offset ${offset}${r.alignment.differs_from_default ? `, differs from ${r.alignment.default}` : ""})`);
        if (r.closer_excluded) lines.push(`left out of the verdict: ${r.closer_excluded}`);
        const startOf = seed => `the recording's sample ${seed.seed_sample ?? 0} (clock position ${seed.position_of_seed_sample ?? seed.position_of_first_sample}, ${seed.machines_seeded} machines)`;
        lines.push(r.seed.applied
            ? `start: ${r.seed.complete ? `judged on the run seeded from ${startOf(r.seed)}; the cold run is reported in the table and under "cold" in the file` : `the seed from ${startOf(r.seed)} lacks what the simulator cannot take, so the run from it is reported (under "seeded" in the file) and the cold run is judged`}. `
                + (r.seed.settling ? `Seed sample: ${r.seed.settling.reason}${r.seed.settling.settles === false ? " (NOT SETTLED)" : ""}. ` : "")
                + `Not seeded: ${r.seed.not_seeded.join("; ")}`
            : `start: no seeded run (${r.seed.reason}); the cold run is judged`);
        const cycleMean = r.cycle.wake_ups_judged_by !== "each period";
        lines.push(`${r.dispatch}: wake-ups judged by ${r.cycle.wake_ups_judged_by}`
            + (cycleMean ? `; relative errors of the means (tolerance ${r.wake_ups.tolerance}): max ${short(r.wake_ups.max_rel_error)}, over tolerance ${Object.values(r.wake_ups.inserters).filter(w => !w.pass).length} of ${Object.keys(r.wake_ups.inserters).length}` : ""));
        for (const [id, w] of Object.entries(r.wake_ups.inserters)) {
            const differs = cycleMean ? !w.pass : w.max_diff > 0;
            lines.push(`  wake-ups inserter:${id}: game ${compact(w.game)} | sim ${compact(w.sim)} | ` + (cycleMean ? `means game ${short(w.game_mean)} sim ${short(w.sim_mean)}, relative error ${short(w.rel_error)}` : `max diff ${w.max_diff}, mean diff ${short(w.mean_diff)}`) + ` | ${w.pass ? "pass" : "FAIL"}`
                + (w.matches_with_roles_swapped ? ` | matches with roles swapped (as inserter:${w.swapped_with}: ${compact(w.swapped.sim)})` : differs && w.swapped ? ` | swapped with inserter:${w.swapped_with}: ${cycleMean ? `relative error ${short(w.swapped.rel_error)}` : `max diff ${w.swapped.max_diff}`}` : ""));
        }
        lines.push(`  bins: game ${compact(r.bins.game)} | sim ${compact(r.bins.sim)} | max relative diff ${short(r.bins.max_relative_diff)} | ${r.bins.pass ? "pass" : "FAIL"}`);
        const u = r.bins.unsettled;
        lines.push(`  bins, game's stock: ${u.drifting_periods.length === 0 ? "settled in every period compared" : `still drifting in ${u.drifting_periods.length} of ${u.periods_compared_by_stock} periods compared (periods ${compact(u.drifting_periods)}, settled from period ${u.settled_from})`}`
            + (u.failing_periods.length === 0 ? "" : `; periods over the bins tolerance: ${u.failing_periods.length}, ${u.failing_in_unsettled.length} of them in the drifting periods, ${u.failing_after_settled.length} after they settle`));
        for (const [id, h] of Object.entries(r.hands.inserters)) {
            lines.push(`  hands inserter:${id}: ${h.transfers} transfers, pickup delta ${JSON.stringify(h.pickup_delta)}, drop delta ${JSON.stringify(h.drop_delta)}, `
                + `hand agrees ${short(h.hand_agreement)}, status agrees ${short(h.status_agreement)}${h.pass === null || h.pass === undefined ? "" : h.pass ? " | pass" : " | FAIL"}`
                + (h.matches_with_roles_swapped ? ` | matches with roles swapped (as inserter:${h.swapped_with}: hand ${short(h.swapped.hand_agreement)})` : ""));
        }
        for (const [id, w] of Object.entries(r.windows.inserters)) {
            lines.push(`  windows inserter:${id}: ${w.enables} enables, delta ${JSON.stringify(w.enable_delta)}, periods with another count ${w.periods_with_other_enable_count}`);
        }
        lines.push(`error: ${JSON.stringify(r.error)}`);
    }
    const tol = names.length === 0 ? undefined : JSON.parse(fs.readFileSync(path.join(folder, `${names[0]}.${KEY}.json`), "utf8")).tolerances;
    const tolerances = tol === undefined ? [] : [`Tolerances: wake-ups within ${tol.wake_ups_per_period} a period per inserter where the cycle is one period, else the mean within ${tol.wake_ups_cycle_mean_relative * 100}% (relative to the game's, at least 1 a period as the base); bins within ${tol.bins_relative * 100}% a period; hands equal at ${tol.hands_agreement * 100}% of the positions where the cycle is one period (no pass/fail otherwise).`, ""];
    const note = excluded.length > 0 ? ["", "Left out of the verdict (shown as excluded): " + excluded.join("; ")] : [];
    return [...tolerances, ...table, ...note, ...lines].join("\n") + "\n";
}

(async () => {
    const mode = process.argv[2];
    if (mode === "find") return find();
    if (mode === "simulate") return simulate();
    if (mode === "check") return check();
    if (mode === "summary") {
        const text = summarise(process.argv[3]);
        fs.writeFileSync(path.join(process.argv[3], "summary.md"), text);
        return console.log(text);
    }
    if (mode === "builds") {
        const builds = JSON.parse(fs.readFileSync(path.join(__dirname, "sim-game-check", "builds.json"), "utf8"));
        const only = opt("--only")?.split(",");
        for (const build of builds.filter(it => !only || only.includes(it.name))) {
            const config = build.config.endsWith(".json") ? path.join(__dirname, "sim-game-check", build.config) : build.config;
            const args = [__filename, "check", "--name", build.name, "--config", config, "--hash", build.hash, "--recording", path.join(opt("--recordings"), build.recording), "--out", opt("--out"),
                ...(build.staged ? ["--staged"] : []), ...(build.seed_items !== undefined ? ["--seed-items", String(build.seed_items)] : [])];
            cp.execFileSync(process.execPath, args, { stdio: "inherit" });
        }
        return;
    }
    console.error("usage: node scripts/sim-game-check.js check|builds|summary ... (see the top of the file)");
    process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });
