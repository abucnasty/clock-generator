// node scripts/sim-game-check.js check   --config <sample key | config file> --hash <clock hash prefix> --recording <recording file>
//                                        --out <folder> [--name <build>] [--staged] [--seed-items <n>] [--sim-offset <ticks>] [--seed-at first|settled]
// node scripts/sim-game-check.js builds  --recordings <folder> --out <folder> [--only a,b]    the check of every build of sim-game-check/builds.json
// node scripts/sim-game-check.js summary <out folder>                                         the table of the result files in a folder
//
// The simulator against the game for one build, to judge the inserter dispatch (CLOCK_NEW_DISPATCH): a stored recording of
// the game running a clock is laid against the simulator's run of the same clock under the old dispatch (configured order,
// "off") and the new one (activation order, "on"), per inserter and per clock period, one kind at a time:
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
const WAKE_UPS_CYCLE_TOLERANCE = 0.02; // mean wake-ups a period over whole cycles, share of the game's (at least 1 a period as the base)
const BINS_TOLERANCE = 0.005; // share of the game's items in a period
const HANDS_AGREEMENT = 1; // share of positions at which an inserter's hand equals the game's (builds whose cycle is one period): every position
const RULE = "kept-lists";
const DEFAULT_SIM_OFFSET = 3; // SIMULATED_TICK_TO_CLOCK_POSITION
// measured on the staged agricultural recording: with 3 every one of its 745 enable edges of every inserter sits 1 tick before the game's
const STAGED_SIM_OFFSET = 4;
const TRUE_COUNT = { // clock hash prefix: what checked the rule against the game's own wake-ups
    "3bc059b3": "front-exit normal mirrored backed: wake-ups read in the running game",
    "ba2c26f4": "electromagnetic science: wake-ups read in the running game",
};
const KNOWN_MISS = { // clock hash prefix: a game side the rule's count is known to miss, kept in the output and left out of "closer"
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
    // seeded: the run starts one tick after the game's first sample, with the machines as it recorded them, and the clock moved so that its
    // tick t is at clock position (t + position + 1), the position of the game's sample t + 1 (main_clock_shift, which the engine takes for a
    // fractional period too)
    const seed = opt("--seed") === undefined ? undefined : JSON.parse(fs.readFileSync(opt("--seed"), "utf8"));
    const offset = Number(opt("--sim-offset") ?? (staged ? STAGED_SIM_OFFSET : SIMULATED_TICK_TO_CLOCK_POSITION));
    const windows = clock.windows;
    const shift = seed === undefined ? 0 : (((offset - (seed.position + 1)) % clock.period) + clock.period) % clock.period;
    const start = seed !== undefined ? { keep_output_buffers: true, warmup_periods: 0, start_stock: seed.start_stock, start_hands: seed.start_hands, main_clock_shift: shift } : staged ? { warmup_periods: 0 } : {};
    const stock = simulateClockOnly(config, windows, clock.period, Number(opt("--periods")), quiet, start);
    const recording = recordingOfStock(stock, config, clock.clock_ticks);
    // the rule on the simulator's own states, read from its stock (a recording of it leaves out what the rule reads of a belt's room and a machine's placed results)
    const { wakeUpsOfStock } = dist("crafting/wake-ups.js");
    const { inserterEnds } = dist("crafting/inserter-counters.js");
    const wake_ticks = {};
    wakeUpsOfStock(stock, inserterEnds(config), 0, (inserter_id, tick) => (wake_ticks[inserter_id] ??= []).push(tick), RULE);
    recording.wake_ticks = wake_ticks;
    recording.clock.values = recording.clock.values.map((_, tick) => (tick + (seed === undefined ? offset : seed.position + 1)) % clock.clock_ticks);
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

// ---- the seeded start: a recorded sample of the game (the start of its first settled period, else its first sample) ----

/** a recording's per-sample series from `from` on, and its change lists (status) shifted to match: what recorded-bar.ts reads, seen from the seed sample */
function samplesFrom(samples, from) {
    if (from === 0) return samples;
    const shifted = list => {
        const out = [];
        for (const [index, value] of list) { if (index <= from) { if (out.length) out.pop(); out.push([0, value]); } else out.push([index - from, value]); }
        return out;
    };
    return { ...samples, bonus_progress: samples.bonus_progress.slice(from), crafting_progress: samples.crafting_progress.slice(from), products_finished: samples.products_finished.slice(from), status: shifted(samples.status) };
}
/** the value a change list [[sample, value], ...] holds at a sample */
const changeAt = (list, sample) => { let value; for (const [index, v] of list) { if (index > sample) break; value = v; } return value; };

/**
 * What a recorded sample gives the simulator to start from, and what it cannot give. The machines' contents (inputs and
 * outputs by item), crafting bar and productivity bar and the items in each inserter's hand are read at that sample (each hand starts
 * idle). A productivity bar shown full holds what is over it, which is worked back from a later sample (verification/recorded-bar.ts);
 * where it cannot be, the bar starts at the 1 shown and "not_seeded" names it. What the recording does not hold, or the start cannot take (fuel, a drill's bars), is listed under "not_seeded"; the
 * simulator assumes for it what filling the machine, a full belt and an infinite chest leave.
 */
function seedOf(game, gameMatch, config, clock, staged, sample) {
    const base = { applied: false, source: sample === 0 ? "the recording's first sample" : `the recording's sample ${sample}` };
    if (staged) return { ...base, reason: "staged start: the game began with the clock on empty machines, which the cold run starts from" };
    if (game.clock === undefined) return { ...base, reason: "the recording has no clock" };
    const { Machine } = dist("entities/machine/machine.js");
    const { barAtFirstSample } = dist("verification/recorded-bar.js");
    const start_stock = {}, fuel = [], both = [], bars_worked_back = [], bars_unknown = [];
    for (const machine of game.machines) {
        const id = gameMatch.machines.get(machine.id);
        if (id === undefined) continue;
        const items = {};
        const inputs = Object.keys(machine.samples.inputs), outputs = Object.keys(machine.samples.outputs);
        for (const item of outputs) items[item] = machine.samples.outputs[item][sample];
        // an item the machine takes and makes is kept apart from its output by the simulator, and the start names it once: the ingredient
        for (const item of inputs) { if (outputs.includes(item)) both.push(`machine:${id} ${item}`); items[item] = machine.samples.inputs[item][sample]; }
        if (machine.samples.fuel !== undefined && Object.keys(machine.samples.fuel).length > 0) fuel.push(`machine:${id} ${Object.entries(machine.samples.fuel).map(([item, list]) => `${item} ${list[sample]}`).join(", ")}`);
        // the game shows a full productivity bar as 1 and keeps what is over it: worked back from a later sample (verification/recorded-bar.ts)
        const built = Machine.fromConfig(config.machines.find(it => it.id === id));
        const bar = barAtFirstSample(samplesFrom(machine.samples, sample), { crafts_per_tick: built.crafting_rate.crafts_per_tick, bonus_per_craft: built.bonus_productivity_rate.bonus_per_craft });
        if (bar.bar === null) bars_unknown.push(`machine:${id} (${bar.reason})`);
        else if (bar.from_sample > 0) bars_worked_back.push(`machine:${id} ${bar.bar} (shown ${machine.samples.bonus_progress[sample]}, worked back from sample ${sample + bar.from_sample})`);
        start_stock[`machine:${id}`] = { items, crafting_progress: machine.samples.crafting_progress[sample], bonus_progress: bar.bar ?? machine.samples.bonus_progress[sample] };
    }
    // the hands as the recording holds them at its first sample (the config's inserters only); each starts idle: where the arm is in its swing is not recorded
    const start_hands = {};
    for (const it of game.inserters) {
        const id = gameMatch.inserters.get(it.id);
        const held = it.samples.held_count[sample];
        const item = changeAt(it.samples.held_item, sample) || undefined;
        if (id !== undefined && held > 0 && item !== undefined) start_hands[`inserter:${id}`] = { item_name: item, quantity: held };
    }
    const hands = Object.entries(start_hands).map(([id, hand]) => `${id} ${hand.quantity} ${hand.item_name}`);
    const drills = (config.drills ?? []).length;
    const not_seeded = [
        `inserter swing: ${hands.length} of ${game.inserters.length} recorded inserters held items at the seed sample${hands.length ? ` (${hands.join(", ")})` : ""}; each hand is given and starts idle, since where an arm is in its swing is not recorded`,
        ...(fuel.length ? [`fuel slots and the burning fuel item: the start has no way to put fuel in (${fuel.join("; ")})`] : []),
        ...(both.length ? [`outputs of an item the machine also takes: ${both.join(", ")}`] : []),
        ...(drills ? [`mining drills: ${drills} in the build, whose mining and productivity bars start as filling leaves them`] : []),
        ...(bars_unknown.length ? [`a productivity bar shown full whose part over 1 could not be worked back, seeded at the 1 shown: ${bars_unknown.join("; ")}`] : []),
        "belts (assumed full, as the simulator keeps them), chest contents (the recording has none: infinite, or as filling leaves them), a machine's finished-but-not-placed products (start empty)",
    ];
    return { ...base, applied: true, complete: fuel.length === 0 && both.length === 0 && drills === 0, sample, position: game.clock.values[sample], start_stock, start_hands, hands_not_empty: hands.length, bars_worked_back, not_seeded };
}

/**
 * The periods of a game's recording and of a seeded run, paired by sample: the run's tick t is the game's sample seedSample + t + 1.
 * Every whole period both hold is paired (the periods before the seed sample have none): the state the seed sample gave the run is what
 * is being tested.
 */
function pairSeeded(game, sim, seedSample) {
    const { clockPeriods } = dist("harness/recording-output.js");
    const g = clockPeriods(game.clock.values);
    const s = clockPeriods(sim.clock.values);
    const gp = [], sp = [];
    for (const gamePeriod of g) {
        const simPeriod = s.find(it => it.start + 1 + seedSample === gamePeriod.start && it.end + 1 + seedSample === gamePeriod.end);
        if (simPeriod === undefined) continue;
        gp.push(gamePeriod); sp.push(simPeriod);
    }
    return { game: gp, sim: sp };
}

/**
 * The periods of the game's recording in which its stock still drifts: what each machine holds at a period's first sample (the items in
 * and out of it, by item) is compared with the range it holds at that sample over the last third of the periods compared; a period with
 * a value outside that range is unsettled. A build that repeats over several periods has its whole cycle in that range, if the last third
 * is as long as the cycle.
 */
function unsettledPeriods(game, gameMatch, periods) {
    const machines = game.machines.filter(m => gameMatch.machines.has(m.id));
    const values = period => machines.flatMap(m => [...Object.entries(m.samples.inputs), ...Object.entries(m.samples.outputs)].map(([item, list]) => list[period.start]));
    const states = periods.map(values);
    const tail = states.slice(Math.floor(states.length * 2 / 3));
    if (tail.length === 0) return { periods_compared_by_stock: states.length, drifting_periods: [], settled_from: 0, tail_stable: true };
    const rangeOfRows = rows => ({ low: states[0].map((_, i) => Math.min(...rows.map(it => it[i]))), high: states[0].map((_, i) => Math.max(...rows.map(it => it[i]))) });
    const outside = (state, { low, high }) => state.some((v, i) => v < low[i] || v > high[i]); // a value of the state outside the range
    const whole = rangeOfRows(tail);
    const drifting = [];
    states.forEach((state, p) => { if (outside(state, whole)) drifting.push(p); });
    // the last third is settled itself only if its second half stays in its first half's range: else the stock is still moving there
    const half = Math.floor(tail.length / 2), first = rangeOfRows(tail.slice(0, half));
    const tail_stable = half === 0 || tail.slice(half).every(state => !outside(state, first));
    return { periods_compared_by_stock: states.length, drifting_periods: drifting, settled_from: drifting.length === 0 ? 0 : drifting[drifting.length - 1] + 1, tail_stable };
}

/** fewest whole periods that must follow the seed sample for a settled seed to be used */
const MIN_PERIODS_AFTER_SEED = 3;
/**
 * Where the simulator is seeded: the first sample of the first settled period of the game's recording (see the top of the file), else
 * the recording's first sample, with the reason. `how` is "settled" (the default) or "first" (forced).
 */
function settlingOf(game, gameMatch, how) {
    const { clockPeriods } = dist("harness/recording-output.js");
    const periods = clockPeriods(game.clock.values);
    const u = unsettledPeriods(game, gameMatch, periods);
    const base = { rule: "first period whose machine stock (in and out) stays inside the range of the last third of the periods", periods_in_recording: periods.length, settled_from_period: u.settled_from, drifting_periods: u.drifting_periods.length };
    if (how === "first") return { ...base, seed_sample: 0, settles: null, reason: "--seed-at first: seeded at the recording's first sample" };
    if (!u.tail_stable) return { ...base, seed_sample: 0, settles: false, reason: "the stock still drifts in the last third of the recording (its second half leaves its first half's range): not settled within the recording, seeded at the first sample" };
    if (u.settled_from === 0) return { ...base, seed_sample: 0, settles: true, reason: "settled from the first period: seeded at the first sample" };
    if (periods.length - u.settled_from < MIN_PERIODS_AFTER_SEED) return { ...base, seed_sample: 0, settles: false, reason: `fewer than ${MIN_PERIODS_AFTER_SEED} periods follow the settled period: seeded at the first sample` };
    return { ...base, seed_sample: periods[u.settled_from].start, settles: true, reason: `settled from period ${u.settled_from} of ${periods.length}: seeded at its first sample` };
}

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
const seriesCache = new WeakMap();
function insertersByConfigId(recording, match) {
    if (seriesCache.has(recording)) return seriesCache.get(recording);
    const series = readInserters(recording, match);
    seriesCache.set(recording, series);
    return series;
}
function readInserters(recording, match) {
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

/** the fewest whole periods after which every inserter's status and hand repeat at every tick, over the periods given; all of them when none does */
function cycleOf(series, ids, periods) {
    const codes = new Map();
    const code = status => { if (!codes.has(status)) codes.set(status, codes.size); return codes.get(status); };
    const signatures = periods.map(period => ids.map(id => {
        const it = series.get(id);
        const states = [];
        for (let i = period.start; i < period.end; i++) states.push(code(it.status[i]) * 1000 + it.held[i]);
        return states.join(",");
    }).join("|"));
    const n = signatures.length;
    for (let c = 1; c <= Math.floor(n / 2); c++) {
        let repeats = true;
        for (let p = 0; p + c < n && repeats; p++) repeats = signatures[p] === signatures[p + c];
        if (repeats) return c;
    }
    return n;
}
/** the repeat cycles of the game's recording and of a simulated one, over the periods paired */
function cyclesOf(game, gameMatch, simRecording, paired) {
    const { matchOfSimulatedRecording } = dist("verification/simulated-recording.js");
    const gameSeries = insertersByConfigId(game, gameMatch), simSeries = insertersByConfigId(simRecording, matchOfSimulatedRecording(simRecording));
    const ids = [...gameSeries.keys()].filter(id => simSeries.has(id)).sort((a, b) => a - b);
    const n = Math.min(paired.game.length, paired.sim.length);
    return { game: cycleOf(gameSeries, ids, paired.game.slice(0, n)), sim: cycleOf(simSeries, ids, paired.sim.slice(0, n)) };
}
/** the mean of the whole cycles of a series a period (all of it where it holds none) */
const meanOverCycles = (list, cycle) => { const length = Math.floor(list.length / cycle) * cycle || list.length; return length === 0 ? 0 : sum(list.slice(0, length)) / length; };

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
        dispatch: DISPATCHES[key], periods_compared: judgedIdx.length,
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
        const config = await configOf();
        const gameMatch = matchRecordingToConfig(game, config);
        const settling = staged || game.clock === undefined ? undefined : settlingOf(game, gameMatch, opt("--seed-at") ?? "settled");
        const seed = seedOf(game, gameMatch, config, clock, staged, settling?.seed_sample ?? 0);
        const seedFile = path.join(work, "seed.json");
        if (seed.applied) fs.writeFileSync(seedFile, JSON.stringify({ sample: seed.sample, position: seed.position, start_stock: seed.start_stock, start_hands: seed.start_hands }));
        // the cold runs, and the seeded ones where the recording gives a seed; each under both dispatches
        const sims = {}, seededSims = {};
        await Promise.all(Object.keys(DISPATCHES).flatMap(key => [false, true].filter(seeded => !seeded || seed.applied).map(async seeded => {
            const file = path.join(work, `sim-${key}${seeded ? "-seeded" : ""}.json`);
            await child("simulate", ["--clock", clockFile, "--out", file, "--periods", String(seeded ? Math.floor((game.sample_count - seed.sample) / clock.clock_ticks) + 2 : periods), ...(staged ? ["--staged"] : []), ...(seeded ? ["--seed", seedFile] : []),
                ...(opt("--sim-offset") ? ["--sim-offset", opt("--sim-offset")] : [])], dispatchEnv(key));
            (seeded ? seededSims : sims)[key] = JSON.parse(fs.readFileSync(file, "utf8"));
        })));

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
        // the periods of the two are judged one by one only where neither the game's recording nor either simulated one repeats over more than one
        const pairs = {}, cycles = {};
        for (const key of Object.keys(DISPATCHES)) { pairs[key] = pairPeriods(game, sims[key], staged); cycles[key] = cyclesOf(game, gameMatch, sims[key], pairs[key]); }
        const cycleMean = Object.values(cycles).some(it => it.game > 1 || it.sim > 1);
        const seededPairs = {}, seededCycles = {};
        if (seed.applied) for (const key of Object.keys(DISPATCHES)) { seededPairs[key] = pairSeeded(game, seededSims[key], seed.sample); seededCycles[key] = cyclesOf(game, gameMatch, seededSims[key], seededPairs[key]); }
        // the seeded run is judged where there is one; the cycle decides how its periods are judged as it does for the cold one, from both runs' cycles together
        const seededCycleMean = seed.applied && Object.values(seededCycles).some(it => it.game > 1 || it.sim > 1);
        const seedStamp = seed.applied
            ? { applied: true, complete: seed.complete, source: seed.source, seed_sample: seed.sample, settling, position_of_seed_sample: seed.position, sim_tick_0_is_game_sample: seed.sample + 1, not_seeded: seed.not_seeded, machines_seeded: Object.keys(seed.start_stock).length, hands_not_empty: seed.hands_not_empty, bars_worked_back: seed.bars_worked_back }
            : { applied: false, source: seed.source, reason: seed.reason };
        for (const key of Object.keys(DISPATCHES)) {
            const ctx = { config, game, gameMatch, clock, period: clock.clock_ticks, staged, groups: byWindows };
            const cold = judge({ ...ctx, paired: pairs[key], cycles: cycles[key], cycle_mean: cycleMean }, sims[key], key);
            let judged = cold, result = { ...cold, judged_run: "cold" };
            if (seed.applied) {
                const seededRun = judge({ ...ctx, paired: seededPairs[key], cycles: seededCycles[key], cycle_mean: seededCycleMean }, seededSims[key], key);
                // an incomplete seed is reported (under "seeded") and the cold run stays the judged one
                if (seed.complete) { judged = seededRun; result = { ...judged, judged_run: "seeded", cold }; }
                else result = { ...cold, judged_run: "cold", seeded: seededRun };
            }
            // the periods of the game's recording that are still unsettled, and which of the bins' failures are in them
            const used = seed.applied && seed.complete ? seededPairs[key] : pairs[key];
            const gameJudged = used.game.slice(0, Math.min(used.game.length, used.sim.length));
            const unsettled = unsettledPeriods(game, gameMatch, gameJudged);
            const failing = judged.bins.game.flatMap((g, p) => (g === 0 ? judged.bins.sim[p] !== 0 : Math.abs(judged.bins.sim[p] - g) / g > BINS_TOLERANCE) ? [p] : []);
            result.bins.unsettled = { ...unsettled, failing_periods: failing, failing_in_unsettled: failing.filter(p => unsettled.drifting_periods.includes(p)), failing_after_settled: failing.filter(p => !unsettled.drifting_periods.includes(p)) };
            const file = path.join(out, `${name}.${key}.json`);
            fs.writeFileSync(file, JSON.stringify({ ...stamp, judged_run: result.judged_run, seed: seedStamp, flag: key, ...result }, null, 1) + "\n");
            const line = r => `wake-ups ${r.wake_ups.pass ? "pass" : "FAIL"} (${r.cycle.wake_ups_judged_by}; cycle ${r.cycle.game}/${r.cycle.sim}), bins ${r.bins.pass ? "pass" : "FAIL"}, hands ${r.hands.pass === null ? "-" : r.hands.pass ? "pass" : "FAIL"}`;
            console.log(`${name} ${key} (${DISPATCHES[key]}): ${seed.applied ? `${seed.complete ? "seeded (judged)" : "seeded (incomplete: not judged)"}: ${line(result.seeded ?? judged)} | cold${seed.complete ? "" : " (judged)"}: ${line(cold)}` : `cold (no seed: ${seed.reason}): ${line(cold)}`} -> ${file}`);
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// ---- the table of a folder of results ----

const CLOSER_KINDS = ["wake_ups", "bins", "hands", "windows"];
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
    const table = ["| build | game side | start judged | judged by | wake-ups: off / on | bins: off / on | hands: off / on | other start (reported): wake-ups off / on | bins off / on | hands off / on | closer: wake-ups | bins | hands | windows | alignment offset |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
    const excluded = [];
    for (const name of names) {
        const off = JSON.parse(fs.readFileSync(path.join(folder, `${name}.off.json`), "utf8"));
        const on = JSON.parse(fs.readFileSync(path.join(folder, `${name}.on.json`), "utf8"));
        // a build left out of the verdict is shown as excluded, never as failing (its files keep the values the check computed)
        const word = r => off.closer_excluded ? "excluded" : r === null ? "-" : r ? "pass" : "FAIL";
        const closers = off.closer_excluded ? CLOSER_KINDS.map(() => "-") : CLOSER_KINDS.map(k => closer(off, on, k));
        if (off.closer_excluded) excluded.push(`${name}: ${off.closer_excluded}`);
        const offset = off.alignment.simulated_tick_to_clock_position;
        // the start that is not judged: the cold run where the seeded one is judged, the incomplete seeded run where the cold one is (none for a staged start)
        const otherOf = r => r.judged_run === "seeded" ? r.cold : r.seeded;
        const coldWord = kind => otherOf(off) === undefined ? "-" : `${word(otherOf(off)[kind].pass)} / ${word(otherOf(on)[kind].pass)}`;
        table.push(`| ${name} | ${off.game_side} | ${off.judged_run}${off.seed.applied && !off.seed.complete ? " (seed incomplete)" : ""} | ${off.cycle.wake_ups_judged_by} (cycles game ${off.cycle.game}, sim ${off.cycle.sim} / ${on.cycle.sim}) | ${word(off.wake_ups.pass)} / ${word(on.wake_ups.pass)} | ${word(off.bins.pass)} / ${word(on.bins.pass)} | ${word(off.hands.pass)} / ${word(on.hands.pass)} | ${coldWord("wake_ups")} | ${coldWord("bins")} | ${coldWord("hands")} | ${closers.join(" | ")} | ${offset}${off.alignment.differs_from_default ? ` (differs from ${off.alignment.default})` : ""} |`);
        lines.push("", `## ${name} (clock ${off.clock_hash.slice(0, 8)}, period ${off.clock_period}, game side: ${off.game_side}, ${off.periods_compared} periods compared, alignment offset ${offset}${off.alignment.differs_from_default ? `, differs from ${off.alignment.default}` : ""})`);
        if (off.closer_excluded) lines.push(`left out of "closer": ${off.closer_excluded}`);
        const startOf = seed => `the recording's sample ${seed.seed_sample ?? 0} (clock position ${seed.position_of_seed_sample ?? seed.position_of_first_sample}, ${seed.machines_seeded} machines)`;
        lines.push(off.seed.applied
            ? `start: ${off.seed.complete ? `judged on the run seeded from ${startOf(off.seed)}; the cold run is reported in the table and under "cold" in the file` : `the seed from ${startOf(off.seed)} lacks what the simulator cannot take, so the run from it is reported (under "seeded" in the file) and the cold run is judged`}. `
                + (off.seed.settling ? `Seed sample: ${off.seed.settling.reason}${off.seed.settling.settles === false ? " (NOT SETTLED)" : ""}. ` : "")
                + `Not seeded: ${off.seed.not_seeded.join("; ")}`
            : `start: no seeded run (${off.seed.reason}); the cold run is judged`);
        for (const [key, r] of [["off", off], ["on", on]]) {
            const cycleMean = r.cycle.wake_ups_judged_by !== "each period";
            lines.push(`${key} (${r.dispatch}): wake-ups judged by ${r.cycle.wake_ups_judged_by}`
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
        }
        lines.push(`closer: ${off.closer_excluded ? "left out (see above)" : CLOSER_KINDS.map(k => `${k} ${closer(off, on, k)}`).join(", ")} (error: off ${JSON.stringify(off.error)}, on ${JSON.stringify(on.error)})`);
    }
    const tol = names.length === 0 ? undefined : JSON.parse(fs.readFileSync(path.join(folder, `${names[0]}.off.json`), "utf8")).tolerances;
    const tolerances = tol === undefined ? [] : [`Tolerances: wake-ups within ${tol.wake_ups_per_period} a period per inserter where the cycle is one period, else the mean within ${tol.wake_ups_cycle_mean_relative * 100}% (relative to the game's, at least 1 a period as the base); bins within ${tol.bins_relative * 100}% a period; hands equal at ${tol.hands_agreement * 100}% of the positions where the cycle is one period (no pass/fail otherwise).`, ""];
    const note = excluded.length > 0 ? ["", "Left out of \"closer\" (shown as -): " + excluded.join("; ")] : [];
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
