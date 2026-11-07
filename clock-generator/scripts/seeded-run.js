// The simulator's seeded run, shared by scripts/sim-game-check.js and scripts/record-clock.js so that both judge the same run.
//
// A recording of the game starts after a warm-up that the simulator does not run, and what that warm-up leaves in the machines decides
// which inserters wake. The seeded run starts the simulator from a sample of the recording (the start of its first settled window cycle, else
// its first sample): seedOf reads what the machines hold, settlingOf picks the sample, simulateRun runs the clock from it, and
// pairSeeded pairs the window cycles of the run with the game's. judgedWakeUps is the figure sim-game-check judges the wake-ups on, in wake-ups
// a minute: the seeded run's when the recording gives a complete seed, else the cold run's.
const { dist, quiet } = require("./lib");

const sum = list => list.reduce((a, b) => a + b, 0);
const DEFAULT_SIM_OFFSET = 3; // SIMULATED_TICK_TO_CLOCK_POSITION

// ---- the seeded start: a recorded sample of the game (the start of its first settled window cycle, else its first sample) ----

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
 * The window cycles of a game's recording and of a seeded run, paired by sample: the run's tick t is the game's sample seedSample + t + 1.
 * Every whole window cycle both hold is paired (the window cycles before the seed sample have none): the state the seed sample gave the run is what
 * is being tested.
 */
function pairSeeded(game, sim, seedSample) {
    const { clockWindowCycles } = dist("harness/recording-output.js");
    const g = clockWindowCycles(game.clock.values);
    const s = clockWindowCycles(sim.clock.values);
    const gp = [], sp = [];
    for (const gameWindowCycle of g) {
        const simWindowCycle = s.find(it => it.start + 1 + seedSample === gameWindowCycle.start && it.end + 1 + seedSample === gameWindowCycle.end);
        if (simWindowCycle === undefined) continue;
        gp.push(gameWindowCycle); sp.push(simWindowCycle);
    }
    return { game: gp, sim: sp };
}

/**
 * The window cycles of the game's recording in which its stock still drifts: what each machine holds at a window cycle's first sample (the items in
 * and out of it, by item) is compared with the range it holds at that sample over the last third of the window cycles compared; a window cycle with
 * a value outside that range is unsettled. A build that repeats over several window cycles has its whole cycle in that range, if the last third
 * is as long as the cycle.
 */
function unsettledWindowCycles(game, gameMatch, window_cycles) {
    const machines = game.machines.filter(m => gameMatch.machines.has(m.id));
    const values = window_cycle_ticks => machines.flatMap(m => [...Object.entries(m.samples.inputs), ...Object.entries(m.samples.outputs)].map(([item, list]) => list[window_cycle_ticks.start]));
    const states = window_cycles.map(values);
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

/** fewest whole window cycles that must follow the seed sample for a settled seed to be used */
const MIN_WINDOW_CYCLES_AFTER_SEED = 3;
/**
 * Where the simulator is seeded: the first sample of the first settled window cycle of the game's recording (see the top of the file), else
 * the recording's first sample, with the reason. `how` is "settled" (the default) or "first" (forced).
 */
function settlingOf(game, gameMatch, how) {
    const { clockWindowCycles } = dist("harness/recording-output.js");
    const window_cycles = clockWindowCycles(game.clock.values);
    const u = unsettledWindowCycles(game, gameMatch, window_cycles);
    const base = { rule: "first period whose machine stock (in and out) stays inside the range of the last third of the periods", periods_in_recording: window_cycles.length, settled_from_period: u.settled_from, drifting_periods: u.drifting_periods.length };
    if (how === "first") return { ...base, seed_sample: 0, settles: null, reason: "--seed-at first: seeded at the recording's first sample" };
    if (!u.tail_stable) return { ...base, seed_sample: 0, settles: false, reason: "the stock still drifts in the last third of the recording (its second half leaves its first half's range): not settled within the recording, seeded at the first sample" };
    if (u.settled_from === 0) return { ...base, seed_sample: 0, settles: true, reason: "settled from the first period: seeded at the first sample" };
    if (window_cycles.length - u.settled_from < MIN_WINDOW_CYCLES_AFTER_SEED) return { ...base, seed_sample: 0, settles: false, reason: `fewer than ${MIN_WINDOW_CYCLES_AFTER_SEED} periods follow the settled period: seeded at the first sample` };
    return { ...base, seed_sample: window_cycles[u.settled_from].start, settles: true, reason: `settled from period ${u.settled_from} of ${window_cycles.length}: seeded at its first sample` };
}

/** the sample ranges of the window cycles, a game's and a simulator's, paired by index; the first of the game's is left out unless it is staged */
function pairWindowCycles(game, sim, staged) {
    const { clockWindowCycles } = dist("harness/recording-output.js");
    const g = clockWindowCycles(game.clock.values);
    const s = clockWindowCycles(sim.clock.values);
    // a staged start has no settling: the simulator's run is cold and from its first tick, and is judged from its first window cycle
    if (staged) return { game: g.slice(1), sim: s };
    // a simulated run is judged on what follows its first third, as the scaffold tests judge it
    const settled = s.filter(it => it.start >= Math.floor(sim.sample_count / 3));
    return { game: g.slice(1), sim: settled };
}

const rangeOf = window_cycles => ({ from: window_cycles[0].start, to: window_cycles[window_cycles.length - 1].end });
const binOf = (window_cycles, sample) => { let lo = 0, hi = window_cycles.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (window_cycles[mid].start <= sample) lo = mid; else hi = mid - 1; } return lo; };

/** the wake-ups of each inserter in each window cycle, from the ticks the simulator's run counted them at */
function wakesFromTicks(wake_ticks, window_cycles) {
    const { from, to } = rangeOf(window_cycles);
    const counts = new Map();
    for (const [inserter_id, ticks] of Object.entries(wake_ticks)) {
        const list = new Array(window_cycles.length).fill(0);
        for (const tick of ticks) if (tick >= from && tick < to) list[binOf(window_cycles, tick)]++;
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

/** the fewest whole window cycles after which every inserter's status and hand repeat at every tick, over the window cycles given; all of them when none does */
function cycleOf(series, ids, window_cycles) {
    const codes = new Map();
    const code = status => { if (!codes.has(status)) codes.set(status, codes.size); return codes.get(status); };
    const signatures = window_cycles.map(window_cycle_ticks => ids.map(id => {
        const it = series.get(id);
        const states = [];
        for (let i = window_cycle_ticks.start; i < window_cycle_ticks.end; i++) states.push(code(it.status[i]) * 1000 + it.held[i]);
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
/** the repeat cycles of the game's recording and of a simulated one, over the window cycles paired */
function cyclesOf(game, gameMatch, simRecording, paired) {
    const { matchOfSimulatedRecording } = dist("verification/simulated-recording.js");
    const gameSeries = insertersByConfigId(game, gameMatch), simSeries = insertersByConfigId(simRecording, matchOfSimulatedRecording(simRecording));
    const ids = [...gameSeries.keys()].filter(id => simSeries.has(id)).sort((a, b) => a - b);
    const n = Math.min(paired.game.length, paired.sim.length);
    return { game: cycleOf(gameSeries, ids, paired.game.slice(0, n)), sim: cycleOf(simSeries, ids, paired.sim.slice(0, n)) };
}
/** the mean of the whole cycles of a series a window cycle (all of it where it holds none) */
const meanOverCycles = (list, cycle) => { const length = Math.floor(list.length / cycle) * cycle || list.length; return length === 0 ? 0 : sum(list.slice(0, length)) / length; };

// ---- the run ----

/**
 * A run of the clock in the simulator, as a recording that also holds the ticks it counted its wake-ups at (`wake_ticks`, by inserter
 * id). `clock` is {windows, window cycle, clock_ticks}. With a `seed` ({sample, position, start_stock, start_hands}, what seedInput gives) the
 * run starts one tick after the game's first sample, with the machines as it recorded them, and the clock moved so that its tick t is at
 * clock position (t + position + 1), the position of the game's sample t + 1 (main_clock_shift, which the engine takes for a
 * fractional window cycle too); else it is cold, as the scaffold tests start it.
 */
function simulateRun(config, clock, { periods: window_cycles, seed, offset, staged = false }) {
    const { simulateClockOnly } = dist("crafting/generate-blueprint.js");
    const { recordingOfStock } = dist("verification/simulated-recording.js");
    const shift = seed === undefined ? 0 : (((offset - (seed.position + 1)) % clock.period) + clock.period) % clock.period;
    const start = seed !== undefined ? { keep_output_buffers: true, warmup_window_cycles: 0, start_stock: seed.start_stock, start_hands: seed.start_hands, main_clock_shift: shift } : staged ? { warmup_window_cycles: 0 } : {};
    const stock = simulateClockOnly(config, clock.windows, clock.period, window_cycles, quiet, start);
    const recording = recordingOfStock(stock, config, clock.clock_ticks);
    // the rule on the simulator's own states, read from its stock (a recording of it leaves out what the rule reads of a belt's room and a machine's placed results)
    const { wakeUpsOfStock } = dist("crafting/wake-ups.js");
    const { inserterEnds } = dist("crafting/inserter-counters.js");
    const wake_ticks = {};
    wakeUpsOfStock(stock, inserterEnds(config), 0, (inserter_id, tick) => (wake_ticks[inserter_id] ??= []).push(tick));
    recording.wake_ticks = wake_ticks;
    recording.clock.values = recording.clock.values.map((_, tick) => (tick + (seed === undefined ? offset : seed.position + 1)) % clock.clock_ticks);
    return recording;
}

/** the seed a recording gives and where it settles (a staged start, and a recording without a clock, have no settling) */
function seedOfRecording(game, gameMatch, config, clock, { staged = false, how = "settled" } = {}) {
    const settling = staged || game.clock === undefined ? undefined : settlingOf(game, gameMatch, how);
    const seed = seedOf(game, gameMatch, config, clock, staged, settling?.seed_sample ?? 0);
    return { settling, seed };
}

/** the part of a seed that a run takes */
const seedInput = seed => ({ sample: seed.sample, position: seed.position, start_stock: seed.start_stock, start_hands: seed.start_hands });

/** the window cycles a seeded run is simulated for: the whole window cycles the recording holds after the seed sample, and two more */
const seededWindowCycles = (game, clock_ticks, seed) => Math.floor((game.sample_count - seed.sample) / clock_ticks) + 2;
/** the window cycles a cold run is simulated for: half as many again as the recording holds, and two more (a staged one has the recording's, and one more) */
const coldWindowCycles = (game, clock_ticks, staged) => {
    const recorded = Math.floor(game.sample_count / clock_ticks);
    return staged ? recorded + 1 : Math.ceil(recorded * 1.5) + 2;
};

/**
 * The wake-ups a minute of a simulated run over the window cycles sim-game-check judges it on: the mean a window cycle over whole repeat cycles of
 * each inserter the game's recording and the run share, summed, over the window cycles the run is paired to the game's (`paired`, with the
 * `cycles` of the pairing), and taken to a minute by the clock's window cycle.
 */
function wakeUpsPerMinute(game, gameMatch, simRecording, paired, cycles, clock_ticks) {
    const { matchOfSimulatedRecording } = dist("verification/simulated-recording.js");
    const n = Math.min(paired.game.length, paired.sim.length);
    if (n === 0) return undefined;
    const simWake = wakesFromTicks(simRecording.wake_ticks, paired.sim.slice(0, n));
    const gameSeries = insertersByConfigId(game, gameMatch), simSeries = insertersByConfigId(simRecording, matchOfSimulatedRecording(simRecording));
    const ids = [...gameSeries.keys()].filter(id => simSeries.has(id)).sort((a, b) => a - b);
    const zero = new Array(n).fill(0);
    return sum(ids.map(id => meanOverCycles(simWake.get(`inserter:${id}`) ?? zero, cycles.sim))) * 3600 / clock_ticks;
}

/**
 * The simulator's wake-ups a minute on the run sim-game-check judges: the seeded run where the recording gives a complete seed, else
 * the cold run (an incomplete seed is reported and not judged). `config` is a fresh config of the build (a run may change it), `clock`
 * is {windows, window cycle, clock_ticks}. Returns {judged_run, wake_ups_per_minute, seed, settling}.
 */
function judgedWakeUps(config, game, gameMatch, clock, { offset = DEFAULT_SIM_OFFSET } = {}) {
    const { seed, settling } = seedOfRecording(game, gameMatch, config, clock);
    // a run goes through a file in sim-game-check: its recording and seed are the JSON they would be written as
    const throughJson = value => JSON.parse(JSON.stringify(value));
    const seeded = seed.applied && seed.complete;
    const sim = throughJson(seeded
        ? simulateRun(config, clock, { periods: seededWindowCycles(game, clock.clock_ticks, seed), seed: throughJson(seedInput(seed)), offset })
        : simulateRun(config, clock, { periods: coldWindowCycles(game, clock.clock_ticks, false), offset }));
    const paired = seeded ? pairSeeded(game, sim, seed.sample) : pairWindowCycles(game, sim, false);
    const cycles = cyclesOf(game, gameMatch, sim, paired);
    const stamp = { applied: seed.applied, complete: seed.complete ?? null, sample: seed.sample ?? null, reason: seed.reason ?? null };
    return { judged_run: seeded ? "seeded" : "cold", wake_ups_per_minute: wakeUpsPerMinute(game, gameMatch, sim, paired, cycles, clock.clock_ticks), seed: stamp, settling };
}

module.exports = {
    DEFAULT_SIM_OFFSET, unsettledPeriods: unsettledWindowCycles, pairSeeded, pairPeriods: pairWindowCycles, rangeOf, binOf, wakesFromTicks, insertersByConfigId, cyclesOf, meanOverCycles,
    simulateRun, seedOfRecording, seedInput, seededPeriods: seededWindowCycles, coldPeriods: coldWindowCycles, judgedWakeUps,
};
