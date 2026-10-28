// The results digest of a blast job: what the clock hash leaves out. clock_sha256 hashes the exported clock's identity; the
// results digest hashes the rest of what an alternative shows a player (its label, description, insights, verdict and
// assessment), what the simulation recorded (the transfer and state transition histories, the clock-only run, the fuel
// view) and, for the job, why_not_stable, the selected index and the alternatives' ids. Each component is hashed on its own,
// so that a difference names what moved; results_sha256 is the sha256 of all the component lines.
//
// Values are walked in a canonical order (object keys sorted, Map and Set in entry order, members that are undefined left
// out as JSON does) and fed to the hash in chunks, never built into one string (the histories of processing units are
// hundreds of MB written out). A sealed history is hashed as expandStateTransitionHistory writes it, one entity at a time.
//
// Used by blast.blastrun.ts (blast.sh copies this file beside it); it imports nothing of the engine, so that a worktree
// from before the sealed histories can be measured too.
import { createHash } from 'crypto';

class Sha {
    private hash = createHash('sha256');
    private parts: string[] = [];
    private size = 0;
    private bytes = 0;
    put(text: string) { this.parts.push(text); this.size += text.length; if (this.size > (1 << 20)) this.flush(); }
    private flush() {
        if (!this.parts.length) return;
        const text = this.parts.join('');
        this.bytes += Buffer.byteLength(text);
        this.hash.update(text);
        this.parts = []; this.size = 0;
    }
    done() { this.flush(); return { sha: this.hash.digest('hex'), bytes: this.bytes }; }
}

/** An array whose members are made as they are walked, so that a long list of large members is never all in memory; it hashes as the array does */
export class Lazy {
    constructor(readonly length: number, readonly at: (index: number) => unknown) { }
}

function walk(value: unknown, sink: Sha, depth = 0): void {
    switch (typeof value) {
        case 'undefined': sink.put('U'); return;
        case 'boolean': sink.put(value ? 'T' : 'F'); return;
        case 'number': sink.put(Object.is(value, -0) ? 'n-0;' : `n${value};`); return;
        case 'bigint': sink.put(`b${value};`); return;
        case 'string': sink.put(`s${value.length}:${value};`); return;
        case 'function': sink.put(`f<${value.name}>;`); return;
        case 'symbol': sink.put('y;'); return;
    }
    if (value === null) { sink.put('N'); return; }
    if (depth > 200) throw new Error('digest: value nests too deep (a cycle?)');
    if (value instanceof Lazy) {
        sink.put(`[${value.length}:`);
        for (let index = 0; index < value.length; index++) walk(value.at(index), sink, depth + 1);
        sink.put(']');
    } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        const list = value as ArrayLike<unknown>;
        sink.put(`[${list.length}:`);
        for (let index = 0; index < list.length; index++) walk(list[index], sink, depth + 1);
        sink.put(']');
    } else if (value instanceof Map) {
        sink.put(`M${value.size}:`);
        for (const [k, v] of value) { walk(k, sink, depth + 1); walk(v, sink, depth + 1); }
        sink.put('}');
    } else if (value instanceof Set) {
        sink.put(`S${value.size}:`);
        for (const v of value) walk(v, sink, depth + 1);
        sink.put('}');
    } else {
        const object = value as Record<string, unknown>;
        const keys = Object.keys(object).filter(k => object[k] !== undefined).sort();
        sink.put(`{${keys.length}:`);
        for (const k of keys) { sink.put(`k${k.length}:${k};`); walk(object[k], sink, depth + 1); }
        sink.put('}');
    }
}

/** The sha256 of a value in the canonical walk, and how many bytes the walk wrote */
export function shaOf(value: unknown): { sha: string; bytes: number } {
    const sink = new Sha();
    walk(value, sink);
    return sink.done();
}

/** Turns a sealed history into its serializable form (expandStateTransitionHistory) */
export type ExpandHistory = (history: any) => any;

/**
 * A history as expandStateTransitionHistory writes it, made one entity at a time while it is hashed. A history that is
 * not sealed (no columns: a build from before them) and anything that is not a history are returned as they are.
 */
export function expandedLazily(history: any, expand: ExpandHistory | undefined): unknown {
    const entities: any[] | undefined = history?.entities;
    if (!expand || !Array.isArray(entities) || !entities.some(entity => entity?.columns !== undefined)) return history;
    return {
        total_duration_ticks: history.total_duration_ticks,
        entities: new Lazy(entities.length, index => expand({ ...history, entities: [entities[index]] }).entities[0]),
    };
}

/** A digest: the sha of every component, and the sha of them all */
export interface ResultsDigest {
    results_sha256: string;
    results: Record<string, string>;
}

function digestOf(components: Record<string, unknown>): ResultsDigest {
    const results: Record<string, string> = {};
    const whole = createHash('sha256');
    for (const name of Object.keys(components)) {
        results[name] = shaOf(components[name]).sha;
        whole.update(`${name}\t${results[name]}\n`);
    }
    return { results_sha256: whole.digest('hex'), results };
}

/** The digest of one alternative of generateClockAlternatives' result */
export function digestAlternative(alternative: any, expand: ExpandHistory | undefined): ResultsDigest {
    const run = alternative.result;
    return digestOf({
        label: alternative.label,
        description: alternative.description,
        insights: alternative.insights,
        verdict: alternative.verdict,
        assessment: alternative.assessment,
        transfer_history: run.serializable_transfer_history,
        state_transition_history: expandedLazily(run.serializable_state_transition_history, expand),
        clock_only_run: run.clock_only_run && {
            ...run.clock_only_run,
            state_transition_history: expandedLazily(run.clock_only_run.state_transition_history, expand),
        },
        // its history too as the serializable form writes it: the sealed form's reasons are numbers of the process's reason
        // table, which another engine numbers otherwise for the same texts
        fuel_consumption_view: run.fuel_consumption_view && {
            ...run.fuel_consumption_view,
            state_transition_history: expandedLazily(run.fuel_consumption_view.state_transition_history, expand),
        },
    });
}

/** The digest of what belongs to the job and no alternative: why_not_stable, the selected index and the ids */
export function digestJob(generated: any): ResultsDigest {
    return digestOf({
        why_not_stable: generated.why_not_stable,
        selected_index: generated.selected_index,
        ids: generated.alternatives.map((alternative: any) => alternative.id),
    });
}
