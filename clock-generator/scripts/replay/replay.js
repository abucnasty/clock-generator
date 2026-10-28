// replay.js: one job of the replay check (scripts/replay/replay.sh), in a process of its own. It loads an engine's build
// (dist/ of the worktree given) and runs one stored job on it with no search:
//   asbuilt  the build on the job's stored clock windows alone (runClockOnBuild: cold start, the default taker order),
//            warm-up plus 4 periods, with the machine stock, the Factorio states, the timeline recording, the fuel
//            levels and repeat detection
//   plan     the planning run of the config (runBuild as planRun runs it, with the machine stock and fuel levels
//            watched), and the figures planRun reads off it (its windows, lane capacity check)
//   fuel     where the plan has fuel inserters: the view of the fuel being consumed that a clock's export makes (its own
//            run with the fuel clocks), on the plan's clock, its history's reasons as texts
//   speed    the as-built run again with nothing recorded, for ticks per second and scavenges per million ticks
//   losses   with --losses: backpressureLossOf on the stored windows (supply gates)
// It writes what every run observed, as hashes: per signal (an entity's field, or its events) and per period of the
// clock, so that a difference names the run, the signal and the first period that differs. Component internals are
// never read: only what a run hands back (the stock and timeline recordings, the histories, the figures), so that the
// check survives the refactor's moves.
//
//   node replay.js --engine <clock-generator dir> --input <job.json> --output <result.json> [--losses]
//   node replay.js --engine <dir> --input <job.json> --dump <run> --period <p>
//                   prints the per-tick values of every signal of that run and period, as JSON (replay.sh explain)
//
// A job file (replay.sh record writes them) is { key, group, name, config, windows, period } with `windows` and `period`
// the blast's selected clock, or { key, group, name, config } for a job with no clock (a refusal or a config error),
// whose runs record the error each throws.
'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { GCProfiler } = require('v8');

const FORMAT = 'replay-1';
/** Periods the as-built run records after its warm-up */
const PERIODS = 4;

function args() {
    const out = { losses: false };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--losses') out.losses = true;
        else if (a === '--engine') out.engine = argv[++i];
        else if (a === '--input') out.input = argv[++i];
        else if (a === '--output') out.output = argv[++i];
        else if (a === '--dump') out.dump = argv[++i];
        else if (a === '--period') out.period = Number(argv[++i]);
        else throw new Error(`replay.js: unknown argument ${a}`);
    }
    if (!out.engine || !out.input || (!out.output && !out.dump)) throw new Error('replay.js: --engine, --input and --output (or --dump) are needed');
    return out;
}

/** The value as JSON with object keys sorted and class names left out (a class that moves must not change a hash);
 * Maps and Sets as their entries; cycles named */
function canonical(value, seen = new Set()) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'function') return `<function>`;
        if (typeof value === 'number' && Object.is(value, -0)) return 0;
        if (typeof value === 'bigint') return `${value}n`;
        return value;
    }
    if (seen.has(value)) return '<cycle>';
    seen.add(value);
    let out;
    if (Array.isArray(value) || ArrayBuffer.isView(value)) out = Array.from(value, v => canonical(v, seen));
    else if (value instanceof Map) out = { '<Map>': [...value.entries()].map(([k, v]) => [canonical(k, seen), canonical(v, seen)]) };
    else if (value instanceof Set) out = { '<Set>': [...value.values()].map(v => canonical(v, seen)) };
    else {
        out = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] === undefined) continue;
            out[key] = canonical(value[key], seen);
        }
    }
    seen.delete(value);
    return out;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/**
 * The signals a run observed, by name: a `series` has a value per tick from tick 0 of the recorded run; `events` are
 * [tick, ...] rows; a `whole` value belongs to no period (figures of the run)
 */
class Signals {
    constructor() { this.map = new Map(); }
    series(name, values) { this.map.set(name, { kind: 'series', values }); }
    events(name, rows) { this.map.set(name, { kind: 'events', rows }); }
    whole(name, value) { this.map.set(name, { kind: 'whole', value: canonical(value) }); }
    /** Every series of a recorded entity (an array per tick, or a record of them by item); the rest of it is one whole value */
    entity(prefix, record, ticks) {
        const meta = {};
        for (const [key, value] of Object.entries(record)) {
            if (Array.isArray(value) && value.length === ticks) this.series(`${prefix}/${key}`, value);
            else if (value && typeof value === 'object' && !Array.isArray(value)
                && Object.values(value).every(v => Array.isArray(v) && v.length === ticks)) {
                for (const [item, series] of Object.entries(value)) this.series(`${prefix}/${key}:${item}`, series);
            } else meta[key] = value;
        }
        this.whole(`${prefix}/meta`, meta);
    }
    /** The values of a signal within ticks [from, to) */
    slice(signal, from, to) {
        if (signal.kind === 'series') return signal.values.slice(from, to);
        return signal.rows.filter(row => row[0] >= from && row[0] < to);
    }
    /** { periods: [hash per period], signals: { name: [hash per period] | hash } } */
    hashes(period, ticks) {
        const periods = Math.max(1, Math.ceil(ticks / period));
        const bounds = Array.from({ length: periods }, (_, p) => [Math.floor(p * period), p === periods - 1 ? Infinity : Math.floor((p + 1) * period)]);
        const signals = {};
        for (const [name, signal] of [...this.map.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
            signals[name] = signal.kind === 'whole' ? hash(signal.value) : bounds.map(([from, to]) => hash(this.slice(signal, from, to)));
        }
        const names = Object.keys(signals);
        return {
            periods: bounds.map((_, p) => hash(names.map(name => Array.isArray(signals[name]) ? signals[name][p] : null))),
            whole: hash(names.filter(name => !Array.isArray(signals[name])).map(name => signals[name])),
            signals,
        };
    }
    /** The per-tick values of every signal within one period, for a dump */
    dump(period, p) {
        const from = Math.floor(p * period), to = Math.floor((p + 1) * period);
        const out = {};
        for (const [name, signal] of this.map) out[name] = signal.kind === 'whole' ? signal.value : this.slice(signal, from, to);
        return out;
    }
}

/** The machine stock and fuel levels of a run (`StockRecording`, `FuelLevelSeries[]`) */
function stockSignals(signals, stock, fuel_levels) {
    if (stock) {
        for (const machine of stock.machines) signals.entity(`stock:${machine.machine_id}`, machine, stock.ticks);
        for (const inserter of stock.inserters) signals.entity(`stock:${inserter.inserter_id}`, inserter, stock.ticks);
    }
    for (const [index, series] of (fuel_levels ?? []).entries()) {
        const ticks = Object.values(series).find(Array.isArray)?.length ?? 0;
        signals.entity(`fuel:${series.machine_id ?? index}`, series, ticks);
    }
}

/** The histories of a run: every entity's transitions (tick, from, to, reason) and its transfers (start, end, item, amount) */
function historySignals(signals, engine, run) {
    const expanded = engine.expandStateTransitionHistory(run.state_transition_history);
    signals.whole('transitions/total_duration_ticks', expanded.total_duration_ticks);
    for (const entity of expanded.entities) {
        const { transitions, ...meta } = entity;
        signals.whole(`transitions:${entity.entity_id}/meta`, meta);
        signals.events(`transitions:${entity.entity_id}`, transitions.map(t => [t.tick, t.from_status, t.to_status, t.reason]));
    }
    for (const [entity_id, transfers] of run.final_history.getAllTransfers()) {
        signals.events(`transfers:${entity_id.id}`, transfers.map(t => [t.tick_range.start, t.tick_range.end, t.item_name, t.amount, t.pickup_tick_before_run ?? null]));
    }
}

/** The timeline recording of a run: every entity's signals as their change lists, and its events */
function timelineSignals(signals, timeline) {
    if (!timeline) return;
    const { entities, events, ...meta } = timeline;
    signals.whole('timeline/meta', meta);
    for (const entity of entities) {
        const { signals: series, ...rest } = entity;
        signals.whole(`timeline:${entity.id}/meta`, rest);
        for (const signal of series) {
            const { ticks, values, ...details } = signal;
            signals.whole(`timeline:${entity.id}/${signal.id}/meta`, details);
            signals.events(`timeline:${entity.id}/${signal.id}`, ticks.map((tick, i) => [tick, values[i]]));
        }
    }
    const by_entity = new Map();
    for (const event of events) {
        const { tick, entity_id, ...rest } = event;
        if (!by_entity.has(entity_id)) by_entity.set(entity_id, []);
        by_entity.get(entity_id).push([tick, canonical(rest)]);
    }
    for (const [entity_id, rows] of by_entity) signals.events(`timeline-events:${entity_id}`, rows);
}

/** What planRun reads off its run and what a run hands back besides its recordings, as plain data */
function figuresOf(run) {
    return {
        duration_ticks: run.duration.ticks,
        recorded_ticks: run.recorded_duration.ticks,
        ticks_simulated: run.ticks_simulated,
        state_repeat: run.state_repeat ?? null,
        recipe_lcm: run.recipe_lcm,
        computed_lcm: run.computed_lcm,
        serializable_transfer_plan: run.serializable_transfer_plan,
        swing_counts: run.swing_counts,
        crafting_shares: run.crafting_shares,
        always_enabled_by_config: run.always_enabled_by_config,
        inserter_clocks: run.inserter_clocks,
        output_inserter_ids: run.output_inserter_ids,
        stability_check: run.stability_check,
        total_expected_output: run.total_expected_output,
        used_terminal_swing_count: run.used_terminal_swing_count,
        backpressure_loss: run.backpressure_loss ?? null,
    };
}

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** Scavenges (minor collections) while `fn` runs, from V8's GC profiler (read synchronously when it stops) */
function measured(fn) {
    const profiler = new GCProfiler();
    profiler.start();
    const started = process.hrtime.bigint();
    let value, error;
    try { value = fn(); } catch (e) { error = e; }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const scavenges = profiler.stop().statistics.filter(gc => gc.gcType === 'Scavenge').length;
    return { value, error, ms, scavenges };
}
const errorText = error => `${error?.name}: ${error?.message}`;

function loadEngine(dir) {
    const dist = path.resolve(dir, 'dist');
    const need = file => require(path.join(dist, file));
    need('data/factorio-data-file.js');
    return {
        ...need('crafting/trial.js'),
        ...need('crafting/plan/plan-run.js'),
        ...need('crafting/sequence/compact-history.js'),
        ...need('config/lane-capacity-validator.js'),
        OpenRange: need('data-types/open-range.js').OpenRange,
    };
}

function windowsOf(engine, windows) {
    return new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(r => engine.OpenRange.from(r.start, r.end))]));
}
const clockConfig = config => ({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } });

/**
 * The build on the job's clock windows alone, as runClockOnBuild runs it (a cold start, the default taker order and
 * decider order, the period of a whole-tick clock counted as its own), the whole run handed back rather than the trial
 * of it, so that its figures can be read
 */
function asBuiltRun(engine, job, options) {
    const config = engine.buildAsBuiltConfig(clockConfig(job.config), windowsOf(engine, job.windows), job.period);
    return engine.runBuild(config, { logger: quiet, cold_start: true, ...(Number.isInteger(job.period) && { period_ticks: job.period }), ...options });
}

/** The runs of a job, each as its signals and figures (or the error it threw) */
const RUNS = {
    asbuilt(engine, job) {
        if (!job.windows) return null;
        const timeline = Number.isInteger(job.period) ? { period_ticks: job.period, max_ticks: 1e9, max_points: 1e12 } : undefined;
        return () => {
            const run = asBuiltRun(engine, job, {
                simulate_periods: PERIODS, machine_stock: true, factorio_states: true, fuel_levels: true, detect_repeat: true,
                ...(timeline && { timeline_recording: timeline }),
            });
            const signals = new Signals();
            stockSignals(signals, run.machine_stock, run.fuel_levels);
            historySignals(signals, engine, run);
            timelineSignals(signals, run.timeline_recording);
            signals.whole('figures', figuresOf(run));
            // what a trial hands back besides the run: the serialized transfers and the machine facts
            const trial = engine.trialRunOf(run);
            signals.whole('trial/machine_facts', trial.machine_facts);
            signals.whole('trial/transfer_history', trial.serializable_transfer_history);
            return { signals, period: job.period, ticks: run.recorded_duration.ticks, ticks_simulated: run.ticks_simulated, total_expected_output: run.total_expected_output };
        };
    },
    plan(engine, job) {
        return () => {
            // as planRun runs it (factorio_states as planRun's default), with the stock and the fuel watched
            const run = engine.runBuild(job.config, { logger: quiet, machine_stock: true, fuel_levels: true });
            engine.assertLaneCapacity(job.config);
            const signals = new Signals();
            stockSignals(signals, run.machine_stock, run.fuel_levels);
            historySignals(signals, engine, run);
            signals.whole('figures', figuresOf(run));
            const windows = engine.windowsFromHistory(run.final_history, run.simulation_context.entity_registry, run.always_enabled_by_config);
            signals.whole('windows', [...windows.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([id, ranges]) => [id, ranges.map(r => [r.start, r.end])]));
            return { signals, period: run.duration.ticks, ticks: run.recorded_duration.ticks, ticks_simulated: run.ticks_simulated };
        };
    },
    fuel(engine, job) {
        return () => {
            // the view of the fuel being consumed, as a clock's export makes it (a run of its own with the fuel clocks), on
            // the plan's own clock; only builds with fuel inserters have one. Its history carries the reason table's
            // numbers, which are this process's: it is hashed with its reasons as texts (toPortable)
            const plan = engine.planRun(job.config, { logger: quiet });
            const signals = new Signals();
            const has_fuel = [...plan.run.inserter_clocks.values()].some(clock => clock.kind === 'fuel');
            const view = has_fuel ? engine.exportClock(plan, engine.clockOfPlan(plan), engine.clockOfPlan(plan).windows,
                { fuel_consumption_view: true, modulo_blueprint: false }).fuel_consumption_view : undefined;
            signals.whole('fuel_consumption_view', view === undefined ? null
                : { ...view, state_transition_history: engine.toPortable(view.state_transition_history) });
            return { signals, period: plan.run.duration.ticks, ticks: 0, ticks_simulated: 0 };
        };
    },
    speed(engine, job) {
        if (!job.windows) return null;
        return () => {
            const run = asBuiltRun(engine, job, { simulate_periods: PERIODS, factorio_states: false, detect_repeat: true });
            const signals = new Signals();
            signals.whole('figures', { recorded_ticks: run.recorded_duration.ticks, ticks_simulated: run.ticks_simulated, state_repeat: run.state_repeat ?? null });
            return { signals, period: job.period, ticks: run.recorded_duration.ticks, ticks_simulated: run.ticks_simulated };
        };
    },
    losses(engine, job, expected) {
        if (!job.windows || expected === undefined) return null;
        return () => {
            const report = engine.backpressureLossOf(job.config, job.windows, job.period, expected, quiet);
            const signals = new Signals();
            signals.whole('report', report);
            return { signals, period: job.period, ticks: 0, ticks_simulated: 0 };
        };
    },
};

async function main() {
    const options = args();
    const job = JSON.parse(fs.readFileSync(options.input, 'utf8'));
    const engine = loadEngine(options.engine);
    if (options.dump) {
        const make = RUNS[options.dump](engine, job);
        if (!make) throw new Error(`replay.js: the job has no ${options.dump} run`);
        const outcome = make();
        process.stdout.write(JSON.stringify(outcome.signals.dump(outcome.period, options.period)));
        return;
    }
    const result = { format: FORMAT, key: job.key, group: job.group, name: job.name, period: job.period ?? null, runs: {} };
    let expected;
    for (const name of ['asbuilt', 'plan', 'fuel', 'speed', ...(options.losses ? ['losses'] : [])]) {
        const make = RUNS[name](engine, job, expected);
        if (!make) continue;
        const { value, error, ms, scavenges } = measured(make);
        if (error) { result.runs[name] = { error: errorText(error), ms }; continue; }
        if (name === 'asbuilt') expected = value.total_expected_output;
        const ticks = value.ticks_simulated;
        result.runs[name] = {
            ticks: value.ticks, ticks_simulated: ticks, period: value.period, ...value.signals.hashes(value.period, value.ticks),
            perf: { ms: Math.round(ms), ticks_per_second: ms > 0 && ticks ? Math.round(ticks / (ms / 1000)) : null,
                scavenges, scavenges_per_million_ticks: ticks ? Math.round(scavenges * 1e6 / ticks * 10) / 10 : null },
        };
    }
    const tmp = `${options.output}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(result));
    fs.renameSync(tmp, options.output);
}

main().catch(error => { console.error(error?.stack ?? error); process.exit(1); });
