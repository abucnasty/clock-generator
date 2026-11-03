// node scripts/sim-game-check.js check   --config <sample key | config file> --hash <clock hash prefix> --recording <recording file>
//                                        --out <folder> [--name <build>] [--staged] [--seed-items <n>] [--sim-offset <ticks>]
// node scripts/sim-game-check.js builds  --recordings <folder> --out <folder> [--only a,b]    the check of every build of sim-game-check/builds.json
// node scripts/sim-game-check.js summary <out folder>                                         the table of the result files in a folder
//
// The simulator against the game for one build, to judge the inserter dispatch (CLOCK_NEW_DISPATCH): a stored recording of
// the game running a clock is laid against the simulator's run of the same clock under the old dispatch (configured order,
// "off") and the new one (activation order, "on"), per inserter and per clock period, one kind at a time:
//   wake-ups  the wake-up rule "kept-lists" (crafting/wake-ups.ts) on the game's recording and on each simulated one;
//             pass: within WAKE_UPS_TOLERANCE of the game in every period, for every inserter
//   bins      the items the output inserters drop in each period; pass: within BINS_TOLERANCE of the game in every period
//   hands     pickup and drop positions of every transfer, and the hand and status at every clock position; no pass/fail
//   windows   the positions an inserter is enabled at (an edge of its control behaviour); no pass/fail
// Inserters whose windows are identical cannot be told apart by the clock; where only a swap of their roles matches, the
// line says "matches with roles swapped". The first clock period of the recording is left out, as the scaffold tests leave
// it out; a staged start (--staged: the game began with the clock, the simulator runs cold from its first tick) is paired
// the same way. Totals over inserters are never compared. The tolerances are a first guess.
//
// A game side is labelled "true count" where the rule was checked against the game's own wake-ups on that build (TRUE_COUNT
// below), else "rule on recording". Needs `npx tsc` first. One result file a build and dispatch: <name>.off.json, <name>.on.json.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
// the rule is named in every call below: the parent's own dispatch plays no part; each simulation child sets its own
if (process.argv[2] !== "find" && process.argv[2] !== "simulate") delete process.env.CLOCK_NEW_DISPATCH;

const argv = process.argv.slice(3);
// lib.js moves to the generator's folder: what names a file is made absolute first (a config that is not a file is a sample's key)
const PATH_OPTIONS = ["--recording", "--out", "--recordings", "--clock"];
for (const name of PATH_OPTIONS) { const i = argv.indexOf(name); if (i >= 0 && argv[i + 1] !== undefined) argv[i + 1] = path.resolve(argv[i + 1]); }
{ const i = argv.indexOf("--config"); if (i >= 0 && argv[i + 1] !== undefined && fs.existsSync(path.resolve(argv[i + 1]))) argv[i + 1] = path.resolve(argv[i + 1]); }
if (process.argv[3] !== undefined && !process.argv[3].startsWith("--")) process.argv[3] = path.resolve(process.argv[3]);
const { ROOT, dist, quiet, loadSample } = require("./lib");

const WAKE_UPS_TOLERANCE = 1; // wake-ups per inserter per period
const BINS_TOLERANCE = 0.005; // share of the game's items in a period
const RULE = "kept-lists";
const DEFAULT_SIM_OFFSET = 3; // SIMULATED_TICK_TO_CLOCK_POSITION
// measured on the staged agricultural recording: with 3 every one of its 745 enable edges of every inserter sits 1 tick before the game's
const STAGED_SIM_OFFSET = 4;
const TRUE_COUNT = { // clock hash prefix: what checked the rule against the game's own wake-ups
    "3bc059b3": "front-exit normal mirrored backed: wake-ups read in the running game",
    "ba2c26f4": "electromagnetic science: wake-ups read in the running game",
};
const DISPATCHES = { off: "configured-order", on: "activation-order" };

const opt = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flag = name => argv.includes(name);
const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
/** the circular difference b - a on a clock of `period` positions, in (-period/2, period/2] */
const circular = (a, b, period) => { const d = (((b - a) % period) + period) % period; return d > period / 2 ? d - period : d; };
const permutations = items => items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
const sum = list => list.reduce((a, b) => a + b, 0);

// ---- the children: the clock to simulate, and a simulated recording, each under the dispatch their environment names ----

/** the build's config; with `seeded`, the egg-style seed of a loop given as the game accepted it (the clock is made on the config as it is) */
async function configOf(seeded = false) {
    const config = await loadSample(opt("--config"));
    if (seeded && opt("--seed-items") !== undefined) config.overrides = { ...config.overrides, loop_seed_items: Number(opt("--seed-items")) };
    return config;
}

/** finds the clock with the hash among the alternatives the generator makes under this process's dispatch */
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

/** a run of the clock in the simulator, as a recording, under this process's dispatch */
async function simulate() {
    const { simulateClockOnly } = dist("crafting/generate-blueprint.js");
    const { recordingOfStock, SIMULATED_TICK_TO_CLOCK_POSITION } = dist("verification/simulated-recording.js");
    const config = await configOf(true);
    const clock = JSON.parse(fs.readFileSync(opt("--clock"), "utf8"));
    const staged = flag("--staged");
    const stock = simulateClockOnly(config, clock.windows, clock.period, Number(opt("--periods")), quiet, staged ? { warmup_periods: 0 } : {});
    const recording = recordingOfStock(stock, config, clock.clock_ticks);
    // the rule on the simulator's own states, read from its stock (a recording of it leaves out what the rule reads of a belt's room and a machine's placed results)
    const { wakeUpsOfStock } = dist("crafting/wake-ups.js");
    const { inserterEnds } = dist("crafting/inserter-counters.js");
    const wake_ticks = {};
    wakeUpsOfStock(stock, inserterEnds(config), 0, (inserter_id, tick) => (wake_ticks[inserter_id] ??= []).push(tick), RULE);
    recording.wake_ticks = wake_ticks;
    const offset = Number(opt("--sim-offset") ?? (staged ? STAGED_SIM_OFFSET : SIMULATED_TICK_TO_CLOCK_POSITION));
    recording.clock.values = recording.clock.values.map((_, tick) => (tick + offset) % clock.clock_ticks);
    fs.writeFileSync(opt("--out"), JSON.stringify(recording));
}

function child(mode, extra, env) {
    return new Promise((resolve, reject) => {
        const args = [__filename, mode, "--config", opt("--config"), ...extra];
        if (opt("--seed-items") !== undefined) args.push("--seed-items", opt("--seed-items"));
        const run = cp.spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
        run.on("exit", code => code === 0 ? resolve() : reject(new Error(`${mode} exited with ${code}`)));
    });
}
// "off" keeps the old dispatch and has the stock record what the rule "kept-lists" reads (simulation/dispatch.ts)
const dispatchEnv = key => ({ CLOCK_NEW_DISPATCH: key === "on" ? "1" : "configured-order,kept-lists" });

// ---- reading a recording per period ----

/** the sample ranges of the periods, a game's and a simulator's, paired by index; the first of the game's is left out unless it is staged */
function pairPeriods(game, sim, staged) {
    const { clockPeriods } = dist("harness/recording-output.js");
    const g = clockPeriods(game.clock.values);
    const s = clockPeriods(sim.clock.values);
    // a staged start has no settling: the simulator's run is cold and from its first tick, and is judged from its first period
    if (staged) return { game: g.slice(1), sim: s };
    // a simulated run is judged on what follows its first third, as the scaffold tests judge it
    const settled = s.filter(it => it.start >= Math.floor(sim.sample_count / 3));
    return { game: g.slice(1), sim: settled };
}

const rangeOf = periods => ({ from: periods[0].start, to: periods[periods.length - 1].end });
const binOf = (periods, sample) => { let lo = 0, hi = periods.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (periods[mid].start <= sample) lo = mid; else hi = mid - 1; } return lo; };

/** the wake-ups of each inserter (config id) in each period given, by the rule */
function wakesPerPeriod(recording, match, config, periods) {
    const { wakeUpsOfRecording } = dist("verification/recording-wake-ups.js");
    const counts = new Map();
    const { from, to } = rangeOf(periods);
    wakeUpsOfRecording(recording, match, from, to, config, RULE, (inserter_id, tick) => {
        if (tick < from || tick >= to) return;
        const list = counts.get(inserter_id) ?? new Array(periods.length).fill(0);
        list[binOf(periods, tick)]++;
        counts.set(inserter_id, list);
    });
    return counts;
}

/** the wake-ups of each inserter in each period, from the ticks the simulator's run counted them at */
function wakesFromTicks(wake_ticks, periods) {
    const { from, to } = rangeOf(periods);
    const counts = new Map();
    for (const [inserter_id, ticks] of Object.entries(wake_ticks)) {
        const list = new Array(periods.length).fill(0);
        for (const tick of ticks) if (tick >= from && tick < to) list[binOf(periods, tick)]++;
        counts.set(inserter_id, list);
    }
    return counts;
}

/** by config id: the recording's series of each inserter */
function insertersByConfigId(recording, match) {
    const { expandChangeList } = dist("verification/recording.js");
    const { extractTransfers } = dist("verification/recording-history.js");
    const clock = recording.clock.values;
    return new Map(recording.inserters.flatMap(inserter => {
        const id = match.inserters.get(inserter.id);
        if (id === undefined) return [];
        return [[id, {
            held: inserter.samples.held_count,
            status: expandChangeList(inserter.samples.status, recording.sample_count, ""),
            transfers: extractTransfers(inserter, clock),
        }]];
    }));
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

function judge(ctx, simRecording, key) {
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
        const entry = {
            game: g, sim: labelled,
            max_diff: worst(diffs(g, labelled)), periods_over_tolerance: diffs(g, labelled).filter(d => d > WAKE_UPS_TOLERANCE).length,
        };
        entry.pass = entry.periods_over_tolerance === 0;
        // where the build's cycle is longer than the clock period, the periods of the two are cut at other places of it: the means say how far apart the rates are
        entry.mean_diff = g.length === 0 ? 0 : (sum(labelled) - sum(g)) / g.length;
        if (swapped(id)) {
            const swappedPass = diffs(g, swappedList).every(d => d <= WAKE_UPS_TOLERANCE);
            entry.swapped_with = mapping.get(id);
            entry.swapped = { sim: swappedList, max_diff: worst(diffs(g, swappedList)), pass: swappedPass };
            entry.matches_with_roles_swapped = !entry.pass && swappedPass;
        }
        wake[id] = entry;
    }

    // production bins: items dropped by the inserters that take the product out, which the game's recording names
    const { outputInserters, recipesMaking } = dist("harness/recording-output.js");
    const outputIds = outputInserters(game, recipesMaking(config, config.target_output.recipe)).map(it => gameMatch.inserters.get(it.id)).filter(id => id !== undefined);
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
        if (swapped(id)) {
            const b = one(other);
            hands[id].swapped_with = mapping.get(id); hands[id].swapped = b.hands;
            hands[id].matches_with_roles_swapped = b.hands.hand_agreement > a.hands.hand_agreement && b.hands.hand_agreement >= 0.99;
            windows[id].swapped = b.windows;
        }
    }
    const error = {
        wake_ups: sum(ids.map(id => sum(wake[id].game.map((x, i) => Math.abs(x - wake[id].sim[i]))))),
        wake_ups_mean: sum(ids.map(id => Math.abs(wake[id].mean_diff))),
        bins: sum(judgedIdx.map((p, i) => Math.abs(gameBins[p] - simBins[p]))),
        hands: sum(ids.map(id => 1 - (hands[id].hand_agreement ?? 0))),
        windows: sum(ids.map(id => windows[id].periods_with_other_enable_count + sum(Object.entries(windows[id].enable_delta).filter(([k]) => k !== "0").map(([, v]) => v)))),
    };
    return {
        dispatch: DISPATCHES[key], periods_compared: judgedIdx.length,
        wake_ups: { tolerance: WAKE_UPS_TOLERANCE, rule: RULE, pass: ids.every(id => wake[id].pass), inserters: wake },
        bins: { tolerance: BINS_TOLERANCE, ...bins },
        hands: { pass: null, note: "distribution only", inserters: hands },
        windows: { pass: null, note: "distribution only", inserters: windows },
        role_groups: groups.map(members => ({ inserters: members, simulated_as: members.map(id => mapping.get(id)) })),
        error,
        pass: ids.every(id => wake[id].pass) && bins.pass,
    };
}

async function check() {
    const name = opt("--name") ?? path.basename(opt("--recording")).replace(/\..*$/, "");
    const out = opt("--out");
    fs.mkdirSync(out, { recursive: true });
    const staged = flag("--staged");
    const work = fs.mkdtempSync(path.join(out, `.${name}-`));
    try {
        // the clock: found under the old dispatch, else under the new one (a moved pick is the new one's alone)
        const clockFile = path.join(work, "clock.json");
        let clock;
        for (const key of ["off", "on"]) {
            await child("find", ["--hash", opt("--hash"), "--out", clockFile], dispatchEnv(key));
            clock = JSON.parse(fs.readFileSync(clockFile, "utf8"));
            if (!clock.not_found) { clock.found_under = DISPATCHES[key]; break; }
        }
        if (clock.not_found) throw new Error(`No clock with hash ${opt("--hash")} under either dispatch; alternatives: ${clock.alternatives.join(", ")}`);

        const { parseRecording } = dist("verification/recording.js");
        const { matchRecordingToConfig } = dist("verification/entity-matching.js");
        const game = parseRecording(JSON.parse(fs.readFileSync(opt("--recording"), "utf8")));
        if (staged) { // a staged recording counts its clock from its first sample
            game.clock = { values: Array.from({ length: game.sample_count }, (_, tick) => tick % clock.clock_ticks) };
        }
        const gamePeriodCount = Math.floor(game.sample_count / clock.clock_ticks);
        const periods = staged ? gamePeriodCount + 1 : Math.ceil(gamePeriodCount * 1.5) + 2;
        const sims = {};
        await Promise.all(Object.keys(DISPATCHES).map(async key => {
            const file = path.join(work, `sim-${key}.json`);
            await child("simulate", ["--clock", clockFile, "--out", file, "--periods", String(periods), ...(staged ? ["--staged"] : []),
                ...(opt("--sim-offset") ? ["--sim-offset", opt("--sim-offset")] : [])], dispatchEnv(key));
            sims[key] = JSON.parse(fs.readFileSync(file, "utf8"));
        }));

        const config = await configOf();
        const gameMatch = matchRecordingToConfig(game, config);
        const byWindows = {};
        for (const [entity, ranges] of Object.entries(clock.windows)) {
            if (!entity.startsWith("inserter:") || ranges.length === 0) continue;
            (byWindows[JSON.stringify(ranges)] ??= []).push(Number(entity.slice("inserter:".length)));
        }
        const state = cp.execFileSync("python3", [path.join(ROOT, "scripts", "blast", "key.py"), "--state", path.resolve(ROOT, "..")], { encoding: "utf8" }).trim();
        const label = TRUE_COUNT[clock.hash.slice(0, 8)] !== undefined ? "true count" : "rule on recording";
        const stamp = {
            tool: "sim-game-check", format: 1, build: name, game_side: label, game_side_basis: TRUE_COUNT[clock.hash.slice(0, 8)] ?? "the rule applied to the recording",
            engine_state: state,
            recording: { file: path.basename(opt("--recording")), sha256: sha256File(opt("--recording")), samples: game.sample_count, factorio_version: game.factorio_version ?? null },
            clock_hash: clock.hash, clock_period: clock.clock_ticks, clock_found_under: clock.found_under, clock_alternative: clock.alternative, clock_selected: clock.selected,
            staged, seed_items: opt("--seed-items") === undefined ? null : Number(opt("--seed-items")),
            alignment: { simulated_tick_to_clock_position: Number(opt("--sim-offset") ?? (staged ? STAGED_SIM_OFFSET : DEFAULT_SIM_OFFSET)) },
            first_period_left_out: true,
        };
        const periodsOf = {};
        for (const key of Object.keys(DISPATCHES)) {
            const paired = pairPeriods(game, sims[key], staged);
            const result = judge({ config, game, gameMatch, clock, period: clock.clock_ticks, paired, staged, groups: byWindows }, sims[key], key);
            const file = path.join(out, `${name}.${key}.json`);
            fs.writeFileSync(file, JSON.stringify({ ...stamp, flag: key, ...result }, null, 1) + "\n");
            periodsOf[key] = result;
            console.log(`${name} ${key} (${DISPATCHES[key]}): wake-ups ${result.wake_ups.pass ? "pass" : "FAIL"}, bins ${result.bins.pass ? "pass" : "FAIL"} -> ${file}`);
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// ---- the table of a folder of results ----

const CLOSER_KINDS = ["wake_ups", "wake_ups_mean", "bins", "hands", "windows"];
function closer(off, on, kind) {
    const a = off.error[kind], b = on.error[kind];
    return Math.abs(a - b) < 1e-9 ? "same" : a < b ? "off" : "on";
}
const short = x => x === null || x === undefined ? "-" : typeof x === "number" ? (Math.round(x * 1000) / 1000).toString() : String(x);
/** a series a period: one value a number of times when it does not change, else its mean and range (the files hold the series) */
const compact = list => {
    if (list.length === 0) return "-";
    if (list.every(v => v === list[0])) return `${list[0]}x${list.length}`;
    return `mean ${short(sum(list) / list.length)} [${Math.min(...list)}-${Math.max(...list)}]`;
};

function summarise(folder) {
    const names = [...new Set(fs.readdirSync(folder).filter(f => f.endsWith(".off.json")).map(f => f.slice(0, -".off.json".length)))].sort();
    const lines = [];
    const table = ["| build | game side | wake-ups: off / on | bins: off / on | closer: wake-ups | wake-ups by mean | bins | hands | windows |", "|---|---|---|---|---|---|---|---|---|---|"];
    for (const name of names) {
        const off = JSON.parse(fs.readFileSync(path.join(folder, `${name}.off.json`), "utf8"));
        const on = JSON.parse(fs.readFileSync(path.join(folder, `${name}.on.json`), "utf8"));
        const word = r => r === null ? "-" : r ? "pass" : "FAIL";
        table.push(`| ${name} | ${off.game_side} | ${word(off.wake_ups.pass)} / ${word(on.wake_ups.pass)} | ${word(off.bins.pass)} / ${word(on.bins.pass)} | ${CLOSER_KINDS.map(k => closer(off, on, k)).join(" | ")} |`);
        lines.push("", `## ${name} (clock ${off.clock_hash.slice(0, 8)}, period ${off.clock_period}, game side: ${off.game_side}, ${off.periods_compared} periods compared)`);
        for (const [key, r] of [["off", off], ["on", on]]) {
            lines.push(`${key} (${r.dispatch}):`);
            for (const [id, w] of Object.entries(r.wake_ups.inserters)) {
                const differs = w.max_diff > 0;
                lines.push(`  wake-ups inserter:${id}: game ${compact(w.game)} | sim ${compact(w.sim)} | max diff ${w.max_diff}, mean diff ${short(w.mean_diff)} | ${w.pass ? "pass" : "FAIL"}`
                    + (w.matches_with_roles_swapped ? ` | matches with roles swapped (as inserter:${w.swapped_with}: ${compact(w.swapped.sim)})` : differs && w.swapped ? ` | swapped with inserter:${w.swapped_with}: max diff ${w.swapped.max_diff}` : ""));
            }
            lines.push(`  bins: game ${compact(r.bins.game)} | sim ${compact(r.bins.sim)} | max relative diff ${short(r.bins.max_relative_diff)} | ${r.bins.pass ? "pass" : "FAIL"}`
                + "");
            for (const [id, h] of Object.entries(r.hands.inserters)) {
                lines.push(`  hands inserter:${id}: ${h.transfers} transfers, pickup delta ${JSON.stringify(h.pickup_delta)}, drop delta ${JSON.stringify(h.drop_delta)}, `
                    + `hand agrees ${short(h.hand_agreement)}, status agrees ${short(h.status_agreement)}`
                    + (h.matches_with_roles_swapped ? ` | matches with roles swapped (as inserter:${h.swapped_with}: hand ${short(h.swapped.hand_agreement)})` : ""));
            }
            for (const [id, w] of Object.entries(r.windows.inserters)) {
                lines.push(`  windows inserter:${id}: ${w.enables} enables, delta ${JSON.stringify(w.enable_delta)}, periods with another count ${w.periods_with_other_enable_count}`);
            }
        }
        lines.push(`closer: ${CLOSER_KINDS.map(k => `${k} ${closer(off, on, k)}`).join(", ")} (error: off ${JSON.stringify(off.error)}, on ${JSON.stringify(on.error)})`);
    }
    return [...table, ...lines].join("\n") + "\n";
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
