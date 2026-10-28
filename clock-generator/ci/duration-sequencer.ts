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

/** Test files a CI shard runs at once: its runner has 4 vCPUs and vitest.config.ts runs one fewer files at once */
export const WORKERS = 3;

/** About how long a shard takes: its files run WORKERS at a time, and it is never shorter than its longest file */
export function estimatedSeconds(shard: readonly ShardItem[], workers = WORKERS): number {
    return Math.max(0, ...shard.map(item => item.seconds), shard.reduce((sum, item) => sum + item.seconds, 0) / workers);
}

/**
 * Splits items into `count` shards, longest first onto the shard that is then estimated to finish first (ties go to the
 * shard with the least total). The result depends on the items only (not on their order), so every shard job computes the
 * same split.
 */
export function assignShards(items: readonly ShardItem[], count: number, workers = WORKERS): ShardItem[][] {
    const shards: ShardItem[][] = Array.from({ length: count }, () => []);
    const ordered = [...items].sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const item of ordered) {
        let best = 0;
        let bestCost = Infinity;
        let bestTotal = Infinity;
        shards.forEach((shard, index) => {
            const cost = estimatedSeconds([...shard, item], workers);
            const total = shard.reduce((sum, it) => sum + it.seconds, 0);
            if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && total < bestTotal)) {
                best = index;
                bestCost = cost;
                bestTotal = total;
            }
        });
        shards[best].push(item);
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
 * job's wall time is that shard's. This sequencer deals the files out by their measured duration (how long a shard takes: its files WORKERS at a time, at least its longest) instead (the sorting
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
        console.log(`Shard ${index} of ${count}: ${mine.length} of ${files.length} test files, about ${Math.round(estimatedSeconds(mine))} s of tests (the slowest shard: `
            + `${Math.round(Math.max(...shards.map(shard => estimatedSeconds(shard))))} s)`
            + (unknown.length > 0 ? `; not in ci/generation-durations.json, counted as the median: ${unknown.join(', ')}` : ''));
        return mine.map(item => byKey.get(item.key)!);
    }
}
