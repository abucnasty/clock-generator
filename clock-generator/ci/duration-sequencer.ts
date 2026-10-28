import fs from 'node:fs';
import path from 'node:path';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/** Seconds each generation test file took on a CI runner (ci/generation-durations.json, keyed by path from this package) */
const durationsFile = path.join(__dirname, 'generation-durations.json');

export interface ShardItem {
    key: string;
    seconds: number;
}

/**
 * Splits items into `count` shards of about the same total, longest first onto the shard that has the least so far.
 * The result depends on the items only (not on their order), so every shard job computes the same split.
 */
export function assignShards(items: readonly ShardItem[], count: number): ShardItem[][] {
    const shards: ShardItem[][] = Array.from({ length: count }, () => []);
    const loads: number[] = new Array(count).fill(0);
    const ordered = [...items].sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const item of ordered) {
        const lightest = loads.indexOf(Math.min(...loads));
        shards[lightest].push(item);
        loads[lightest] += item.seconds;
    }
    return shards;
}

/** The measured seconds of the known keys; a key that is not known (a new or renamed file) counts as the median */
export function secondsOf(keys: readonly string[], known: Readonly<Record<string, number>>): Map<string, number> {
    const measured = Object.values(known).sort((a, b) => a - b);
    const median = measured.length > 0 ? measured[Math.floor(measured.length / 2)] : 1;
    return new Map(keys.map(key => [key, known[key] ?? median]));
}

/**
 * Vitest's `--shard` gives each shard files by the hash of their paths, so one shard can get the two slowest files and the
 * job's wall time is that shard's. This sequencer deals the files out by their measured duration instead (the sorting
 * inside a shard is vitest's own). Every shard job sees the same list of files, so the shards are disjoint and together
 * hold all of them: a file that is not in the durations file still runs, in the shard its estimated time puts it in.
 * Refresh the durations with scripts/ci/update-generation-durations.js.
 */
export default class DurationSequencer extends BaseSequencer {
    override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
        const { index, count } = this.ctx.config.shard!;
        const root = this.ctx.config.root;
        const keyOf = (spec: TestSpecification) => path.relative(root, spec.moduleId).split(path.sep).join('/');
        const known: Record<string, number> = JSON.parse(fs.readFileSync(durationsFile, 'utf8'));
        const byKey = new Map(files.map(spec => [keyOf(spec), spec]));
        const seconds = secondsOf([...byKey.keys()], known);
        const shards = assignShards([...byKey.keys()].map(key => ({ key, seconds: seconds.get(key)! })), count);
        const dealt = shards.reduce((n, shard) => n + shard.length, 0);
        if (byKey.size !== files.length || dealt !== files.length) {
            throw new Error(`The shards hold ${dealt} test files of ${files.length} (${byKey.size} distinct): none may be missed or run twice`);
        }
        const mine = shards[index - 1];
        const unknown = [...byKey.keys()].filter(key => known[key] === undefined);
        console.log(`Shard ${index} of ${count}: ${mine.length} of ${files.length} test files, about ${Math.round(mine.reduce((s, i) => s + i.seconds, 0))} s of `
            + `${Math.round([...seconds.values()].reduce((s, v) => s + v, 0))} s in all`
            + (unknown.length > 0 ? `; not in ci/generation-durations.json, counted as the median: ${unknown.join(', ')}` : ''));
        return mine.map(item => byKey.get(item.key)!);
    }
}
