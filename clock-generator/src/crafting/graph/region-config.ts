/**
 * The config of one repeated group of machines of a build, cut out of it so that it can be planned alone, as if it were the
 * build: the group's machines, drills and arms; the anchor machine at its own speed and every part that matches no other; every
 * arm of the anchor that touches the group or touches no group; and every belt and chest a kept arm or drill takes from or drops
 * on. The other groups, their drills and the anchor arms that touch only them are left out. The setpoint is the build's rate over
 * the number of groups; `copies`, `copy_offset`, each lane's `sharing` and every `sink.drop` stay as the build states them.
 *
 * Kept inserters get an explicit id, their key in the whole build (`id`, else their place in the list), so that a window key means
 * the same arm in both configs. A build is not cut (`not_cut`, with the code) where a machine that makes the target lies outside
 * the groups, an arm lies in no group and is not the anchor's, a kept arm or drill has an end outside what is kept, or the config
 * names output inserters by their number among all copies (`output_belt`).
 */
import type { Config } from "../../config";
import type { RegionOrbit } from "./regions";

export type RegionCutRefusal = "output_belt" | "target_outside_regions" | "arm_in_no_region" | "end_outside_cut";

export type RegionCut =
    | {
        kind: "cut";
        config: Config;
        /** The region's key ("machine:4/region:1") */
        region: string;
        /** The whole build's inserter keys kept, and the anchor arms left out */
        kept_inserters: string[];
        dropped_anchor_arms: string[];
    }
    | { kind: "not_cut"; reason: RegionCutRefusal; detail: string };

/** The entity of a node key: "belt:4/lane:1" is "belt:4" */
const entityOf = (node: string): string => node.split("/")[0];

/** An inserter end as the finder keys it */
function endKey(end: { type: string; id: number }): string {
    return `${end.type}:${end.id}`;
}

/** The inserter keys of a config, as the planner facts key them: its id, else its place in the list from 1 */
export function inserterKeysOf(config: Pick<Config, "inserters">): string[] {
    return config.inserters.map((inserter, index) => `inserter:${inserter.id ?? index + 1}`);
}

/** The build's rate over n, reduced where it is a fraction */
function rateOver(rate: Config["setpoint"]["items_per_second"], n: number): Config["setpoint"]["items_per_second"] {
    if (typeof rate === "number") return rate / n;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(rate.numerator, rate.denominator * n);
    return { numerator: rate.numerator / divisor, denominator: rate.denominator * n / divisor };
}

/** The config of region `k` of the orbit (see the module) */
export function cutRegionConfig(config: Config, orbit: RegionOrbit, k: number): RegionCut {
    const refuse = (reason: RegionCutRefusal, detail: string): RegionCut => ({ kind: "not_cut", reason, detail });
    if (config.output_belt !== undefined) return refuse("output_belt", "the output belt names output inserters by their number among all copies");
    const keys = inserterKeysOf(config);
    const anchor_machine = orbit.anchor[0];
    const anchor_arms = orbit.anchor.filter(node => node.startsWith("inserter:"));
    const unmatched = orbit.anchor.slice(1).filter(node => !node.startsWith("inserter:"));
    const region_entities = orbit.regions.map(region => new Set(region.nodes.map(entityOf)));
    const any_region = new Set(region_entities.flatMap(set => [...set]));
    const mine = region_entities[k];
    const kept_entities = new Set([...mine, anchor_machine, ...unmatched.map(entityOf)]);
    const target = config.setpoint.item;
    const outside = config.machines.filter(machine => machine.recipe === target && !any_region.has(`machine:${machine.id}`));
    if (outside.length > 0) return refuse("target_outside_regions", outside.map(machine => `machine:${machine.id}`).join(" "));

    const kept = new Set(orbit.regions[k].arms.filter(arm => arm.startsWith("inserter:")));
    const dropped: string[] = [];
    config.inserters.forEach((inserter, index) => {
        const key = keys[index];
        if (!anchor_arms.includes(key)) return;
        const ends = [endKey(inserter.source), endKey(inserter.sink)];
        if (ends.some(end => mine.has(end)) || !ends.some(end => any_region.has(end))) kept.add(key);
        else dropped.push(key);
    });
    const in_regions = new Set(orbit.regions.flatMap(region => region.arms));
    const stray = keys.filter(key => !kept.has(key) && !dropped.includes(key) && !in_regions.has(key));
    if (stray.length > 0) return refuse("arm_in_no_region", stray.join(" "));

    const belts = new Set<number>(), chests = new Set<number>();
    const inserters: Config["inserters"] = [];
    for (const [index, inserter] of config.inserters.entries()) {
        const key = keys[index];
        if (!kept.has(key)) continue;
        inserters.push({ ...inserter, id: Number(key.split(":")[1]) });
        for (const end of [inserter.source, inserter.sink]) {
            if (end.type === "belt") belts.add(end.id);
            else if (end.type === "chest") chests.add(end.id);
            else if (!kept_entities.has(endKey(end))) return refuse("end_outside_cut", `${key} at ${endKey(end)}`);
        }
    }
    const drills = (config.drills?.configs ?? []).filter(drill => kept_entities.has(`drill:${drill.id}`));
    for (const drill of drills) {
        if (drill.target.type === "chest") chests.add(drill.target.id);
        else if (!kept_entities.has(endKey(drill.target))) return refuse("end_outside_cut", `drill:${drill.id} at ${endKey(drill.target)}`);
    }
    const cut: Config = {
        ...config,
        machines: config.machines.filter(machine => kept_entities.has(`machine:${machine.id}`)),
        inserters,
        belts: config.belts.filter(belt => belts.has(belt.id)),
        ...(config.chests !== undefined && { chests: config.chests.filter(chest => chests.has(chest.id)) }),
        ...(config.drills !== undefined && { drills: { ...config.drills, configs: drills } }),
        setpoint: { ...config.setpoint, items_per_second: rateOver(config.setpoint.items_per_second, orbit.regions.length) },
    };
    return { kind: "cut", config: cut, region: orbit.regions[k].key, kept_inserters: keys.filter(key => kept.has(key)), dropped_anchor_arms: dropped };
}
