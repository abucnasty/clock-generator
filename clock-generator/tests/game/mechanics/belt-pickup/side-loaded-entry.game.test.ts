import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { advanceMergeStock, assessTwoStreamMerge, candidateTurboMergeEntry, observedMergeGrabs } from "./two-stream-merge-replay";
import { composeProbeSource } from "../../helpers/probe-source";
import { EntityState, BeltState } from "../../../../src/state";
import { BeltPickupMerge, MergeStack as SimulatedMergeStack } from "../../../../src/state/belt-pickup-merge";

type Speed = "turbo" | "express" | "fast" | "yellow";
interface Variant {
    name: string; lane: 1 | 2 | "both"; speed: Speed;
    backed?: boolean; reflect?: boolean; turn?: number; releaseTick?: number; repeatedMerge?: boolean;
    pauseTick?: number; resumeTick?: number;
    blockOutletTick?: number; releaseOutletTick?: number;
    mixed?: "inner-cable" | "outer-cable";
    offsets: number[];
}
interface Stack { at: number; count: number; id: number; item: string }
interface Lane { length: number; stacks: Stack[] | Record<string, never> }
interface Sample {
    downstream: Lane[];
    tick: number; held: number; held_item?: string; lanes: Lane[]; input_enabled: boolean; outlet_open?: boolean;
    feed: { lanes: (Lane & { count: number; full: boolean })[] };
    inputs: unknown; output: unknown; crafting_progress: number;
}
const stacks = (lane: Lane): Stack[] => Object.values(lane.stacks);
const speedPerTick = { turbo: 4 / 32, express: 3 / 32, fast: 2 / 32, yellow: 1 / 32 };
const variants: Variant[] = [];
for (const backed of [false, true]) for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-south-${lane}-${backed ? "backed" : "moving"}`, lane, backed, speed: "turbo",
    offsets: backed || lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 1, 2, 4] : [0, 2, 4, 6],
});
for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-north-${lane}-moving`, lane, reflect: true, speed: "turbo",
    offsets: lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 2, 4, 6] : [0, 1, 2, 4],
});
for (const speed of ["express", "fast", "yellow"] as const) for (const lane of [1, 2, "both"] as const) variants.push({
    name: `${speed}-south-${lane}-moving`, lane, speed,
    offsets: lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 1, 2, 4]
        : speed === "express" ? [0, 1, 4, 6] : speed === "fast" ? [0, 4, 8, 12] : [0, 4, 12, 20],
});
for (const turn of [1, 2, 3]) variants.push({
    name: `turbo-inner-rotation-${turn}`, lane: 2, turn, speed: "turbo", offsets: [0, 2, 4, 6],
});
for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-south-${lane}-release17`, lane, speed: "turbo", releaseTick: 17,
    offsets: lane === "both" ? [0, 1, 2, 3] : [0, 1, 3, 5],
});

variants.push({name: "turbo-south-both-repeated-merge", lane: "both", speed: "turbo", repeatedMerge: true, offsets: [0, 1, 2, 3]});
variants.push({name: "express-south-both-repeated-merge", lane: "both", speed: "express", repeatedMerge: true, offsets: [0, 1, 2, 3]});
variants.push({name: "turbo-south-both-repeated-merge-release17", lane: "both", speed: "turbo", repeatedMerge: true, releaseTick: 17, offsets: [0, 1, 2, 3]});
variants.push({name: "turbo-south-both-repeated-merge-pause", lane: "both", speed: "turbo", repeatedMerge: true, pauseTick: 124, resumeTick: 156, offsets: [0, 1, 2, 3]});
variants.push({name: "turbo-south-both-repeated-merge-outlet", lane: "both", speed: "turbo", repeatedMerge: true, blockOutletTick: 124, releaseOutletTick: 188, offsets: [0, 1, 2, 3]});
variants.push({name: "turbo-north-both-repeated-merge", lane: "both", speed: "turbo", repeatedMerge: true, reflect: true, offsets: [0, 1, 2, 3]});
variants.push({name: "turbo-south-both-repeated-merge-mixed", lane: "both", speed: "turbo", repeatedMerge: true, mixed: "inner-cable", offsets: [0, 1, 2, 4]});
variants.push({name: "turbo-south-both-repeated-merge-mixed-swapped", lane: "both", speed: "turbo", repeatedMerge: true, mixed: "outer-cable", offsets: [0, 1, 2, 4]});

/** Derive variants from the photographed layout: no additional copied blueprints or probes. */
function makeVariant(text: string, variant: Variant) {
    interface Entity {
        entity_number: number; name: string; position: { x: number; y: number }; direction?: number;
        infinity_settings?: {filters: {name: string}[]};
    }
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as {
        blueprint: { entities: Entity[] };
    };
    const entities = decoded.blueprint.entities;
    const byId = (id: number) => {
        const entity = entities.find(e => e.entity_number === id);
        if (!entity) throw new Error(`missing side-loading fixture entity ${id}`);
        return entity;
    };
    expect(byId(6)).toMatchObject({ name: "turbo-transport-belt", position: { x: 0.5, y: 0.5 }, direction: 4 });
    // West feeders populate incoming lane 2; east feeders populate lane 1.
    const lane = variant.reflect && variant.lane !== "both" ? 3 - variant.lane : variant.lane;
    if (lane === 1) for (const id of [14, 15, 20, 21]) {
        const entity = byId(id);
        entity.position.x += id === 14 || id === 20 ? 2 : 4;
        if (id === 14 || id === 20) entity.direction = 4;
    }
    if (lane === "both") for (const [id, newId] of [[14, 22], [15, 23], [20, 24], [21, 25]]) {
        const entity = structuredClone(byId(id));
        entity.entity_number = newId;
        entity.position.x += id === 14 || id === 20 ? 2 : 4;
        if (id === 14 || id === 20) entity.direction = 4;
        entities.push(entity);
    }
    if (variant.mixed) for (const id of variant.mixed === "inner-cable" ? [15, 21] : [23, 25]) {
        byId(id).infinity_settings!.filters[0].name = "copper-cable";
    }
    if (variant.backed) {
        expect(byId(10).name).toBe("turbo-loader");
        decoded.blueprint.entities = entities.filter(e => e.entity_number !== 10);
    }
    let feedDx = 0, feedDy = variant.reflect ? -1 : 1;
    for (const entity of decoded.blueprint.entities) {
        if (variant.speed !== "turbo") entity.name = entity.name.replace("turbo-", variant.speed === "yellow" ? "" : `${variant.speed}-`);
        if (variant.reflect) {
            entity.position.y = 1 - entity.position.y;
            entity.direction = (8 - (entity.direction ?? 0) + 16) % 16;
        }
        for (let turn = 0; turn < (variant.turn ?? 0); turn++) {
            const { x, y } = entity.position;
            entity.position = { x: 1 - y, y: x };
            entity.direction = ((entity.direction ?? 0) + 4) % 16;
        }
    }
    for (let turn = 0; turn < (variant.turn ?? 0); turn++) [feedDx, feedDy] = [-feedDy, feedDx];
    return {
        blueprint: "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64"),
        options: { feedDx, feedDy, releaseTick: variant.releaseTick ?? 16, lastTick: 96 },
    };
}

/** Independent candidate supply rule, not the production simulator. Phase is observed before pickup. */
function checkSingleStream(samples: Sample[], variant: Variant, firstGrab: number, fullTick: number) {
    const laneIndex = variant.reflect ? 0 : 1;
    const incomingIndex = Number(variant.lane) - 1;
    const speed = speedPerTick[variant.speed];
    const inner = variant.lane === (variant.reflect ? 1 : 2);
    const entry = inner ? 67 / 256 : 188 / 256;
    let transfers = 0;
    for (let index = 1; index < 16; index++) {
        const previous = samples[index - 1], current = samples[index];
        const oldIds = new Set(stacks(previous.lanes[laneIndex]).map(s => s.id));
        for (const stack of stacks(current.lanes[laneIndex]).filter(s => !oldIds.has(s.id))) {
            const incoming = stacks(previous.feed.lanes[incomingIndex]).find(s => s.id === stack.id)!;
            expect(incoming).toBeDefined();
            // Entry boundary minus unused motion after crossing the incoming line's end.
            expect(stack.at + speed - incoming.at).toBe(entry);
            transfers++;
        }
    }
    expect(transfers).toBeGreaterThan(0);
    const phase = (stacks(samples[0].lanes[laneIndex])[0].at + speed) % 0.25;
    const consumed = new Set<number>();
    let held = 0;
    for (const sample of samples.filter(s => s.tick <= fullTick)) {
        const available: { id: number; at: number }[] = [];
        for (let id = 0; id < 100; id++) {
            const at = phase - sample.tick * speed + id * 0.25;
            if (at >= 0 && at < entry && !consumed.has(id)) available.push({ id, at });
        }
        if (sample.tick >= firstGrab && held < 16 && available.length) {
            consumed.add(available.pop()!.id);
            held += 4;
        }
        expect(held, `held at ${sample.tick}`).toBe(sample.held);
        expect(available.map(s => s.at), `positions at ${sample.tick}`).toEqual(stacks(sample.lanes[laneIndex]).map(s => s.at).sort((a, b) => a - b));
    }
}

/** Verify the production mode with phase aligned from the pre-pickup stream, not fitted to grabs. */
function checkSimulator(config: Config, samples: Sample[], variant: Variant, firstGrab: number, fullTick: number) {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({
        inserterState: state, tick_provider: context.tick_provider,
        sourceState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id),
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    let shift = 0;
    if (!variant.backed) {
        const speed = speedPerTick[variant.speed];
        const lane = samples[0].lanes[variant.reflect ? 0 : 1];
        const phase = (stacks(lane)[0].at + speed) % 0.25;
        const entry = variant.lane === (variant.reflect ? 1 : 2) ? 67 / 256 : 188 / 256;
        const aligned = Array.from({length: 8}, (_, index) => index).find(index =>
            ((entry - index * speed) % 0.25 + 0.25) % 0.25 === phase);
        expect(aligned, "profile phase must align with the observed stream").toBeDefined();
        shift = aligned!;
    }
    for (const sample of samples.filter(s => s.tick >= firstGrab && s.tick <= fullTick)) {
        context.tick_provider.setCurrentTick(sample.tick + shift);
        mode.executeForTick();
        expect(state.held_item?.quantity ?? 0, `simulator held at ${sample.tick}`).toBe(sample.held);
    }
}

/** Actual production pickup mode and supply, seeded once. Only external refill IDs and arm start/drop times
 * are supplied observations; queue positions, transfer decisions, remaining stock and withdrawals are predicted. */
function checkMergeSimulator(config: Config, samples: Sample[], receivingLane: number) {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected belt");
    const merge = source.pickup_merges.get(receivingLane + 1)!;
    const outerLane = 1 - receivingLane;
    const initial = samples[0];
    const convert = (lane: Lane, origin: "outer" | "inner", offset = 0): SimulatedMergeStack[] => stacks(lane)
        .map(s => ({id: s.id, position: Math.round(s.at * 256) + offset, item: s.item, count: s.count, origin}));
    merge.restore({tick: initial.tick,
        stock: [...convert(initial.lanes[receivingLane], "outer"), ...convert(initial.downstream[receivingLane], "outer", -256)],
        outer: convert(initial.feed.lanes[outerLane], "outer"), inner: convert(initial.feed.lanes[receivingLane], "inner"),
    });
    const first = merge.snapshot();
    const ids = new Map([...first.stock, ...first.outer, ...first.inner].map(stack => [stack.id, stack.id]));
    const sink = context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id);
    const mode = InserterPickupMode.create({inserterState: state, sourceState: source, sinkState: sink, tick_provider: context.tick_provider});
    let active = false;
    const ordered = <T extends {position: number}>(values: T[]): T[] => [...values].sort((a, b) => a.position - b.position);
    for (const [index, sample] of samples.slice(1).entries()) {
        const previous = samples[index];
        context.tick_provider.setCurrentTick(sample.tick);
        source.supply.refused.clear();
        if (sample.outlet_open === false) source.supply.refused.add("iron-plate");
        BeltState.advancePickups(source, sample.tick);
        if (sample.held === 0 && previous.held > 0) { state.held_item = null; active = false; }
        if (sample.held > 0 && previous.held === 0) active = true;
        if (active && (state.held_item?.quantity ?? 0) < 16) mode.executeForTick();
        expect(state.held_item?.quantity ?? 0, `production hand at ${sample.tick}`).toBe(sample.held);
        if (sample.held > 0) expect(state.held_item?.item_name).toBe(sample.held_item);
        const snapshot = merge.snapshot();
        for (const origin of ["outer", "inner"] as const) {
            const actual = convert(sample.feed.lanes[origin === "outer" ? outerLane : receivingLane], origin);
            expect(snapshot[origin].map(s => [s.position, s.item, s.count]), `production ${origin} queue at ${sample.tick}`)
                .toEqual(actual.map(s => [s.position, s.item, s.count]));
            snapshot[origin].forEach((stack, slot) => {
                if (ids.has(stack.id)) expect(ids.get(stack.id)).toBe(actual[slot].id);
                else ids.set(stack.id, actual[slot].id); // identity of an external refill only, after position validation
            });
        }
        const predicted = ordered(snapshot.stock).map(s => ({id: ids.get(s.id), position: s.position, item: s.item, count: s.count}));
        const actual = ordered([...convert(sample.lanes[receivingLane], "outer"), ...convert(sample.downstream[receivingLane], "outer", -256)])
            .map(s => ({id: s.id, position: s.position, item: s.item, count: s.count}));
        expect(predicted, `production stock at ${sample.tick}`).toEqual(actual);
        sink.inventoryState.clear();
    }
}

for (const variant of variants) test(`side-entry supply: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const fixture = GameFixturePaths.SIDE_LOADED_STRAIGHT;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "side-loaded-entry-"));
    try {
        const made = makeVariant(fs.readFileSync(path.join(fixture, "side-loaded-scaffold.txt"), "utf8"), variant);
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const outerItem = variant.mixed === "outer-cable" ? "copper-cable" : "iron-plate";
        config.belts[0].type = `${variant.speed === "yellow" ? "" : variant.speed + "-"}transport-belt` as typeof config.belts[0]["type"];
        config.belts[0].lanes = [
            { ingredient: variant.reflect ? outerItem : "", stack_size: 4 },
            { ingredient: variant.reflect ? "" : outerItem, stack_size: 4 },
        ];
        config.overrides!.backed_up_belts = variant.backed ?? false;
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = variant.reflect ? 2 : 1;
        if (variant.lane === "both") {
            delete source.pickup_supply;
            if (variant.speed === "turbo") source.pickup_merge = {
                lane: variant.reflect ? 1 : 2,
                outer: {ingredient: outerItem, stack_size: 4},
                inner: {ingredient: variant.mixed === "inner-cable" ? "copper-cable" : "iron-plate", stack_size: 4},
                downstream_tiles: 3, outlet: variant.backed ? "closed" : "open",
            };
        }
        else {
            const profile = variant.lane === (variant.reflect ? 1 : 2) ? "side-inner" : "side-outer";
            source.pickup_supply = variant.reflect ? [profile, "through"] : ["through", profile];
        }
        if (variant.repeatedMerge) Object.assign(made.options, {
            lastTick: 512, clearDestination: true, observeDownstream: true,
            pauseTick: variant.pauseTick, resumeTick: variant.resumeTick,
            blockOutletTick: variant.blockOutletTick, releaseOutletTick: variant.releaseOutletTick,
            downstreamTiles: 3,
        });
        const result = await recordInFactorio({
            factorio: factorio!, save: save!, config, blueprint: made.blueprint,
            lua: composeProbeSource(path.join(fixture, "probe.lua"), made.options),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: variant.repeatedMerge ? 540 : 120, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: false,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
            initial: { belt_shape: string }; samples: Sample[];
        };
        const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        const localBelt = result.recording.config.belts.find((belt: { id: number }) => belt.id === exported.source.id)!;
        expect(localBelt.lanes.map((lane: { ingredient: string }) => lane.ingredient)).toEqual(variant.reflect ? [outerItem, ""] : ["", outerItem]);
        expect(exported.source).toMatchObject({near_lane: variant.reflect ? 2 : 1, pickup_length: 1});
        if (variant.lane === "both") {
            expect(exported.source.pickup_supply).toBeUndefined();
            if (variant.speed === "turbo") {
                expect(exported.source.pickup_merge).toEqual(source.pickup_merge);
                expect(captured.source.pickup_merge).toEqual(source.pickup_merge);
                expect(result.recording.config.pickup_warnings).toBeUndefined();
            } else expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: exported.id ?? result.recording.config.inserters.indexOf(exported) + 1, reason: "merge"});
        } else {
            expect(exported.source.pickup_supply).toEqual(source.pickup_supply);
            expect(captured.source.pickup_supply).toEqual(source.pickup_supply);
            expect(result.recording.config.pickup_warnings).toBeUndefined();
        }
        const samples = report.samples;
        expect(report.initial.belt_shape).toBe("straight");
        expect(samples).toHaveLength(variant.repeatedMerge ? 512 : 96);
        expect(samples.slice(0, made.options.releaseTick).every(s => s.held === 0)).toBe(true);
        if (variant.repeatedMerge) {
            if (variant.speed === "turbo") checkMergeSimulator(config, samples, variant.reflect ? 0 : 1);
            const receivingLane = variant.reflect ? 0 : 1;
            expect(report.initial).toMatchObject({destination_cleared_each_tick: true});
            for (const sample of samples) {
                expect(sample.feed.lanes.map(lane => [lane.count, lane.full])).toEqual([[16, true], [16, true]]);
                expect(sample.lanes.map(lane => lane.length)).toEqual([1, 1]);
                expect(stacks(sample.lanes[1 - receivingLane])).toEqual([]);
                expect(stacks(sample.downstream[1 - receivingLane])).toEqual([]);
                expect(sample.crafting_progress).toBe(0);
                for (const stack of [...stacks(sample.lanes[receivingLane]), ...stacks(sample.downstream[receivingLane])]) {
                    expect(stack.count).toBe(4);
                    expect(variant.mixed ? ["iron-plate", "copper-cable"] : ["iron-plate"]).toContain(stack.item);
                }
                if (variant.mixed) {
                    expect(sample.held === 0 || sample.held_item === outerItem).toBe(true);
                    for (const [index, lane] of sample.feed.lanes.entries()) {
                        expect(stacks(lane).every(stack => stack.item === (index === 0 ? outerItem : variant.mixed === "inner-cable" ? "copper-cable" : "iron-plate"))).toBe(true);
                    }
                }
            }
            const replay = assessTwoStreamMerge(samples, speedPerTick[variant.speed] * 256, undefined, receivingLane);
            expect(replay.transitions).toBe(511);
            if (variant.speed === "turbo") {
                if (variant.releaseTick === 17) {
                    expect(replay.matchingPrefix).toBe(18);
                    expect(replay.firstMismatch).toEqual({tick: 20, receivingBefore: [28, 92], predictedReceiving: [60], observedReceiving: [60, 124]});
                    expect(replay.errors).toContain("refill count at 20, lane 2");
                } else if (!variant.pauseTick && !variant.blockOutletTick && !variant.mixed) {
                    expect(replay.errors).toEqual([]);
                    expect(replay.matchingPrefix).toBe(511);
                    expect(replay.transfers).toHaveLength(413);
                    expect(replay.attempts).toBe(610);
                }
                const refined = assessTwoStreamMerge(samples, 32, candidateTurboMergeEntry, receivingLane);
                expect(refined.errors).toEqual([]);
                expect(refined.matchingPrefix).toBe(511);
                expect(refined.grabs).toHaveLength(variant.mixed ? 167 : variant.pauseTick ? 171 : 180);
                expect(refined.transfers).toHaveLength(variant.mixed ? 421 : variant.blockOutletTick ? 386 : variant.pauseTick ? 404 : variant.releaseTick === 17 ? 414 : 413);
                expect(replay.compressedGaps).toBeGreaterThan(0);
                if (variant.pauseTick) {
                    expect(report.initial).toMatchObject({pause_tick: 124, resume_tick: 156});
                    expect(samples.filter(s => s.tick > 124 && s.tick <= 156).every(s => !s.input_enabled && s.held === 0)).toBe(true);
                    expect(samples[156].input_enabled).toBe(true);
                    expect(samples.find(s => s.tick > 156 && s.held > 0)?.tick).toBe(158);
                }
                if (variant.blockOutletTick) {
                    expect(report.initial).toMatchObject({block_outlet_tick: 124, release_outlet_tick: 188});
                    expect(samples.filter(s => s.tick > 124 && s.tick <= 188).every(s => s.outlet_open === false)).toBe(true);
                    expect(samples[188].outlet_open).toBe(true);
                    const stopped = Array.from({length: 12}, (_, index) => -768 + index * 64);
                    for (const sample of samples.slice(127, 188)) {
                        expect(stacks(sample.downstream[1]).map(s => s.at * 256 - 256).sort((a, b) => a - b)).toEqual(stopped);
                    }
                    // Both streams arrive on tick 132; backpressure holds them at adjacent full spacings.
                    expect(stacks(samples[131].lanes[1]).map(s => s.at * 256)).toEqual([0, 64, 128, 192]);
                    expect(refined.attempts).toBe(637);
                }
            } else {
                // Preserve the falsification of the unchanged turbo candidate, not a merge parity claim.
                expect(replay.matchingPrefix).toBe(17);
                expect(replay.firstMismatch).toEqual({tick: 19, receivingBefore: [11, 75], predictedReceiving: [51], observedReceiving: [51, 115]});
                expect(replay.errors).toContain("refill count at 19, lane 2");
                expect(replay.errors.some(error => error.startsWith("hand at"))).toBe(false);
                const before = samples[17], after = samples[18];
                const queued = stacks(before.feed.lanes[1])[0];
                expect(queued.at).toBe(0);
                expect(stacks(after.feed.lanes[1]).some(stack => stack.id === queued.id)).toBe(false);
                expect(stacks(after.lanes[1]).find(stack => stack.id === queued.id)?.at).toBe(115 / 256);
                // A second counterexample: a nominal entry with just one unit of space to its follower waits.
                expect(stacks(samples[25].lanes[1]).map(stack => stack.at * 256)).toEqual([3, 68, 132]);
                expect(stacks(samples[25].feed.lanes[1])[0].id).toBe(stacks(samples[26].feed.lanes[1])[0].id);
            }
            const observed = observedMergeGrabs(samples, receivingLane);
            expect(observed).toHaveLength(variant.mixed ? 167 : variant.pauseTick ? 171 : 180);
            expect(observed.filter(grab => grab.origin === 1)).toHaveLength(variant.mixed ? 167 : variant.reflect ? 45 : variant.pauseTick ? 129 : variant.speed === "turbo" ? 135 : 119);
            expect(observed.filter(grab => grab.origin === 2)).toHaveLength(variant.mixed ? 0 : variant.reflect ? 135 : variant.pauseTick ? 42 : variant.speed === "turbo" ? 45 : 61);
            const hands = samples.filter((sample, index) => sample.held === 16 && samples[index - 1]?.held !== 16);
            expect(hands).toHaveLength(variant.mixed ? 41 : variant.pauseTick ? 42 : 45);
            for (let index = 0; index + 4 <= observed.length; index += 4) {
                const hand = observed.slice(index, index + 4);
                expect(hand.map(grab => grab.tick - hand[0].tick)).toEqual(variant.offsets);
                if (variant.speed === "turbo") expect(hand.filter(grab => grab.origin === (variant.reflect ? 1 : 2))).toHaveLength(variant.mixed ? 0 : 1);
            }
            if (variant.speed === "express") expect(observed.slice(0, 4).map(grab => grab.origin)).toEqual([1, 1, 2, 2]);
        }
        const full = samples.find(s => s.held === 16)!;
        expect(full).toBeDefined();
        const hand = samples.filter(s => s.tick <= full.tick);
        const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
        expect(grabs.map(s => s.tick - grabs[0].tick)).toEqual(variant.offsets);
        expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(outerItem));
        for (const sample of hand) {
            expect(sample.lanes.map(lane => lane.length)).toEqual([1, 1]);
            expect(stacks(sample.lanes[variant.reflect ? 1 : 0])).toEqual([]);
            expect(sample.inputs).toEqual({});
            expect(sample.output).toEqual({});
            expect(sample.crafting_progress).toBe(0);
            for (const [index, lane] of sample.feed.lanes.entries()) {
                const supplied = variant.lane === "both" || index + 1 === variant.lane;
                expect(lane.count).toBe(supplied ? 16 : 0);
                expect(lane.full).toBe(supplied);
            }
        }
        if (variant.lane !== "both") checkSimulator(config, samples, variant, grabs[0].tick, full.tick);
        if (variant.backed) {
            const initial = stacks(samples[0].lanes[1]);
            expect(initial.map(s => s.at)).toEqual(variant.lane === 2 ? [0, 0.25, 0.5] : [0, 0.25, 0.5, 0.75]);
            for (const sample of samples.slice(0, 16)) expect(stacks(sample.lanes[1])).toEqual(initial);
        } else if (variant.lane !== "both") {
            checkSingleStream(samples, variant, grabs[0].tick, full.tick);
        } else {
            // Both incoming streams compete for one receiving lane. The inner stream waits
            // before pickup, then contributes after the inserter opens a gap.
            const innerIndex = variant.reflect ? 0 : 1;
            const waitingId = stacks(samples[0].feed.lanes[innerIndex])[0].id;
            for (const sample of samples.slice(0, 16)) expect(stacks(sample.feed.lanes[innerIndex])[0].id).toBe(waitingId);
            const entered = samples.slice(16).some((sample, index) => {
                if (stacks(sample.lanes[variant.reflect ? 0 : 1]).some(stack => stack.id === waitingId)) return true;
                // At slow speeds it can arrive and be picked up before the next snapshot.
                const previous = samples[index + 15];
                return stacks(previous.feed.lanes[innerIndex]).some(stack => stack.id === waitingId)
                    && !stacks(sample.feed.lanes[innerIndex]).some(stack => stack.id === waitingId)
                    && sample.held === previous.held + 4;
            });
            expect(entered).toBe(true);
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);

// A separate calibration, not natural supply or a repeated-hand test. Each case seeds exact observed
// positions once, then checks the first native transfer by ID with withdrawals and feeder refill disabled.
for (const {shift, outerStream} of [
    ...[89, 90, 91, 92, 93, 94, 95, 96].map(shift => ({shift, outerStream: true})),
    {shift: 95, outerStream: false}, {shift: 96, outerStream: false},
]) test(`turbo merge entry window: shift=${shift}, outer=${outerStream}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const fixture = GameFixturePaths.SIDE_LOADED_STRAIGHT;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "turbo-entry-window-"));
    try {
        const made = makeVariant(fs.readFileSync(path.join(fixture, "side-loaded-scaffold.txt"), "utf8"), {
            name: "entry-window", lane: "both", speed: "turbo", offsets: [],
        });
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        delete source.pickup_supply;
        await recordInFactorio({
            factorio: factorio!, save: save!, config, blueprint: made.blueprint,
            lua: composeProbeSource(path.join(fixture, "entry-window-probe.lua"), {shift, outerStream}),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 6, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: false,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        interface CalibrationSample { tick: number; held: number; lanes: Lane[]; feed: {lanes: Lane[]} }
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/entry-window.json"), "utf8")) as {
            initial: CalibrationSample & {seeded_positions: boolean; requested_shift: number; outer_stream: boolean};
            samples: CalibrationSample[];
        };
        expect(report.initial).toMatchObject({tick: 0, seeded_positions: true, requested_shift: shift, outer_stream: outerStream});
        const before = report.initial, after = report.samples[0];
        const converted = (lane: Lane, origin: "outer" | "inner"): SimulatedMergeStack[] => stacks(lane)
            .map(stack => ({id: stack.id, position: stack.at * 256, count: stack.count, item: stack.item, origin}));
        const production = new BeltPickupMerge({lane: 2,
            outer: {ingredient: "iron-plate", stack_size: 4}, inner: {ingredient: "iron-plate", stack_size: 4},
            downstream_tiles: 3, outlet: "open"}, false, {
            tick: 0, stock: converted(before.lanes[1], "outer"),
            outer: converted(before.feed.lanes[0], "outer"), inner: converted(before.feed.lanes[1], "inner"),
        }, false);
        const receiving = stacks(before.lanes[1]).map(stack => stack.at * 256);
        expect(receiving).toEqual([shift - 61, shift + 3]);
        expect(report.samples).toHaveLength(4);
        expect(after.tick).toBe(1);
        for (const sample of [before, ...report.samples]) {
            expect(sample.held).toBe(0);
            expect(stacks(sample.lanes[0])).toEqual([]);
            expect(stacks(sample.lanes[1]).every(stack => stack.count === 4 && stack.item === "iron-plate")).toBe(true);
        }
        for (const sample of report.samples) {
            production.advanceTo(sample.tick);
            const snapshot = production.snapshot();
            const values = (stock: SimulatedMergeStack[]) => stock.map(s => [s.id, s.position, s.count, s.item]);
            expect(values(snapshot.stock.filter(s => s.position >= 0))).toEqual(values(converted(sample.lanes[1], "outer")));
            expect(values(snapshot.outer)).toEqual(values(converted(sample.feed.lanes[0], "outer")));
            expect(values(snapshot.inner)).toEqual(values(converted(sample.feed.lanes[1], "inner")));
        }
        // Check movement of pre-existing stacks through every captured tick, independently of new arrivals.
        for (const [index, sample] of report.samples.entries()) {
            const previous = index === 0 ? before : report.samples[index - 1];
            const stock = stacks(previous.lanes[1]).map(stack => ({id: stack.id, position: stack.at * 256}));
            const existingIds = new Set(stock.map(stack => stack.id));
            expect(stacks(sample.lanes[1]).filter(stack => existingIds.has(stack.id)).map(stack => ({id: stack.id, position: stack.at * 256})))
                .toEqual(advanceMergeStock(stock).filter(stack => stack.position >= 0));
        }
        for (const [index, lane] of before.feed.lanes.entries()) {
            expect(stacks(lane).map(stack => stack.at * 256)).toEqual(index === 0 && !outerStream ? [] : [0, 64, 128, 192]);
            expect(stacks(lane).every(stack => stack.count === 4 && stack.item === "iron-plate")).toBe(true);
        }
        const inner = stacks(before.feed.lanes[1])[0];
        const accepted = shift < 96;
        expect(stacks(after.feed.lanes[1]).some(stack => stack.id === inner.id)).toBe(!accepted);
        const arrived = stacks(after.lanes[1]).find(stack => stack.id === inner.id);
        expect(arrived?.at).toBe(accepted ? (67 + shift - 32) / 256 : undefined);
        expect(candidateTurboMergeEntry(receiving, 67)).toBe(accepted ? 67 + shift : undefined);
        if (outerStream) {
            const outer = stacks(before.feed.lanes[0])[0];
            expect(stacks(after.feed.lanes[0]).some(stack => stack.id === outer.id)).toBe(false);
            expect(stacks(after.lanes[1]).find(stack => stack.id === outer.id)?.at).toBe(156 / 256);
        } else expect(stacks(after.feed.lanes[0])).toEqual([]);
    } finally {
        fs.rmSync(scratch, {recursive: true, force: true});
    }
}, 240_000);
